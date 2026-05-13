"""Promote an intelligence detailed_summary (or similar) into a Knowledge note.

Flow:

  1. Resolve drive from the ``X-Lit-Drive`` header.
  2. Look up the source file via core Internal API and require same drive.
  3. Compose frontmatter + body markdown.
  4. Resolve path collisions by appending ``-2``, ``-3``, … to the stem
     until ``POST /api/drives/{drive}/files`` stops returning 409.
  5. Register ``file_relations`` (kind="related") and
     ``file_active_summaries`` via core Internal API.
  6. INSERT ``note_origins`` + ``note_origin_sources`` as a queryable
     cache — the real source of truth is the ``.md`` frontmatter.

The distill endpoint is sync: the caller gets back the new file_id only
after core has indexed the note, so the client can immediately navigate
or refresh the summary slot. Core's ``POST /api/drives/{drive}/files``
performs the DB INSERT synchronously (same pattern as webclip).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_viewer_id
from app.database import get_db
from app.internal_client import InternalAPIError, InternalClient
from app.models import (
    FileActiveSummary,
    NoteOrigin,
    NoteOriginSource,
)
from app.schemas import DistillRequest, DistillResponse, NoteOriginOut
from app.services.frontmatter import compose, iso_z

logger = logging.getLogger(__name__)

router = APIRouter(tags=["distill"])

_COLLISION_CAP = 50
_FILENAME_UNSAFE = re.compile(r"[\\/\x00]")


def _require_drive(drive: str | None) -> str:
    if not drive:
        raise HTTPException(status_code=400, detail="Drive context required")
    return unquote(drive)


def _sanitise_filename(name: str) -> str:
    """Reject path-escape attempts; guarantee a ``.md`` suffix."""
    if _FILENAME_UNSAFE.search(name):
        raise HTTPException(status_code=400, detail="Invalid filename")
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Filename is required")
    if not name.endswith(".md"):
        name = name + ".md"
    return name


def _sanitise_folder(folder: str) -> str:
    """Normalise folder to a forward-slash relative path with no leading/trailing slash."""
    folder = folder.strip().strip("/")
    if "\\" in folder or "\x00" in folder:
        raise HTTPException(status_code=400, detail="Invalid folder")
    # Reject traversal up-front; core ``create_text_file`` also rejects but
    # we want to fail fast with a clean message.
    parts = [p for p in folder.split("/") if p]
    for p in parts:
        if p in {".", ".."}:
            raise HTTPException(status_code=400, detail="Invalid folder")
    return "/".join(parts)


def _join_path(folder: str, filename: str) -> str:
    pieces: list[str] = []
    if folder:
        pieces.append(folder)
    pieces.append(filename)
    return "/".join(p for p in pieces if p)


def _next_collision_candidate(filename: str, n: int) -> str:
    """``foo.md`` + n=2 → ``foo-2.md``. Preserves the extension."""
    stem = PurePosixPath(filename).stem
    # Strip any existing trailing ``-<digits>`` we ourselves appended on an earlier loop.
    base_stem = re.sub(r"-\d+$", "", stem)
    return f"{base_stem}-{n}.md"


def _compose_markdown(
    *,
    title: str,
    content: str,
    source_file_id: str,
    origin: str,
    approved_at: datetime,
) -> str:
    metadata: dict[str, object] = {
        "origin": origin,
        "source_file_ids": [source_file_id],
        "created": iso_z(approved_at),
    }

    body_pieces: list[str] = []
    if title:
        body_pieces.append(f"# {title}")
        body_pieces.append("")
    body = content.lstrip("\n")
    body_pieces.append(body)
    body_text = "\n".join(body_pieces)
    if not body_text.endswith("\n"):
        body_text += "\n"
    return compose(metadata, body_text)


@router.post("/distill", response_model=DistillResponse, status_code=201)
async def distill(
    body: DistillRequest,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
) -> DistillResponse:
    drive = _require_drive(x_hv_drive)

    client = InternalClient(cookie_header=cookie)

    # Verify the source file exists and lives on this drive. ``get_file``
    # uses the internal endpoint which already filters out trash/missing.
    try:
        source_info = await client.get_file(body.source_file_id)
    except InternalAPIError as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail="Source file not found")
        raise HTTPException(status_code=502, detail=str(e))
    if source_info.get("drive") != drive:
        # Cross-drive promotion violates the drive boundary rule.
        raise HTTPException(
            status_code=400, detail="Source file lives on a different drive"
        )

    filename = _sanitise_filename(body.filename)
    folder = _sanitise_folder(body.folder)

    approved_at = datetime.now(timezone.utc)
    markdown = _compose_markdown(
        title=body.title,
        content=body.content,
        source_file_id=body.source_file_id,
        origin=body.origin,
        approved_at=approved_at,
    )

    # Write the .md with retry on path collision. Core returns 409 for
    # an existing active/trashed file at the same path; we bump the
    # stem and try again. The cap prevents runaway loops on bugs.
    created: dict | None = None
    final_filename = filename
    for attempt in range(1, _COLLISION_CAP + 1):
        rel_path = _join_path(folder, final_filename)
        try:
            created = await client.create_text_file(drive, rel_path, markdown)
            break
        except InternalAPIError as e:
            if e.status_code == 409:
                final_filename = _next_collision_candidate(filename, attempt + 1)
                continue
            if e.status_code == 403:
                raise HTTPException(
                    status_code=403, detail="Drive is read-only"
                )
            raise HTTPException(status_code=502, detail=str(e))
    if created is None:
        raise HTTPException(
            status_code=409,
            detail="Too many filename collisions; choose a different name",
        )

    note_file_id = created["id"]
    note_rel_path = _join_path(folder, final_filename)

    # Register the relation in core. If it fails after the .md is
    # already written, surface a 502 — the file is harmless on its own
    # and can be re-promoted or cleaned up manually. We don't rollback
    # the .md because it is user-owned data from the moment the write
    # succeeded.
    try:
        await client.create_file_relation(
            file_id_a=body.source_file_id,
            file_id_b=note_file_id,
            kind="related",
            viewer_id=viewer_id,
        )
    except InternalAPIError as e:
        logger.warning(
            "distill: .md written but relation registration failed: %s", e
        )
        raise HTTPException(status_code=502, detail=str(e))

    # active_summary pointer lives in knowledge.db now (spec
    # 2026-04-30-file-active-summary-to-knowledge). UPSERT in the same
    # transaction as note_origins below so a single commit covers both
    # the cache and the pointer.
    pointer = (
        db.query(FileActiveSummary)
        .filter(FileActiveSummary.target_file_id == body.source_file_id)
        .first()
    )
    if pointer is None:
        db.add(
            FileActiveSummary(
                target_file_id=body.source_file_id,
                drive=drive,
                summary_note_id=note_file_id,
            )
        )
    else:
        pointer.drive = drive
        pointer.summary_note_id = note_file_id
        pointer.set_at = datetime.now(timezone.utc)

    origin_row = NoteOrigin(
        drive=drive,
        note_path=note_rel_path,
        note_file_id=note_file_id,
        origin=body.origin,
        approved_at=approved_at,
        health="healthy",
    )
    db.add(origin_row)
    db.add(
        NoteOriginSource(
            drive=drive,
            note_path=note_rel_path,
            source_file_id=body.source_file_id,
        )
    )
    db.commit()

    await client.emit_addon_event(
        "knowledge.active_summary.changed",
        {
            "file_id": body.source_file_id,
            "summary_file_id": note_file_id,
        },
        drive=drive,
    )
    await client.emit_addon_event(
        "knowledge.distilled.created",
        {
            "note_file_id": note_file_id,
            "source_file_id": body.source_file_id,
        },
        drive=drive,
    )

    return DistillResponse(
        note_file_id=note_file_id,
        note_path=note_rel_path,
    )


@router.get(
    "/notes/by_source_file/{source_file_id}",
    response_model=list[NoteOriginOut],
)
async def notes_by_source_file(
    source_file_id: str,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
) -> list[NoteOriginOut]:
    """Return every Knowledge note that references ``source_file_id``.

    Only notes on the current drive are considered — cross-drive lookups
    are silently empty even if the frontend happens to know a file id
    from another drive. This preserves the drive-boundary rule
    (hako `cRNeIvcbhz449BwTmof5m`).
    """
    drive = _require_drive(x_hv_drive)

    rows = (
        db.query(NoteOrigin)
        .join(
            NoteOriginSource,
            (NoteOriginSource.drive == NoteOrigin.drive)
            & (NoteOriginSource.note_path == NoteOrigin.note_path),
        )
        .filter(
            NoteOriginSource.source_file_id == source_file_id,
            NoteOrigin.drive == drive,
        )
        .all()
    )

    return [
        NoteOriginOut(
            note_file_id=origin.note_file_id,
            drive=origin.drive,
            path=origin.note_path,
            origin=origin.origin,
            approved_at=origin.approved_at,
            health=origin.health,
        )
        for origin in rows
    ]
