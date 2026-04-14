"""Vault-scoped full-text search.

This is a substring search, not a search index — small personal vaults
don't need a Lucene. We list the vault's files via the core, fetch each
one's content, strip frontmatter, and test for the query. Results are
capped so a runaway vault can't wedge the worker event loop.

Per spec, the Generic Addon Proxy filters ``results[].file_id`` against
the viewer's drive access as a defense-in-depth; we rely on the
Internal API already enforcing access control, but return file_ids
verbatim so the proxy's nested filter can still run.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import get_viewer_id
from app.database import get_db
from app.internal_client import InternalAPIError, InternalClient
from app.models import UserVault
from app.schemas import SearchHit, SearchResponse
from app.services.textsearch import find_snippet, matches, strip_frontmatter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/search", tags=["search"])

_MAX_SCAN_FILES = 500
_MAX_RESULTS = 50
_PARALLEL_FETCHES = 8
_TEXT_MIMES = frozenset({"text/markdown", "text/plain"})


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


async def _fetch_and_match(
    client: InternalClient,
    file: dict,
    query: str,
    sem: asyncio.Semaphore,
) -> SearchHit | None:
    async with sem:
        try:
            content = await client.get_file_content(file["id"])
        except InternalAPIError:
            return None
    body = strip_frontmatter(content)
    if not matches(body, query):
        return None
    snippet = find_snippet(body, query)
    return SearchHit(
        file_id=file["id"],
        filename=file.get("filename", ""),
        title=file.get("title") or file.get("filename", ""),
        snippet=(snippet.text if snippet else ""),
    )


@router.get("", response_model=SearchResponse)
async def search_vault(
    vault_id: int = Query(..., ge=1),
    q: str = Query(..., min_length=1, max_length=200),
    db: Session = Depends(get_db),
    viewer_id: str = Depends(get_viewer_id),
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
    x_hv_drive: Annotated[str | None, Header(alias="X-HV-Drive")] = None,
):
    drive = _require_drive(x_hv_drive)
    vault = _get_vault_or_404(db, vault_id, viewer_id, drive)

    client = InternalClient(cookie_header=cookie)
    try:
        all_files = await client.list_drive_files(
            vault.drive, vault.path, limit=_MAX_SCAN_FILES
        )
    except InternalAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))

    # Restrict to text files before paying the download cost
    text_files = [f for f in all_files if f.get("mime_type") in _TEXT_MIMES]
    truncated = len(all_files) >= _MAX_SCAN_FILES

    sem = asyncio.Semaphore(_PARALLEL_FETCHES)
    tasks = [
        _fetch_and_match(client, f, q, sem) for f in text_files
    ]
    raw = await asyncio.gather(*tasks)
    hits = [h for h in raw if h is not None]
    if len(hits) > _MAX_RESULTS:
        hits = hits[:_MAX_RESULTS]
        truncated = True

    return SearchResponse(
        query=q, vault_id=vault_id, results=hits, truncated=truncated
    )
