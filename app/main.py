"""FastAPI entry point for the knowledge addon.

Routers loaded per phase:
  P3  vaults
  P5  clips (+ background worker for SSRF-safe fetch pipeline)
  P7  search (planned)
"""
import hashlib
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI

from app.database import init_schema
from app.internal_client import InternalAPIError, InternalClient
from app.routers import clips, distill, search, vaults
from app.sanitize import build_frontmatter
from app.services.extractor import ExtractedArticle
from app.services.worker import ClipTask, ClipWorker

logger = logging.getLogger(__name__)

_worker: Optional[ClipWorker] = None


def get_worker() -> Optional[ClipWorker]:
    """Accessor for routers that need to enqueue work. ``None`` during
    tests that bypass the lifespan setup."""
    return _worker


async def _publish_clip(task: ClipTask, article: ExtractedArticle) -> None:
    """Write the ready Markdown back to the core.

    WS emission is stubbed until the core exposes an addon event bus;
    for now we log and leave the file in place so the UI can pick it up
    on next refresh.
    """
    client = InternalClient(cookie_header=task.cookie_header)
    try:
        current = await client.get_file_content(task.file_id)
    except InternalAPIError as e:
        logger.warning("fetch current content failed file_id=%s: %s", task.file_id, e)
        return

    current_etag = hashlib.sha256(current.encode("utf-8")).hexdigest()
    fm = build_frontmatter({
        "url": task.url,
        "status": "ready",
        "title": article.title,
        "clipped_at": datetime.now(timezone.utc).isoformat(),
    })
    new_content = fm + "\n" + article.markdown + "\n"

    try:
        await client.put_file_content(
            task.file_id, new_content, f'"{current_etag}"'
        )
    except InternalAPIError as e:
        # 412 here means user (or scanner) touched the file mid-fetch.
        # We don't overwrite — the fetching placeholder stays as-is.
        logger.warning("publish clip failed file_id=%s: %s", task.file_id, e)


async def _publish_fail(task: ClipTask, reason: str) -> None:
    logger.warning("clip fail file_id=%s reason=%s", task.file_id, reason)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_schema()
    logger.info("knowledge addon: schema initialized")

    global _worker
    _worker = ClipWorker(on_done=_publish_clip, on_fail=_publish_fail)
    _worker.start()
    for task in _worker.reclaim_stale_jobs():
        await _worker.enqueue(task)
    logger.info("knowledge addon: worker started")

    try:
        yield
    finally:
        if _worker is not None:
            await _worker.stop()
            _worker = None


app = FastAPI(
    title="HomeVault Knowledge Addon",
    description="Notes and web clips — personal knowledge hub for HomeVault",
    lifespan=lifespan,
)

app.include_router(vaults.router)
app.include_router(clips.router)
app.include_router(distill.router)
app.include_router(search.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
