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
  4. Keep the ``source_file_ids`` that live on this drive. Core derives
     relations from the note's own content, not from this list.
  5. INSERT ``note_origins`` + ``note_origin_sources`` as queryable cache.
  6. Emit ``knowledge.note.created`` WS event.
  7. Declare the note ``unverified`` when it holds an Ask answer.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import get_viewer_id
from app.credentials import CallerCredential
from app.database import get_db
from app.internal_client import InternalAPIError, InternalClient
from app.models import NoteOrigin, NoteOriginSource
from app.routers.distill import (
    _COLLISION_CAP,
    _created_rel_path,
    _join_path,
    _next_collision_candidate,
    _require_drive,
    _sanitise_filename,
    _sanitise_folder,
)
from app.schemas import DistillResponse, NoteCreate
from app.services.trust_declaration import ASK_INGEST_TIER

logger = logging.getLogger(__name__)

router = APIRouter(tags=["notes"])


async def _declare_unverified(
    client: InternalClient, db: Session, origin_row: NoteOrigin
) -> None:
    """Declare an Ask note unverified, or answer 502 once the note is saved.

    409 means the viewer already ruled on this file, and their decision
    stands, so it is an accepted outcome. A transport error is caught here
    instead of being left to the startup pass: the viewer has to be told the
    note exists but is not yet marked. Either way the row's column stays NULL
    until core accepts the declaration.
    """
    try:
        await client.declare_trust_tier(origin_row.note_file_id, ASK_INGEST_TIER)
    except InternalAPIError as e:
        if e.status_code != 409:
            raise HTTPException(
                status_code=502,
                detail=(
                    "Note saved but could not be marked unverified "
                    f"({e}). The next knowledge startup will declare it."
                ),
            )
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=(
                "Note saved but could not be marked unverified "
                f"({type(e).__name__}). The next knowledge startup will declare it."
            ),
        )

    origin_row.trust_declared_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/notes", response_model=DistillResponse, status_code=201)
async def create_note(
    body: NoteCreate,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
) -> DistillResponse:
    drive = _require_drive(x_hv_drive)

    client = InternalClient(credential=CallerCredential.from_request(request))

    filename = _sanitise_filename(body.filename)
    folder = _sanitise_folder(body.folder)

    # Write the .md with retry on path collision.
    created: dict | None = None
    final_filename = filename
    for attempt in range(1, _COLLISION_CAP + 1):
        rel_path = _join_path(folder, final_filename)
        try:
            created = await client.create_text_file(
                drive,
                rel_path,
                body.content,
                conflict_mode=body.conflict_mode,
            )
            break
        except InternalAPIError as e:
            if e.status_code == 409:
                if body.conflict_mode == "error":
                    raise HTTPException(status_code=409, detail="Path already exists")
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
    # Core owns collision resolution and may return ``name (1).md`` even
    # though the requested path was ``name.md``. Its response is the source
    # of truth for both the cache key and the path returned to the caller.
    note_rel_path = _created_rel_path(created)
    approved_at = datetime.now(timezone.utc)

    # Only same-drive sources enter note_origin_sources: drive is the
    # security boundary and that table is a reverse-lookup index.
    confirmed_source_ids: list[str] = []
    if body.source_file_ids:
        try:
            state = await client.fetch_bulk_state(body.source_file_ids)
        except InternalAPIError as e:
            logger.warning(
                "notes: source lookup failed viewer=%s note=%s: %s",
                viewer_id, note_file_id, e,
            )
        else:
            same_drive = {
                row["id"] for row in state.get("statuses", [])
                if row.get("drive") == drive
            }
            confirmed_source_ids = [
                src_id for src_id in dict.fromkeys(body.source_file_ids)
                if src_id in same_drive
            ]

    origin_row = NoteOrigin(
        drive=drive,
        note_path=note_rel_path,
        note_file_id=note_file_id,
        origin=body.origin,
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

    if body.origin == "ask_answer":
        await _declare_unverified(client, db, origin_row)

    return DistillResponse(
        note_file_id=note_file_id,
        note_path=note_rel_path,
    )
