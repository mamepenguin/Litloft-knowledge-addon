"""The notes' opening text, fetched once per listing.

A row that fetched its own opening grew when the answer arrived and
pushed every row under it down.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Annotated
from urllib.parse import unquote

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.auth import get_optional_viewer_id
from app.credentials import CallerCredential
from app.internal_client import InternalAPIError, InternalClient
from app.schemas import NoteOpeningsRequest, NoteOpeningsResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["note-openings"])

MAX_IDS = 200
OPENING_CHARS = 1024
# A character is at most four bytes, and the answer is cut to
# ``OPENING_CHARS`` after decoding.
OPENING_BYTES = OPENING_CHARS * 4
_PARALLEL_FETCHES = 8
# Notes are text. Anything else in the same drive would come back as a
# kilobyte of replacement characters.
_TEXT_MIMES = frozenset({"text/markdown", "text/plain"})


@router.post("/note-openings", response_model=NoteOpeningsResponse)
async def note_openings(
    body: NoteOpeningsRequest,
    request: Request,
    viewer_id: Annotated[str | None, Depends(get_optional_viewer_id)] = None,
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
):
    if not x_hv_drive:
        raise HTTPException(status_code=400, detail="Drive context required")
    if len(body.file_ids) > MAX_IDS:
        raise HTTPException(
            status_code=422, detail=f"At most {MAX_IDS} files per request"
        )
    if not body.file_ids:
        return NoteOpeningsResponse(openings={})

    drive = unquote(x_hv_drive)
    client = InternalClient(credential=CallerCredential.from_request(request))
    try:
        readable = await client.filter_file_ids(body.file_ids)
        # The listing this answers is one drive's. A file the caller can
        # read elsewhere is still not part of it.
        meta = await client.fetch_bulk_files(readable)
    except (InternalAPIError, httpx.HTTPError) as e:
        raise HTTPException(status_code=502, detail=str(e))
    readable_here = [
        f["id"]
        for f in meta.get("files", [])
        if f.get("drive") == drive and f.get("mime_type") in _TEXT_MIMES
    ]

    sem = asyncio.Semaphore(_PARALLEL_FETCHES)

    async def opening(file_id: str) -> tuple[str, str] | None:
        async with sem:
            try:
                text = await client.get_file_opening(file_id, OPENING_BYTES)
            except (InternalAPIError, httpx.HTTPError):
                # One file nobody can read must not cost the listing its
                # other openings.
                return None
        return file_id, text[:OPENING_CHARS]

    results = await asyncio.gather(*(opening(i) for i in readable_here))
    return NoteOpeningsResponse(
        openings={fid: text for pair in results if pair for fid, text in (pair,)}
    )
