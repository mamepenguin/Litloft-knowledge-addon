"""What ``GET /clips`` reports once the worker has finished with a job."""
from __future__ import annotations

import asyncio

import httpx
import pytest

from app import main as main_module
from app.internal_client import InternalAPIError
from app.models import ClipJob
from app.services import worker as worker_module
from app.services.extractor import ExtractedArticle
from app.services.fetcher import FetchResult
from app.services.worker import ClipTask, ClipWorker
from tests.conftest import viewer_id_for_nickname

URL = "https://ok.example/post"
DRIVE = "test-drive"
PLACEHOLDER = "---\nurl: x\n---\nFetching…\n"


def _insert_job(session_factory, viewer_id: str) -> int:
    s = session_factory()
    try:
        job = ClipJob(
            file_id="f1", viewer_id=viewer_id, drive=DRIVE, url=URL, status="fetching"
        )
        s.add(job)
        s.commit()
        s.refresh(job)
        return job.id
    finally:
        s.close()


def _db_status(session_factory, job_id: int) -> str:
    s = session_factory()
    try:
        return s.get(ClipJob, job_id).status
    finally:
        s.close()


def _make_client(
    session_factory,
    job_id,
    *,
    get_status=None,
    put_status=None,
    rename_error: Exception | None = None,
    emit_error: Exception | None = None,
):
    class Recorder:
        events: list[tuple[str, dict, str | None, str]] = []
        status_at_put: list[str] = []
        status_at_rename: list[str] = []

        def __init__(self, credential=None):
            pass

        async def get_file_content(self, file_id):
            if get_status is not None:
                raise InternalAPIError(get_status, "forced")
            return PLACEHOLDER

        async def put_file_content(self, file_id, content, if_match):
            Recorder.status_at_put.append(_db_status(session_factory, job_id))
            if put_status is not None:
                raise InternalAPIError(put_status, "forced")
            return '"etag"'

        async def rename_file(self, file_id, new_filename):
            Recorder.status_at_rename.append(_db_status(session_factory, job_id))
            if rename_error is not None:
                raise rename_error
            return {}

        async def emit_addon_event(self, event, data, drive=None):
            Recorder.events.append(
                (event, data, drive, _db_status(session_factory, job_id))
            )
            if emit_error is not None:
                raise emit_error

    Recorder.events = []
    Recorder.status_at_put = []
    Recorder.status_at_rename = []
    return Recorder


async def _run_publish(monkeypatch, session_factory, task: ClipTask, client_cls):
    monkeypatch.setattr(main_module, "InternalClient", client_cls)

    async def fake_fetch(url, **kwargs):
        return FetchResult(url, "text/html", b"<html></html>")

    monkeypatch.setattr(worker_module, "fetch_html", fake_fetch)
    monkeypatch.setattr(
        worker_module,
        "extract_article",
        lambda html, url=None: ExtractedArticle(
            title="Title", markdown="An article sentence. " * 20
        ),
    )
    w = ClipWorker(
        on_done=main_module._publish_clip,
        on_fail=main_module._publish_fail,
        session_factory=session_factory,
    )
    await w.enqueue(task)
    w.start()
    for _ in range(60):
        await asyncio.sleep(0.05)
        if _db_status(session_factory, task.job_id) != "fetching":
            break
    await w.stop()


def _search(client, viewer_cookie):
    r = client.get(
        "/clips",
        params={"url": URL},
        headers={**viewer_cookie, "X-Lit-Drive": DRIVE},
    )
    assert r.status_code == 200, r.text
    return [(j["file_id"], j["status"]) for j in r.json()]


