"""Notes that cite sources: which notes have any, and what they cite.

Home draws "Notes with sources" and the pane draws "Sources" from these two
routes. Both start from ``note_origins`` of the header drive, so a note or a
source on another drive is never read or answered.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Annotated
from urllib.parse import unquote

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import get_optional_viewer_id
from app.credentials import CallerCredential
from app.database import get_db
from app.internal_client import InternalAPIError, InternalClient
from app.models import NoteOrigin, NoteOriginSource
from app.routers.distill import _require_drive
from app.services import frontmatter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["notes-sources"])

MAX_NOTES = 60
_PARALLEL_READS = 8
_LOFT_LINK = re.compile(r"loft://([^\s?#)\]>\"']+)\?(t|page)=(\d+(?:\.\d+)?)")


class NotesWithSourcesResponse(BaseModel):
    ids: list[str]


class NotesSourcesRequest(BaseModel):
    file_ids: list[str] = Field(min_length=1, max_length=MAX_NOTES)


class NoteSource(BaseModel):
    source_file_id: str
    title: str
    filename: str
    folder_path: str
    mime_type: str
    has_thumbnail: bool
    locator: dict[str, float | int] | None = None


class NotesSourcesResponse(BaseModel):
    notes: dict[str, list[NoteSource]]


def _number(raw: str) -> int | float:
    return float(raw) if "." in raw else int(raw)


def _first_locators(body: str) -> dict[str, dict[str, float | int]]:
    found: dict[str, dict[str, float | int]] = {}
    for m in _LOFT_LINK.finditer(body):
        found.setdefault(m.group(1), {m.group(2): _number(m.group(3))})
    return found


def _frontmatter_source_ids(metadata: dict) -> list[str]:
    raw = metadata.get("source_file_ids")
    if not isinstance(raw, list):
        return []
    return [str(x) for x in raw if isinstance(x, (str, int)) and not isinstance(x, bool)]


def _dedupe(ids: list[str]) -> list[str]:
    return list(dict.fromkeys(ids))


@router.get("/notes/with-sources", response_model=NotesWithSourcesResponse)
async def notes_with_sources(
    db: Annotated[Session, Depends(get_db)],
    _viewer_id: Annotated[str | None, Depends(get_optional_viewer_id)],
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
) -> NotesWithSourcesResponse:
    drive = _require_drive(x_hv_drive)
    try:
        rows = (
            db.query(NoteOrigin.note_file_id)
            .join(
                NoteOriginSource,
                (NoteOriginSource.drive == NoteOrigin.drive)
                & (NoteOriginSource.note_path == NoteOrigin.note_path),
            )
            .filter(NoteOrigin.drive == drive)
            .distinct()
            .all()
        )
    except SQLAlchemyError as e:
        logger.warning("notes/with-sources: knowledge DB failed: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge index unavailable")
    return NotesWithSourcesResponse(ids=sorted(r[0] for r in rows))


@router.post("/notes/sources", response_model=NotesSourcesResponse)
async def notes_sources(
    body: NotesSourcesRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    _viewer_id: Annotated[str | None, Depends(get_optional_viewer_id)],
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
) -> NotesSourcesResponse:
    drive = unquote(_require_drive(x_hv_drive))
    note_ids = _dedupe(body.file_ids)

    try:
        origins = (
            db.query(NoteOrigin)
            .filter(NoteOrigin.drive == drive, NoteOrigin.note_file_id.in_(note_ids))
            .all()
        )
        # note_file_id -> (note_path, DB source ids in source_file_id order)
        known: dict[str, tuple[str, list[str]]] = {}
        for origin in origins:
            rows = (
                db.query(NoteOriginSource.source_file_id)
                .filter(
                    NoteOriginSource.drive == drive,
                    NoteOriginSource.note_path == origin.note_path,
                )
                .order_by(NoteOriginSource.source_file_id)
                .all()
            )
            known[origin.note_file_id] = (origin.note_path, [r[0] for r in rows])
    except SQLAlchemyError as e:
        logger.warning("notes/sources: knowledge DB failed: %s", e)
        raise HTTPException(status_code=503, detail="Knowledge index unavailable")

    kept_notes = [nid for nid in note_ids if nid in known]
    client = InternalClient(credential=CallerCredential.from_request(request))
    sem = asyncio.Semaphore(_PARALLEL_READS)

    async def read(note_id: str) -> tuple[list[str], dict[str, dict]]:
        async with sem:
            try:
                text = await client.get_file_text_content(note_id)
            except (InternalAPIError, httpx.HTTPError):
                logger.warning(
                    "notes/sources: content of note %s unreadable; "
                    "using the indexed sources without positions",
                    note_id,
                )
                return known[note_id][1], {}
        parsed = frontmatter.parse(text)
        return (
            _dedupe(_frontmatter_source_ids(parsed.metadata)),
            _first_locators(parsed.body),
        )

    reads = dict(zip(kept_notes, await asyncio.gather(*(read(n) for n in kept_notes))))

    wanted = _dedupe([sid for ids, _ in reads.values() for sid in ids])
    meta: dict[str, dict] = {}
    if wanted:
        try:
            bulk = await client.fetch_bulk_files(wanted)
        except (InternalAPIError, httpx.HTTPError) as e:
            logger.warning("notes/sources: files/bulk failed: %s", e)
            raise HTTPException(status_code=503, detail="File lookup unavailable")
        meta = {
            f["id"]: f for f in bulk.get("files", []) if f.get("drive") == drive
        }

    result: dict[str, list[NoteSource]] = {}
    for nid in kept_notes:
        source_ids, locators = reads[nid]
        result[nid] = [
            NoteSource(
                source_file_id=sid,
                title=meta[sid].get("title") or meta[sid].get("filename") or "",
                filename=meta[sid].get("filename") or "",
                folder_path=meta[sid].get("folder_path") or "",
                mime_type=meta[sid].get("mime_type") or "",
                has_thumbnail=bool(meta[sid].get("has_thumbnail")),
                locator=locators.get(sid),
            )
            for sid in source_ids
            if sid in meta
        ]
    return NotesSourcesResponse(notes=result)
