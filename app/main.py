"""FastAPI entry point for the knowledge addon.

Routers loaded per phase:
  P3  vaults
  P5  clips (+ background worker for SSRF-safe fetch pipeline)
  P7  search (planned)
"""
import asyncio
import hashlib
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI

from app.database import init_schema
from app.internal_client import InternalAPIError, InternalClient
from app.routers import (
    active_summary,
    clips,
    distill,
    notes,
    search,
    tags,
    vaults,
    webhooks,
)
from app.sanitize import build_frontmatter, slugify_filename
from app.services.extractor import ExtractedArticle
from app.services.frontmatter import iso_z
from app.services.note_scanner import scanner_loop
from app.services.worker import ClipTask, ClipWorker

logger = logging.getLogger(__name__)

_worker: Optional[ClipWorker] = None
_scanner_task: Optional[asyncio.Task] = None


def get_worker() -> Optional[ClipWorker]:
    """Accessor for routers that need to enqueue work. ``None`` during
    tests that bypass the lifespan setup."""
    return _worker


async def _publish_clip(task: ClipTask, article: ExtractedArticle) -> None:
    """Write the ready Markdown back to core, rename by title, emit WS.

    Three steps, each independently best-effort:

    1. PUT the ``status: ready`` Markdown over the placeholder with an
       ``If-Match`` guarded against mid-fetch edits. A 412 here means the
       user (or scanner) touched the file mid-fetch — we leave the
       placeholder in place rather than overwrite.
    2. Rename the file to a title-derived slug. Failure is swallowed
       because the content write already succeeded and the user can
       rename manually.
    3. Broadcast ``knowledge.clip.ready`` via the core's WS bridge so
       open UIs refresh the file list. Scoped to the owning drive so
       protected-drive clips don't leak to other viewers.
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
        "origin": "webclip",
        "created": iso_z(datetime.now(timezone.utc)),
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
        return

    if article.title:
        new_filename = slugify_filename(article.title, fallback_hint="clip")
        try:
            await client.rename_file(task.file_id, new_filename)
        except InternalAPIError as e:
            # Rename is a nice-to-have; 409 (filename collision) and 401
            # (reclaimed job without cookie) both fall here.
            logger.info(
                "rename-on-title skipped file_id=%s: %s", task.file_id, e
            )

    if task.drive:
        await client.emit_addon_event(
            "knowledge.clip.ready",
            {
                "job_id": task.job_id,
                "file_id": task.file_id,
                "viewer_id": task.viewer_id,
                "url": task.url,
                "title": article.title,
            },
            drive=task.drive,
        )


async def _publish_fail(task: ClipTask, reason: str) -> None:
    logger.warning("clip fail file_id=%s reason=%s", task.file_id, reason)
    if task.drive:
        client = InternalClient(cookie_header=task.cookie_header)
        await client.emit_addon_event(
            "knowledge.clip.failed",
            {
                "job_id": task.job_id,
                "file_id": task.file_id,
                "viewer_id": task.viewer_id,
                "url": task.url,
                "error": reason,
            },
            drive=task.drive,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_schema()
    logger.info("knowledge addon: schema initialized")

    global _worker, _scanner_task
    _worker = ClipWorker(on_done=_publish_clip, on_fail=_publish_fail)
    _worker.start()
    for task in _worker.reclaim_stale_jobs():
        await _worker.enqueue(task)
    logger.info("knowledge addon: worker started")

    # ``NOTE_SCANNER_INTERVAL_SECONDS`` allows tests and operators to shorten
    # the default 1h cadence. The loop performs one reconcile pass immediately
    # on boot so note_origins catches up without waiting a full interval.
    interval = int(os.environ.get("NOTE_SCANNER_INTERVAL_SECONDS", "3600"))
    _scanner_task = asyncio.create_task(scanner_loop(interval_seconds=interval))
    logger.info("knowledge addon: note scanner started (interval=%ds)", interval)

    try:
        yield
    finally:
        if _scanner_task is not None:
            _scanner_task.cancel()
            try:
                await _scanner_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            _scanner_task = None
        if _worker is not None:
            await _worker.stop()
            _worker = None


app = FastAPI(
    title="Litloft Knowledge Addon",
    description="Notes and web clips — personal knowledge hub for Litloft",
    lifespan=lifespan,
)

app.include_router(vaults.router)
app.include_router(clips.router)
app.include_router(distill.router)
app.include_router(notes.router)
app.include_router(search.router)
app.include_router(tags.router)
app.include_router(webhooks.router)
app.include_router(active_summary.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