@pytest.mark.asyncio
async def test_a_written_clip_is_ready_before_its_event_and_not_before_the_write(
    monkeypatch, knowledge_db, client, viewer_cookie
):
    vid = viewer_id_for_nickname("alice")
    job_id = _insert_job(knowledge_db, vid)
    recorder = _make_client(knowledge_db, job_id)

    await _run_publish(
        monkeypatch,
        knowledge_db,
        ClipTask(job_id, "f1", vid, URL, "", drive=DRIVE),
        recorder,
    )

    assert recorder.status_at_put == ["fetching"]
    assert recorder.status_at_rename == ["ready"]
    assert recorder.events == [
        (
            "knowledge.clip.ready",
            {
                "job_id": job_id,
                "file_id": "f1",
                "viewer_id": vid,
                "url": URL,
                "title": "Title",
            },
            DRIVE,
            "ready",
        )
    ]
    assert _search(client, viewer_cookie) == [("f1", "ready")]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "get_status, put_status", [(None, 412), (401, None), (None, 500)]
)
async def test_a_clip_whose_body_was_not_written_reads_failed_without_an_event(
    monkeypatch, knowledge_db, client, viewer_cookie, get_status, put_status
):
    vid = viewer_id_for_nickname("alice")
    job_id = _insert_job(knowledge_db, vid)
    recorder = _make_client(
        knowledge_db, job_id, get_status=get_status, put_status=put_status
    )

    await _run_publish(
        monkeypatch,
        knowledge_db,
        ClipTask(job_id, "f1", vid, URL, "", drive=DRIVE),
        recorder,
    )

    assert recorder.events == []
    assert _search(client, viewer_cookie) == [("f1", "failed")]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rename_error, emit_error",
    [
        (httpx.ConnectError("core unreachable"), None),
        (None, httpx.ConnectError("event bridge unreachable")),
    ],
)
async def test_a_written_clip_stays_ready_when_rename_or_event_fails(
    monkeypatch, knowledge_db, client, viewer_cookie, rename_error, emit_error
):
    vid = viewer_id_for_nickname("alice")
    job_id = _insert_job(knowledge_db, vid)
    recorder = _make_client(
        knowledge_db, job_id, rename_error=rename_error, emit_error=emit_error
    )

    await _run_publish(
        monkeypatch,
        knowledge_db,
        ClipTask(job_id, "f1", vid, URL, "", drive=DRIVE),
        recorder,
    )

    assert recorder.status_at_put == ["fetching"]
    assert _search(client, viewer_cookie) == [("f1", "ready")]


@pytest.mark.asyncio
async def test_a_reclaimed_job_that_cannot_read_its_placeholder_reads_failed(
    monkeypatch, knowledge_db, client, viewer_cookie
):
    vid = viewer_id_for_nickname("alice")
    job_id = _insert_job(knowledge_db, vid)
    recorder = _make_client(knowledge_db, job_id, get_status=401)
    worker = ClipWorker(session_factory=knowledge_db)
    [reclaimed] = worker.reclaim_stale_jobs()
    assert reclaimed.drive == ""

    await _run_publish(monkeypatch, knowledge_db, reclaimed, recorder)

    assert recorder.events == []
    assert _search(client, viewer_cookie) == [("f1", "failed")]


@pytest.mark.asyncio
async def test_a_publish_hook_that_raises_before_the_write_leaves_the_job_failed(
    monkeypatch, knowledge_db
):
    job_id = _insert_job(knowledge_db, "v1")

    async def on_done(task, article, mark_ready):
        raise RuntimeError("core unreachable")

    async def fake_fetch(url, **kwargs):
        return FetchResult(url, "text/html", b"<html></html>")

    monkeypatch.setattr(worker_module, "fetch_html", fake_fetch)
    monkeypatch.setattr(
        worker_module,
        "extract_article",
        lambda html, url=None: ExtractedArticle(title="t", markdown="body. " * 40),
    )
    w = ClipWorker(on_done=on_done, session_factory=knowledge_db)
    await w.enqueue(ClipTask(job_id, "f1", "v1", URL, ""))
    w.start()
    for _ in range(60):
        await asyncio.sleep(0.05)
        if _db_status(knowledge_db, job_id) != "fetching":
            break
    await w.stop()

    assert _db_status(knowledge_db, job_id) == "failed"


@pytest.mark.asyncio
async def test_a_failure_after_the_write_keeps_the_job_ready(monkeypatch, knowledge_db):
    job_id = _insert_job(knowledge_db, "v1")

    async def on_done(task, article, mark_ready):
        mark_ready()
        raise RuntimeError("event bridge down")

    async def fake_fetch(url, **kwargs):
        return FetchResult(url, "text/html", b"<html></html>")

    monkeypatch.setattr(worker_module, "fetch_html", fake_fetch)
    monkeypatch.setattr(
        worker_module,
        "extract_article",
        lambda html, url=None: ExtractedArticle(title="t", markdown="body. " * 40),
    )
    w = ClipWorker(on_done=on_done, session_factory=knowledge_db)
    await w.enqueue(ClipTask(job_id, "f1", "v1", URL, ""))
    w.start()
    for _ in range(60):
        await asyncio.sleep(0.05)
        if _db_status(knowledge_db, job_id) != "fetching":
            break
    await w.stop()

    assert _db_status(knowledge_db, job_id) == "ready"
