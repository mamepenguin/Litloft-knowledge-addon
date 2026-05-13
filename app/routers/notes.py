"""Create a Knowledge note from pre-formatted Markdown content.

Used by the Ask → Knowledge save flow (spec
2026-05-06-knowledge-ask-citation-links.md). Unlike ``/distill`` (which
composes the Markdown from an intelligence detailed_summary), this
endpoint accepts a fully-composed ``content`` string from the frontend
and writes it verbatim into the drive.

Flow:
  1. Resolve drive from the ``X-Lit-Drive`` header.
  2. Resolve path, handle collisions.
  3. Write the .md via core ``POST /api/drives/{drive}/files``.
  4. Register ``file_relations`` for each ``source_file_id`` so citations
     are immediately visible as related files (subsequent PUT /content
     edits will keep them in sync via Phase 1 loft:// sync).
  5. INSERT ``note_origins`` + ``note_origin_sources`` as queryable cache.
  6. Emit ``knowledge.note.created`` WS event.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_viewer_id
from app.database import get_db
from app.internal_client import InternalAPIError, InternalClient
from app.models import NoteOrigin, NoteOriginSource
from app.routers.distill import (
    _COLLISION_CAP,
    _join_path,
    _next_collision_candidate,
    _require_drive,
    _sanitise_filename,
    _sanitise_folder,
)
from app.schemas import DistillResponse, NoteCreate

logger = logging.getLogger(__name__)

router = APIRouter(tags=["notes"])


@router.post("/notes", response_model=DistillResponse, status_code=201)
async def create_note(
    body: NoteCreate,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
) -> DistillResponse:
    drive = _require_drive(x_hv_drive)

    client = InternalClient(cookie_header=cookie)

    filename = _sanitise_filename(body.filename)
    folder = _sanitise_folder(body.folder)

    # Write the .md with retry on path collision.
    created: dict | None = None
    final_filename = filename
    for attempt in range(1, _COLLISION_CAP + 1):
        rel_path = _join_path(folder, final_filename)
        try:
            created = await client.create_text_file(drive, rel_path, body.content)
            break
        except InternalAPIError as e:
            if e.status_code == 409:
                final_filename = _next_collision_candidate(filename, attempt + 1)
                continue
            if e.status_code == 403:
                raise HTTPException(status_code=403, detail="Drive is read-only")
            raise HTTPException(status_code=502, detail=str(e))
    if created is None:
        raise HTTPException(
            status_code=409,
            detail="Too many filename collisions; choose a different name",
        )

    note_file_id = created["id"]
    note_rel_path = _join_path(folder, final_filename)
    approved_at = datetime.now(timezone.utc)

    # Register file_relations for each cited source file.
    # create_text_file goes through POST /drives/{drive}/files which does
    # not trigger the Phase 1 loft:// sync (that fires on PUT /content).
    # We seed the relations explicitly here so citations are immediately
    # visible; subsequent edits keep them in sync via Phase 1.
    # Only insert note_origin_sources for IDs whose relation succeeded —
    # this prevents cross-drive source_file_ids from leaking into the
    # reverse-lookup index (drive is the security boundary).
    confirmed_source_ids: list[str] = []
    for src_id in body.source_file_ids:
        try:
            await client.create_file_relation(
                file_id_a=src_id,
                file_id_b=note_file_id,
                kind="related",
                viewer_id=viewer_id,
            )
            confirmed_source_ids.append(src_id)
        except InternalAPIError as e:
            logger.warning(
                "notes: relation registration failed viewer=%s src=%s note=%s: %s",
                viewer_id, src_id, note_file_id, e,
            )

    origin_row = NoteOrigin(
        drive=drive,
        note_path=note_rel_path,
        note_file_id=note_file_id,
        origin="ask_answer",
        approved_at=approved_at,
        health="healthy",
    )
    db.add(origin_row)
    for src_id in confirmed_source_ids:
        db.add(
            NoteOriginSource(
                drive=drive,
                note_path=note_rel_path,
                source_file_id=src_id,
            )
        )
    db.commit()

    await client.emit_addon_event(
        "knowledge.note.created",
        {
            "note_file_id": note_file_id,
            "source_file_ids": body.source_file_ids,
        },
        drive=drive,
    )

    return DistillResponse(
        note_file_id=note_file_id,
        note_path=note_rel_path,
    )
