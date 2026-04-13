"""Async worker that drives clip_jobs to completion.

Design decisions worth preserving:

- **Two concurrent jobs** (``Semaphore(2)``). Enough to hide one slow
  remote per user without hammering a single host.
- **Per-host serialization + 2s politeness delay**. Stops the addon
  from turning into an accidental DDoS amplifier when a user dumps a
  folder's worth of URLs from the same site.
- **Lease-based take-over**. A stale ``lease_until`` means the previous
  worker died. We only reclaim jobs whose lease has expired, so no two
  workers race on the same job.
- **Retry up to 3 times**, then pin to ``failed``. The file stays —
  users can manually paste HTML as a fallback.

What this module does *not* own:

- File I/O to the user's drive: that goes through the core's
  ``PUT /content`` + ``POST /rename`` endpoints via ``InternalClient``.
- WebSocket emission: the HomeVault core owns the WS pipe. For now we
  leave the event publishing to a future wiring step; the worker just
  calls a pluggable ``on_done`` / ``on_fail`` hook.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Awaitable, Callable, Optional

from sqlalchemy.orm import Session

from app import database
from app.models import ClipJob
from app.services.extractor import ExtractedArticle, extract_article
from app.services.fetcher import BlockedURL, FetchError, fetch_html

logger = logging.getLogger(__name__)

_LEASE_DURATION = timedelta(minutes=10)
_MAX_RETRIES = 3
_PER_HOST_DELAY_SEC = 2.0


@dataclass
class ClipTask:
    job_id: int
    file_id: str
    viewer_id: str
    url: str
    cookie_header: str


# Hooks: module-level so tests can swap and main.py can wire to WS.
JobDone = Callable[[ClipTask, ExtractedArticle], Awaitable[None]]
JobFailed = Callable[[ClipTask, str], Awaitable[None]]


async def _noop_done(task: ClipTask, _: ExtractedArticle) -> None:
    logger.info("clip.ready file_id=%s viewer=%s", task.file_id, task.viewer_id)


async def _noop_fail(task: ClipTask, reason: str) -> None:
    logger.warning(
        "clip.failed file_id=%s viewer=%s reason=%s",
        task.file_id, task.viewer_id, reason,
    )


class ClipWorker:
    """Owns the queue + semaphore. One instance per FastAPI process."""

    def __init__(
        self,
        on_done: JobDone | None = None,
        on_fail: JobFailed | None = None,
        concurrency: int = 2,
        session_factory: Callable[[], Session] | None = None,
    ) -> None:
        self._queue: asyncio.Queue[ClipTask] = asyncio.Queue()
        self._sem = asyncio.Semaphore(concurrency)
        self._host_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._last_host_hit: dict[str, float] = {}
        self._on_done = on_done or _noop_done
        self._on_fail = on_fail or _noop_fail
        self._tasks: set[asyncio.Task] = set()
        self._running = False
        self._session_factory = session_factory or (lambda: database.SessionLocal())

    async def enqueue(self, task: ClipTask) -> None:
        await self._queue.put(task)

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        loop = asyncio.get_event_loop()
        t = loop.create_task(self._run())
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    async def stop(self) -> None:
        self._running = False
        for t in list(self._tasks):
            t.cancel()
        for t in list(self._tasks):
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks.clear()

    def reclaim_stale_jobs(self) -> list[ClipTask]:
        """Requeue ``fetching`` jobs whose lease has expired.

        Called from the FastAPI lifespan on startup so in-flight work
        from a crashed process gets retried instead of hanging forever.
        Returns the reclaimed tasks (cookie_header is empty — the user's
        cookie is gone with the previous process, so retries run with
        anonymous identity; the core still verifies drive access).
        """
        now = datetime.utcnow()
        reclaimed: list[ClipTask] = []
        session = self._session_factory()
        try:
            q = session.query(ClipJob).filter(ClipJob.status == "fetching")
            for job in q.all():
                if job.lease_until is None or job.lease_until < now:
                    reclaimed.append(ClipTask(
                        job_id=job.id,
                        file_id=job.file_id,
                        viewer_id=job.viewer_id,
                        url=job.url,
                        cookie_header="",
                    ))
            session.commit()
        finally:
            session.close()
        return reclaimed

    async def _run(self) -> None:
        while self._running:
            try:
                task = await self._queue.get()
            except asyncio.CancelledError:
                return
            await self._sem.acquire()
            worker = asyncio.create_task(self._process_with_sem(task))
            self._tasks.add(worker)
            worker.add_done_callback(self._tasks.discard)

    async def _process_with_sem(self, task: ClipTask) -> None:
        try:
            await self._process(task)
        finally:
            self._sem.release()

    async def _process(self, task: ClipTask) -> None:
        if not self._claim_lease(task.job_id):
            # Someone else has a fresh lease — skip.
            return

        host = _extract_host(task.url)
        async with self._host_locks[host]:
            await self._politeness_wait(host)
            try:
                result = await fetch_html(task.url)
            except BlockedURL as e:
                await self._fail(task, f"blocked: {e}", permanent=True)
                return
            except FetchError as e:
                await self._retry_or_fail(task, f"fetch: {e}")
                return

            try:
                article = extract_article(result.body.decode("utf-8", errors="replace"), task.url)
            except Exception as e:  # extractor failures are not transient
                await self._fail(task, f"extract: {e}", permanent=True)
                return

            self._mark_ready(task.job_id)
            await self._on_done(task, article)

    def _claim_lease(self, job_id: int) -> bool:
        """Set lease_until to now+10min if not already held. Atomic enough
        for SQLite's single-writer model."""
        session = self._session_factory()
        try:
            now = datetime.utcnow()
            job = session.get(ClipJob, job_id)
            if job is None:
                return False
            if job.status in ("ready", "failed"):
                return False
            if job.lease_until is not None and job.lease_until > now:
                return False  # another worker holds a fresh lease
            job.lease_until = now + _LEASE_DURATION
            session.commit()
            return True
        finally:
            session.close()

    def _mark_ready(self, job_id: int) -> None:
        session = self._session_factory()
        try:
            job = session.get(ClipJob, job_id)
            if job is None:
                return
            job.status = "ready"
            job.lease_until = None
            job.error = None
            session.commit()
        finally:
            session.close()

    async def _retry_or_fail(self, task: ClipTask, reason: str) -> None:
        session = self._session_factory()
        try:
            job = session.get(ClipJob, task.job_id)
            if job is None:
                return
            job.retry_count += 1
            if job.retry_count >= _MAX_RETRIES:
                job.status = "failed"
                job.error = reason[:1000]
                job.lease_until = None
                session.commit()
                await self._on_fail(task, reason)
                return
            job.lease_until = None  # release lease so next poll picks it up
            job.error = reason[:1000]
            session.commit()
        finally:
            session.close()
        # re-enqueue for another attempt
        await self._queue.put(task)

    async def _fail(self, task: ClipTask, reason: str, *, permanent: bool) -> None:
        session = self._session_factory()
        try:
            job = session.get(ClipJob, task.job_id)
            if job is None:
                return
            if permanent:
                job.status = "failed"
            job.error = reason[:1000]
            job.lease_until = None
            session.commit()
        finally:
            session.close()
        await self._on_fail(task, reason)

    async def _politeness_wait(self, host: str) -> None:
        last = self._last_host_hit.get(host)
        now = time.monotonic()
        if last is not None:
            wait = _PER_HOST_DELAY_SEC - (now - last)
            if wait > 0:
                await asyncio.sleep(wait)
        self._last_host_hit[host] = time.monotonic()


def _extract_host(url: str) -> str:
    from urllib.parse import urlparse
    return (urlparse(url).hostname or "").lower()
