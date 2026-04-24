"""Tags resync endpoint for the knowledge addon.

Triggered by the frontend after it writes new frontmatter via
``PUT /api/files/{id}/content`` (spec §D5). Without this endpoint the
user would have to wait up to an hour for the periodic scanner to
project the new tags onto core ``File.tags``.

Access control is provided by the host addon proxy's ``file_access``
pre_check (manifest.json route entry). The proxy verifies the viewer
has drive access to ``file_id`` before forwarding the request, so this
handler can trust the caller is authorised.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Header
from sqlalchemy.orm import Session

from app.database import session_scope
from app.internal_client import InternalAPIError, InternalClient
from app.models import NoteOrigin
from app.services.frontmatter import parse as parse_frontmatter
from app.services.note_scanner import project_tags_from_frontmatter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tags"])


@router.post("/resync-tags/{file_id}")
async def resync_tags(
    file_id: str,
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
) -> dict:
    """Re-parse a ``.md``'s frontmatter and push its ``tags:`` to core.

    Returns ``{"file_id": ..., "tags": [...]}`` on success. The returned
    tag list is the post-filter result (core-valid names only), which
    the caller can use to update its optimistic UI.

    Failure modes:
    - 404 if the file is missing, trashed, or on a drive the caller
      can't access (handled by the proxy's ``file_access`` pre_check
      before we run).
    - 400 if the file is not text content (e.g. ``.mp4``). We don't
      synthesise frontmatter for non-text files.
    - 502 if core rejects the tag list (e.g. 422 from a malformed tag
      that slipped past our local filter). The scanner will retry
      later via ``tags_synced_at`` remaining NULL.
    """
    client = InternalClient(cookie_header=cookie)
    try:
        content = await client.get_file_text_content(file_id)
    except InternalAPIError as exc:
        if exc.status_code == 404:
            raise HTTPException(status_code=404, detail="File not found")
        if exc.status_code == 415:
            # Core's content endpoint returns 415 for non-text mimes.
            raise HTTPException(status_code=400, detail="File is not text content")
        logger.warning(
            "resync-tags: content fetch failed file=%s status=%d",
            file_id,
            exc.status_code,
        )
        raise HTTPException(status_code=502, detail="Core unavailable")

    parsed = parse_frontmatter(content)
    tags, ok = await project_tags_from_frontmatter(
        client,
        file_id,
        parsed.metadata,
        log_context=f"resync file={file_id}",
    )
    if not ok:
        raise HTTPException(status_code=502, detail="Tag sync rejected by core")

    # Mark note_origins.tags_synced_at if this file is a tracked note.
    # Not all ``.md`` files are tracked (only distilled / clipped notes
    # get note_origin rows). Updating missing rows is a no-op.
    with session_scope() as session:
        _bump_tags_synced_at(session, file_id)

    return {"file_id": file_id, "tags": tags}


def _bump_tags_synced_at(session: Session, file_id: str) -> None:
    """Set ``tags_synced_at = now`` for every note_origin referencing
    this ``file_id``. No-op when the file isn't a tracked note."""
    rows = (
        session.query(NoteOrigin)
        .filter(NoteOrigin.note_file_id == file_id)
        .all()
    )
    now = datetime.now(UTC)
    for row in rows:
        row.tags_synced_at = now
