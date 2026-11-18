"""Each clip's cover image and source site, read from the start of the file.

Nothing is stored: the answer is derived from text already in the drive.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Annotated
from urllib.parse import unquote, urlsplit

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.auth import get_optional_viewer_id
from app.credentials import CallerCredential
from app.internal_client import InternalAPIError, InternalClient
from app.schemas import ClipCover, ClipCoversRequest, ClipCoversResponse
from app.services import frontmatter
from app.services.textsearch import TEXT_MIMES

logger = logging.getLogger(__name__)

router = APIRouter(tags=["clip-covers"])

MAX_IDS = 60
OPENING_BYTES = 4096
_PARALLEL_FETCHES = 8

_IMAGE = re.compile(r"!\[[^\]]*\]\(\s*<?([^\s)>]*)>?(?:\s+\"[^\"]*\")?\s*\)")
_URL = re.compile(r"https?://[^\s<>()\[\]\"'`]+", re.IGNORECASE)
_HTML_IMG = re.compile(r"<img\b[^>]*>?", re.IGNORECASE)
_LOFT = re.compile(r"^loft://([A-Za-z0-9_-]+)/?(?:[?#].*)?$")
# A bare URL ends at the sentence's punctuation, not with it.
_URL_TAIL = ".,;:!?*_"


def _host(url: str) -> str | None:
    try:
        parts = urlsplit(url.strip())
        host = parts.hostname
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https") or not host:
        return None
    host = host.lower()
    if host.startswith("www."):
        host = host[4:]
    return host or None


def extract_cover(text: str) -> tuple[str | None, str | None, str | None]:
    """Return ``(loft_id, image_url, site)`` for a clip's opening text."""
    parsed = frontmatter.parse(text)
    body = parsed.body

    loft_id: str | None = None
    image_url: str | None = None
    first = _IMAGE.search(body)
    if first:
        target = first.group(1)
        m = _LOFT.match(target)
        if m:
            loft_id = m.group(1)
        elif _host(target):
            image_url = target

    site: str | None = None
    fm_url = parsed.metadata.get("url")
    if isinstance(fm_url, str):
        site = _host(fm_url)
    if site is None:
        for m in _URL.finditer(_HTML_IMG.sub(" ", _IMAGE.sub(" ", body))):
            site = _host(m.group(0).rstrip(_URL_TAIL))
            if site:
                break
    return loft_id, image_url, site


@router.post("/clip-covers", response_model=ClipCoversResponse)
async def clip_covers(
    body: ClipCoversRequest,
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
        return ClipCoversResponse(covers={})

    drive = unquote(x_hv_drive)
    client = InternalClient(credential=CallerCredential.from_request(request))
    try:
        readable = await client.filter_file_ids(body.file_ids)
        meta = await client.fetch_bulk_files(readable)
    except (InternalAPIError, httpx.HTTPError) as e:
        raise HTTPException(status_code=502, detail=str(e))
    kept = [
        f["id"]
        for f in meta.get("files", [])
        if f.get("drive") == drive and f.get("mime_type") in TEXT_MIMES
    ]

    sem = asyncio.Semaphore(_PARALLEL_FETCHES)

    async def read(file_id: str) -> tuple[str, tuple | None]:
        async with sem:
            try:
                text = await client.get_file_opening(file_id, OPENING_BYTES)
            except (InternalAPIError, httpx.HTTPError):
                return file_id, None
        return file_id, extract_cover(text)

    found = dict(await asyncio.gather(*(read(i) for i in kept)))

    loft_ids = sorted({r[0] for r in found.values() if r and r[0]})
    images: set[str] = set()
    if loft_ids:
        try:
            image_meta = await client.fetch_bulk_files(loft_ids)
        except (InternalAPIError, httpx.HTTPError):
            image_meta = {"files": []}
        images = {
            f["id"]
            for f in image_meta.get("files", [])
            if f.get("drive") == drive and f.get("file_type") == "image"
        }

    covers = {}
    for fid in kept:
        r = found[fid]
        if r is None:
            covers[fid] = ClipCover()
            continue
        loft_id, image_url, site = r
        covers[fid] = ClipCover(
            image_id=loft_id if loft_id in images else None,
            image_url=image_url,
            site=site,
        )
    return ClipCoversResponse(covers=covers)
