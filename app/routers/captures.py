from __future__ import annotations

import asyncio
import unicodedata
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import get_viewer_id
from app.credentials import CallerCredential
from app.database import get_db
from app.internal_client import InternalAPIError, InternalClient
from app.routers.distill import (
    _join_path,
    _require_drive,
    _sanitise_filename,
    _sanitise_folder,
)
from app.routers.notes import create_note
from app.schemas import (
    NoteCreate,
    SourceCaptureCommit,
    SourceCaptureCommitResponse,
    SourceCaptureItem,
)
from app.services.capture_markdown import append_captures, build_capture_note


router = APIRouter(tags=["captures"])
_quick_append_locks: dict[tuple[str, str], asyncio.Lock] = {}


def _normalize_etag(value: str) -> str:
    normalized = value.strip()
    if normalized.startswith("W/"):
        normalized = normalized[2:].strip()
    return normalized.strip('"')


def _map_core_error(error: InternalAPIError) -> HTTPException:
    if error.status_code in (401, 403):
        return HTTPException(status_code=error.status_code, detail="Access denied")
    if error.status_code in (404, 410):
        return HTTPException(status_code=404, detail="File not found")
    if error.status_code == 412:
        return HTTPException(status_code=412, detail="The note changed; reload and retry")
    if error.status_code == 415:
        return HTTPException(status_code=400, detail="Target must be a Markdown file")
    return HTTPException(status_code=502, detail="Core file operation failed")


async def _canonical_captures(
    client: InternalClient,
    drive: str,
    captures: list[SourceCaptureItem],
) -> list[SourceCaptureItem]:
    metadata: dict[str, dict] = {}
    for capture in captures:
        if capture.source_file_id in metadata:
            continue
        try:
            file = await client.get_public_file(capture.source_file_id)
        except InternalAPIError as error:
            raise _map_core_error(error) from error
        if file.get("drive") != drive:
            raise HTTPException(status_code=404, detail="File not found")
        metadata[capture.source_file_id] = file

    return [
        capture.model_copy(
            update={
                "filename": metadata[capture.source_file_id].get("filename")
                or capture.filename,
                "file_type": metadata[capture.source_file_id].get("file_type")
                or capture.file_type,
            }
        )
        for capture in captures
    ]


async def _append_to_file(
    client: InternalClient,
    drive: str,
    target: dict,
    captures: list[SourceCaptureItem],
    expected_etag: str | None = None,
) -> SourceCaptureCommitResponse:
    if target.get("drive") != drive:
        raise HTTPException(status_code=404, detail="File not found")
    if target.get("mime_type") != "text/markdown":
        raise HTTPException(status_code=400, detail="Target must be a Markdown file")

    try:
        current, current_etag = await client.get_file_content_with_etag(target["id"])
        if expected_etag is not None and (
            _normalize_etag(current_etag) != _normalize_etag(expected_etag)
        ):
            raise HTTPException(
                status_code=412,
                detail="The note changed; reload and retry",
            )
        updated = append_captures(current, captures)
        new_etag = await client.put_file_content(
            target["id"],
            updated,
            current_etag,
        )
    except InternalAPIError as error:
        raise _map_core_error(error) from error

    return SourceCaptureCommitResponse(
        note_file_id=target["id"],
        note_path=target.get("file_path")
        or "/".join(
            value
            for value in (target.get("folder_path"), target.get("filename"))
            if value
        ),
        etag=new_etag,
        committed=len(captures),
    )


@router.post("/captures/commit", response_model=SourceCaptureCommitResponse)
async def commit_captures(
    body: SourceCaptureCommit,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
) -> SourceCaptureCommitResponse:
    drive = _require_drive(x_hv_drive)
    client = InternalClient(credential=CallerCredential.from_request(request))
    captures = await _canonical_captures(client, drive, body.captures)
    source_ids = list(dict.fromkeys(item.source_file_id for item in captures))

    if body.target.mode == "quick":
        folder = _sanitise_folder(body.target.folder)
        filename = _sanitise_filename(body.target.filename or "Inbox.md")
        note_path = unicodedata.normalize("NFC", _join_path(folder, filename))
        lock = _quick_append_locks.setdefault((drive, note_path), asyncio.Lock())

        async with lock:
            try:
                target = await client.get_drive_file_by_path(drive, note_path)
            except InternalAPIError as error:
                raise _map_core_error(error) from error
            if target is not None:
                return await _append_to_file(client, drive, target, captures)

            title = (body.target.title or filename.removesuffix(".md")).strip()
            content = build_capture_note(title, captures)
            try:
                created = await create_note(
                    NoteCreate(
                        folder=folder,
                        filename=filename,
                        content=content,
                        source_file_ids=source_ids,
                        origin="source_capture",
                        conflict_mode="error",
                    ),
                    request,
                    db,
                    viewer_id,
                    drive,
                )
                return SourceCaptureCommitResponse(
                    note_file_id=created.note_file_id,
                    note_path=created.note_path,
                    committed=len(captures),
                )
            except HTTPException as error:
                if error.status_code != 409:
                    raise

            try:
                target = await client.get_drive_file_by_path(drive, note_path)
            except InternalAPIError as error:
                raise _map_core_error(error) from error
            if target is None:
                raise HTTPException(status_code=409, detail="Path already exists")
            return await _append_to_file(client, drive, target, captures)

    if body.target.mode == "new":
        title = (body.target.title or "Captured sources").strip()
        filename = (body.target.filename or title or "captured-sources").strip()
        content = build_capture_note(title, captures)
        created = await create_note(
            NoteCreate(
                folder=body.target.folder,
                filename=filename,
                content=content,
                source_file_ids=source_ids,
                origin="source_capture",
            ),
            request,
            db,
            viewer_id,
            drive,
        )
        return SourceCaptureCommitResponse(
            note_file_id=created.note_file_id,
            note_path=created.note_path,
            committed=len(captures),
        )

    if not body.target.file_id or not body.target.etag:
        raise HTTPException(
            status_code=422,
            detail="Existing target requires file_id and etag",
        )

    try:
        target = await client.get_public_file(body.target.file_id)
    except InternalAPIError as error:
        raise _map_core_error(error) from error
    return await _append_to_file(
        client,
        drive,
        target,
        captures,
        expected_etag=body.target.etag,
    )
