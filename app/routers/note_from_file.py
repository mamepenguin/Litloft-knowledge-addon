"""Create a Knowledge note pre-linked to an existing file.

Flow:
  1. Resolve drive from the ``X-Lit-Drive`` header.
  2. Verify the source file exists and lives on the same drive (drive boundary).
  3. Compose initial frontmatter: ``source_file_ids: [source_file_id]``.
  4. Write the ``.md`` via core ``POST /api/drives/{drive}/files`` with
     collision retry (same pattern as ``distill.py``).
  5. Register ``file_relations`` (kind="related") via Internal API so the
     relation is immediately visible without waiting for a PUT /content edit
     to trigger Phase 1 sync.
  6. Return ``{ note_file_id, note_path }``.

The core's ``_sync_md_file_relations`` reads ``source_file_ids`` from
frontmatter on every ``PUT /content``, so the relation is maintained as long
as the frontmatter key is present — regardless of body content.
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException

from app.auth import get_viewer_id
from app.internal_client import InternalAPIError, InternalClient
from app.routers.distill import (
    _COLLISION_CAP,
    _join_path,
    _next_collision_candidate,
    _require_drive,
    _sanitise_filename,
    _sanitise_folder,
)
from app.schemas import NoteFromFileRequest, NoteFromFileResponse
from app.services.frontmatter import compose

logger = logging.getLogger(__name__)

router = APIRouter(tags=["note-from-file"])


def _build_initial_content(source_file_id: str) -> str:
    """Frontmatter-only initial content linking to ``source_file_id``."""
    return compose({"source_file_ids": [source_file_id]}, "")


@router.post("/note-from-file", response_model=NoteFromFileResponse, status_code=201)
async def create_note_from_file(
    body: NoteFromFileRequest,
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
) -> NoteFromFileResponse:
    drive = _require_drive(x_hv_drive)

    client = InternalClient(cookie_header=cookie)

    # Verify source file exists and belongs to this drive.
    try:
        source_info = await client.get_file(body.source_file_id)
    except InternalAPIError as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail="Source file not found")
        raise HTTPException(status_code=502, detail=str(e))
    if source_info.get("drive") != drive:
        raise HTTPException(
            status_code=400, detail="Source file lives on a different drive"
        )

    filename = _sanitise_filename(body.filename)
    folder = _sanitise_folder(body.folder)
    content = _build_initial_content(body.source_file_id)

    # Write the .md with retry on path collision.
    created: dict | None = None
    final_filename = filename
    for attempt in range(1, _COLLISION_CAP + 1):
        rel_path = _join_path(folder, final_filename)
        try:
            created = await client.create_text_file(drive, rel_path, content)
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

    # Seed file_relations immediately. POST /drives/{drive}/files does not
    # trigger Phase 1 sync (that fires on PUT /content), so we register the
    # relation explicitly. Subsequent saves keep it in sync via frontmatter.
    try:
        await client.create_file_relation(
            file_id_a=body.source_file_id,
            file_id_b=note_file_id,
            kind="related",
            viewer_id=viewer_id,
        )
    except InternalAPIError as e:
        logger.warning(
            "note-from-file: .md written but relation seed failed "
            "source=%s note=%s: %s",
            body.source_file_id, note_file_id, e,
        )
        raise HTTPException(status_code=502, detail=str(e))

    await client.emit_addon_event(
        "knowledge.note.created",
        {
            "note_file_id": note_file_id,
            "source_file_ids": [body.source_file_id],
        },
        drive=drive,
    )

    return NoteFromFileResponse(
        note_file_id=note_file_id,
        note_path=note_rel_path,
    )
