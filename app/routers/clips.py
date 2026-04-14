"""Webclip ingestion endpoints.

Flow:
  1. Client POSTs a URL + vault_id.
  2. We SSRF-validate the URL up front. A structural rejection here
     avoids creating an on-disk placeholder for a URL we'd never
     fetch anyway.
  3. We synthesize a tentative filename from the URL, then ask the
     core to create a placeholder ``.md`` with a ``status: fetching``
     frontmatter. The core owns the drive, so this is how we land a
     file in the user's vault while observing drive access control.
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
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_viewer_id
from app.database import get_db
from app.internal_client import InternalAPIError, InternalClient
from app.models import ClipJob, UserVault
from app.sanitize import build_frontmatter, slugify_filename
from app.schemas import ClipCreate, ClipJobOut, ClipPasted
from app.services.extractor import ExtractedArticle, extract_article, sanitize_pasted_html
from app.services.fetcher import BlockedURL, validate_url
from app.services.worker import ClipTask

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clips", tags=["clips"])


def _derive_slug_hint(url: str) -> str:
    parsed = urlparse(url)
    tail = (parsed.path.rstrip("/").split("/")[-1] or parsed.hostname or "clip")
    return tail[:80]


def _initial_content(url: str) -> str:
    fm = build_frontmatter({
        "url": url,
        "status": "fetching",
        "clipped_at": datetime.now(timezone.utc).isoformat(),
    })
    return fm + "\nFetching…\n"


def _compute_etag(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _ready_content(url: str, article: ExtractedArticle) -> str:
    fm = build_frontmatter({
        "url": url,
        "status": "ready",
        "title": article.title,
        "clipped_at": datetime.now(timezone.utc).isoformat(),
    })
    return fm + "\n" + article.markdown + "\n"


def _require_drive(drive: str | None) -> str:
    if not drive:
        raise HTTPException(status_code=400, detail="Drive context required")
    # Frontend percent-encodes the header so non-ASCII drive names
    # survive HTTP transit (header values are ISO-8859-1).
    return unquote(drive)


def _get_vault_or_404(
    db: Session, vault_id: int, viewer_id: str, drive: str
) -> UserVault:
    vault = db.query(UserVault).filter(
        UserVault.id == vault_id,
        UserVault.viewer_id == viewer_id,
        UserVault.drive == drive,
    ).first()
    if vault is None:
        raise HTTPException(status_code=404, detail="Vault not found")
    return vault


async def _create_placeholder(
    client: InternalClient, vault: UserVault, url: str
) -> tuple[dict, str]:
    """Create the fetching-state placeholder .md. Returns (file, etag)."""
    slug = slugify_filename(_derive_slug_hint(url), fallback_hint="clip")
    rel_path = f"{vault.path}/{slug}" if vault.path else slug
    content = _initial_content(url)
    try:
        created = await client.create_text_file(vault.drive, rel_path, content)
    except InternalAPIError as e:
        # 409: filename collision. Retry once with a timestamp suffix.
        if e.status_code == 409:
            ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            slug2 = slug[:-3] + f"-{ts}.md"
            rel_path = f"{vault.path}/{slug2}" if vault.path else slug2
            try:
                created = await client.create_text_file(
                    vault.drive, rel_path, content
                )
            except InternalAPIError as e2:
                raise HTTPException(status_code=502, detail=str(e2))
        else:
            raise HTTPException(status_code=502, detail=str(e))
    return created, _compute_etag(content)


@router.post("", response_model=ClipJobOut, status_code=202)
async def create_clip(
    body: ClipCreate,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
    x_hv_drive: Annotated[str | None, Header(alias="X-HV-Drive")] = None,
):
    drive = _require_drive(x_hv_drive)
    # Structural SSRF check. DNS-level checks also run in the worker,
    # but failing fast here keeps us from creating a placeholder for a
    # URL we'd never touch.
    try:
        validate_url(body.url)
    except BlockedURL as e:
        raise HTTPException(status_code=400, detail=f"URL rejected: {e}")

    vault = _get_vault_or_404(db, body.vault_id, viewer_id, drive)

    client = InternalClient(cookie_header=cookie)
    created, etag = await _create_placeholder(client, vault, body.url)

    job = ClipJob(
        file_id=created["id"],
        viewer_id=viewer_id,
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
        ))
    # Stash the initial etag on the job's error column? No — use a
    # dedicated handler that computes from content we just wrote.
    # Callers publish via on_done hook using InternalClient + PUT.

    return ClipJobOut(job_id=job.id, file_id=created["id"], status="fetching")


@router.post("/pasted", response_model=ClipJobOut, status_code=201)
async def create_clip_from_html(
    body: ClipPasted,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
    x_hv_drive: Annotated[str | None, Header(alias="X-HV-Drive")] = None,
):
    drive = _require_drive(x_hv_drive)
    # URL is metadata only here — we still validate it structurally so
    # the frontmatter doesn't get a garbage string.
    try:
        validate_url(body.url)
    except BlockedURL as e:
        raise HTTPException(status_code=400, detail=f"URL rejected: {e}")

    vault = _get_vault_or_404(db, body.vault_id, viewer_id, drive)

    # Sanitize and extract synchronously — no network involved.
    safe_html = sanitize_pasted_html(body.html)
    try:
        article = extract_article(safe_html, body.url)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Extract failed: {e}")

    client = InternalClient(cookie_header=cookie)
    created, initial_etag = await _create_placeholder(client, vault, body.url)

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
        url=body.url,
        status="ready",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    return ClipJobOut(job_id=job.id, file_id=created["id"], status="ready")
