"""Webclip ingestion endpoints.

Flow:
  1. Client POSTs a URL (+ optional subfolder/title).
  2. We SSRF-validate the URL up front. A structural rejection here
     avoids creating an on-disk placeholder for a URL we'd never
     fetch anyway.
  3. We synthesize a tentative filename from the URL, then ask the
     core to create a placeholder ``.md`` with a ``status: fetching``
     frontmatter. The core owns the drive, so this is how we land a
     file in the drive while observing drive access control.
  4. We persist a ClipJob row and hand the task to the worker. The
     response returns right away — the UI tails a WebSocket for
     ``knowledge.clip.ready`` to know when to refresh.

The pasted-HTML endpoint is a fallback for SPA / auth-walled pages
where the fetcher can't reach the content. It skips the fetch and
jumps straight to sanitization + markdownify.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import get_viewer_id
from app.database import get_db
from app.internal_client import InternalAPIError, InternalClient
from app.models import ClipJob
from app.sanitize import build_frontmatter, slugify_filename
from app.schemas import ClipCreate, ClipJobOut, ClipPasted
from app.services.extractor import ExtractedArticle, extract_article, sanitize_pasted_html
from app.services.fetcher import BlockedURL, validate_url
from app.services.frontmatter import iso_z
from app.services.safepath import validate_relative_path
from app.services.worker import ClipTask

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clips", tags=["clips"])


def _placeholder_slug(title: str | None) -> str:
    """Pick a placeholder ``.md`` filename before the fetch runs.

    A caller-supplied title (bookmarklet ``?title=`` prefill, manual
    entry, etc.) wins because it's human-readable from the start. URL
    path segments are deliberately *not* used — they're usually opaque
    IDs (``/articles/satoru-render-explanation``) and the file is going
    to be renamed again anyway once the extractor returns a real title.
    The timestamped fallback keeps every placeholder unique and sortable
    when no title is known yet.
    """
    if title and title.strip():
        return slugify_filename(title.strip(), fallback_hint="clip")
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"clip-{ts}.md"


def _initial_content(url: str) -> str:
    fm = build_frontmatter({
        "url": url,
        "origin": "webclip",
        "created": iso_z(datetime.now(timezone.utc)),
    })
    return fm + "\nFetching…\n"


def _compute_etag(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _ready_content(url: str, article: ExtractedArticle) -> str:
    fm = build_frontmatter({
        "url": url,
        "origin": "webclip",
        "created": iso_z(datetime.now(timezone.utc)),
    })
    return fm + "\n" + article.markdown + "\n"


def _require_drive(drive: str | None) -> str:
    if not drive:
        raise HTTPException(status_code=400, detail="Drive context required")
    # Frontend percent-encodes the header so non-ASCII drive names
    # survive HTTP transit (header values are ISO-8859-1).
    return unquote(drive)


def _join_path(subfolder: str | None, filename: str) -> str:
    """Compose ``{subfolder}/{filename}`` with clean separators.

    ``subfolder`` is optional; missing segments are elided instead of
    leaving empty path components. The core does the authoritative
    resolution, this just avoids double slashes that the core would
    reject.
    """
    parts: list[str] = []
    if subfolder:
        parts.append(subfolder.strip("/"))
    parts.append(filename)
    return "/".join(p for p in parts if p)


async def _create_placeholder(
    client: InternalClient,
    drive: str,
    url: str,
    subfolder: str | None = None,
    title: str | None = None,
) -> tuple[dict, str]:
    """Create the fetching-state placeholder .md. Returns (file, etag).

    ``subfolder`` is drive-relative; None or empty means the drive root.
    ``title`` is an optional page-title hint — when provided the file
    lands with a readable name; otherwise we use a timestamped stub and
    rely on rename-on-ready to upgrade it after extraction.
    Validated structurally here so obviously bad input fails fast before
    the core round-trip.
    """
    if subfolder:
        validate_relative_path(subfolder)
    slug = _placeholder_slug(title)
    rel_path = _join_path(subfolder, slug)
    content = _initial_content(url)
    try:
        created = await client.create_text_file(drive, rel_path, content)
    except InternalAPIError as e:
        # 409: filename collision. Retry once with a timestamp suffix.
        if e.status_code == 409:
            ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            slug2 = slug[:-3] + f"-{ts}.md"
            rel_path = _join_path(subfolder, slug2)
            try:
                created = await client.create_text_file(
                    drive, rel_path, content
                )
            except InternalAPIError as e2:
                raise HTTPException(status_code=502, detail=str(e2))
        else:
            raise HTTPException(status_code=502, detail=str(e))
    return created, _compute_etag(content)


@router.get("", response_model=list[ClipJobOut])
async def search_clips(
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    url: Annotated[str, Query(min_length=1, max_length=4000)],
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
):
    """Look up existing ClipJobs for a URL within the current drive.

    Used by the frontend to detect duplicate URL submissions before
    POSTing a new clip. The query is scoped to ``(viewer_id, drive)``
    so a viewer cannot probe whether they clipped the same URL on a
    different drive — drive is the security boundary.
    """
    drive = _require_drive(x_hv_drive)
    jobs = (
        db.query(ClipJob)
        .filter(
            ClipJob.viewer_id == viewer_id,
            ClipJob.drive == drive,
            ClipJob.url == url,
        )
        .order_by(ClipJob.id.desc())
        .limit(10)
        .all()
    )
    return [
        ClipJobOut(job_id=j.id, file_id=j.file_id, status=j.status)
        for j in jobs
    ]


@router.post("", response_model=ClipJobOut, status_code=202)
async def create_clip(
    body: ClipCreate,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
):
    drive = _require_drive(x_hv_drive)
    # Structural SSRF check. DNS-level checks also run in the worker,
    # but failing fast here keeps us from creating a placeholder for a
    # URL we'd never touch.
    try:
        validate_url(body.url)
    except BlockedURL as e:
        raise HTTPException(status_code=400, detail=f"URL rejected: {e}")

    client = InternalClient(cookie_header=cookie)
    created, _etag = await _create_placeholder(
        client, drive, body.url, subfolder=body.subfolder, title=body.title
    )

    job = ClipJob(
        file_id=created["id"],
        viewer_id=viewer_id,
        drive=drive,
        url=body.url,
        status="fetching",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    from app.main import get_worker  # late import: avoids circular at module load
    worker = get_worker()
    if worker is not None:
        await worker.enqueue(ClipTask(
            job_id=job.id,
            file_id=created["id"],
            viewer_id=viewer_id,
            url=body.url,
            cookie_header=cookie or "",
            drive=drive,
        ))

    return ClipJobOut(job_id=job.id, file_id=created["id"], status="fetching")


@router.post("/pasted", response_model=ClipJobOut, status_code=201)
async def create_clip_from_html(
    body: ClipPasted,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
):
    drive = _require_drive(x_hv_drive)
    # URL is metadata only here — we still validate it structurally so
    # the frontmatter doesn't get a garbage string.
    try:
        validate_url(body.url)
    except BlockedURL as e:
        raise HTTPException(status_code=400, detail=f"URL rejected: {e}")

    # Sanitize and extract synchronously — no network involved.
    safe_html = sanitize_pasted_html(body.html)
    try:
        article = extract_article(safe_html, body.url)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Extract failed: {e}")

    client = InternalClient(cookie_header=cookie)
    created, initial_etag = await _create_placeholder(
        client, drive, body.url, subfolder=body.subfolder, title=body.title
    )

    # Overwrite placeholder with the extracted markdown immediately.
    ready = _ready_content(body.url, article)
    try:
        await client.put_file_content(
            created["id"], ready, f'"{initial_etag}"'
        )
    except InternalAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    job = ClipJob(
        file_id=created["id"],
        viewer_id=viewer_id,
        drive=drive,
        url=body.url,
        status="ready",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    return ClipJobOut(job_id=job.id, file_id=created["id"], status="ready")
