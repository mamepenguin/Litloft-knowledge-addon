"""Worker lifecycle + lease semantics."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import pytest

from app.models import ClipJob
from app.services import worker as worker_module
from app.services.extractor import ExtractedArticle
from app.services.fetcher import BlockedURL, FetchResult
from app.services.worker import ClipTask, ClipWorker


@pytest.fixture()
def session_factory(knowledge_db):
    return knowledge_db


def _insert_job(session_factory, url="https://ok.example/", viewer="v1"):
    s = session_factory()
    try:
        job = ClipJob(
            file_id="abc123", viewer_id=viewer, url=url, status="fetching"
        )
        s.add(job)
        s.commit()
        s.refresh(job)
        return job.id
    finally:
        s.close()


def _get_job(session_factory, job_id):
    s = session_factory()
    try:
        return s.get(ClipJob, job_id)
    finally:
        s.close()


@pytest.mark.asyncio
async def test_worker_happy_path(monkeypatch, session_factory):
    job_id = _insert_job(session_factory)

    async def fake_fetch(url, **kwargs):
        return FetchResult(url, "text/html", b"<html><body>hi</body></html>")

    def fake_extract(html, url=None):
        # Body must clear the worker's empty-body threshold (~100 bytes);
        # padding with real sentence text keeps the fixture realistic.
        return ExtractedArticle(
            title="t",
            markdown="This is the article body. " * 10,
        )

    monkeypatch.setattr(worker_module, "fetch_html", fake_fetch)
    monkeypatch.setattr(worker_module, "extract_article", fake_extract)

    done: list[tuple[ClipTask, ExtractedArticle]] = []

    async def on_done(task, article):
        done.append((task, article))

    w = ClipWorker(on_done=on_done, session_factory=session_factory)
    await w.enqueue(ClipTask(job_id, "abc123", "v1", "https://ok.example/", ""))
    w.start()
    # Give the loop time to drain
    for _ in range(20):
        await asyncio.sleep(0.05)
        if done:
            break
    await w.stop()

    assert len(done) == 1
    assert done[0][1].title == "t"
    job = _get_job(session_factory, job_id)
    assert job.status == "ready"
    assert job.lease_until is None


@pytest.mark.asyncio
async def test_worker_blocked_url_is_permanent_failure(monkeypatch, session_factory):
    job_id = _insert_job(session_factory, url="http://10.0.0.1/")

    async def fake_fetch(url, **kwargs):
        raise BlockedURL("Blocked IP")

    monkeypatch.setattr(worker_module, "fetch_html", fake_fetch)

    failures: list[str] = []

    async def on_fail(task, reason):
        failures.append(reason)

    w = ClipWorker(on_fail=on_fail, session_factory=session_factory)
    await w.enqueue(ClipTask(job_id, "abc123", "v1", "http://10.0.0.1/", ""))
    w.start()
    for _ in range(20):
        await asyncio.sleep(0.05)
        if failures:
            break
    await w.stop()

    assert failures and "blocked" in failures[0]
    job = _get_job(session_factory, job_id)
    assert job.status == "failed"


@pytest.mark.asyncio
async def test_lease_blocks_double_claim(session_factory):
    job_id = _insert_job(session_factory)
    w = ClipWorker(session_factory=session_factory)
    # First claim succeeds; second should not until lease expires
    assert w._claim_lease(job_id) is True
    assert w._claim_lease(job_id) is False


def test_reclaim_stale_jobs(session_factory):
    # Job stamped with expired lease — worker should reclaim it
    s = session_factory()
    try:
        expired = ClipJob(
            file_id="xxx", viewer_id="v1", url="https://ok.example/",
            status="fetching",
            lease_until=datetime.utcnow() - timedelta(minutes=30),
        )
        fresh = ClipJob(
            file_id="yyy", viewer_id="v1", url="https://ok.example/",
            status="fetching",
            lease_until=datetime.utcnow() + timedelta(minutes=5),
        )
        done = ClipJob(
            file_id="zzz", viewer_id="v1", url="https://ok.example/",
            status="ready",
        )
        s.add_all([expired, fresh, done])
        s.commit()
    finally:
        s.close()

    w = ClipWorker(session_factory=session_factory)
    tasks = w.reclaim_stale_jobs()
    file_ids = {t.file_id for t in tasks}
    assert file_ids == {"xxx"}
