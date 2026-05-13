"""Clips router integration tests.

We stub both the worker and InternalClient so no real network or
filesystem writes happen. What this file guards:

- URL validation happens BEFORE we create a placeholder
- drive header is required
- pasted-HTML path bypasses the worker and writes directly
"""
from __future__ import annotations

import pytest

from app.auth import nickname_to_viewer_id
from app.models import ClipJob
from tests.conftest import FakeInternalClient


class FakeWorker:
    def __init__(self):
        self.enqueued = []

    async def enqueue(self, task):
        self.enqueued.append(task)

    def start(self):
        pass

    async def stop(self):
        pass

    def reclaim_stale_jobs(self):
        return []


@pytest.fixture()
def fake_worker(monkeypatch):
    w = FakeWorker()
    import app.main as main
    monkeypatch.setattr(main, "_worker", w)
    return w


@pytest.fixture()
def fake_clips_internal(monkeypatch):
    import app.routers.clips as clips_router
    FakeInternalClient.accessible_drives_override = ["test-drive"]
    monkeypatch.setattr(clips_router, "InternalClient", FakeInternalClient)
    return FakeInternalClient


@pytest.fixture()
def stub_dns(monkeypatch):
    import socket
    def fake(host, *a, **kw):
        return [(0, 0, 0, "", ("93.184.216.34", 0))]
    monkeypatch.setattr(socket, "getaddrinfo", fake)


def test_create_clip_rejects_bad_scheme(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie
):
    r = client.post(
        "/clips",
        json={"url": "file:///etc/passwd"},
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
    )
    assert r.status_code == 400
    assert "URL rejected" in r.json()["detail"]


def test_create_clip_rejects_docker_host(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie
):
    r = client.post(
        "/clips",
        json={"url": "http://backend:8000/"},
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
    )
    assert r.status_code == 400


def test_create_clip_happy_path(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie, stub_dns
):
    vid = nickname_to_viewer_id("alice")
    r = client.post(
        "/clips",
        json={"url": "https://ok.example/post"},
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
    )
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "fetching"
    assert body["file_id"]

    # Job row persisted
    s = knowledge_db()
    try:
        jobs = s.query(ClipJob).all()
    finally:
        s.close()
    assert len(jobs) == 1
    assert jobs[0].status == "fetching"
    assert jobs[0].viewer_id == vid
    assert jobs[0].drive == "test-drive"

    # Worker received the task
    assert len(fake_worker.enqueued) == 1
    assert fake_worker.enqueued[0].url == "https://ok.example/post"


def test_create_clip_missing_drive_header_400(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie
):
    r = client.post(
        "/clips",
        json={"url": "https://ok.example/"},
        headers={"Cookie": viewer_cookie},
    )
    assert r.status_code == 400


def test_pasted_html_skips_worker(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie, stub_dns
):
    html = (
        "<html><head><title>Manual</title></head><body>"
        "<article><h1>Hi</h1><p>" + ("body text " * 50) + "</p></article>"
        "</body></html>"
    )
    r = client.post(
        "/clips/pasted",
        json={"url": "https://ok.example/", "html": html},
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "ready"
    assert fake_worker.enqueued == []  # pasted path doesn't queue

    s = knowledge_db()
    try:
        jobs = s.query(ClipJob).all()
    finally:
        s.close()
    assert len(jobs) == 1
    assert jobs[0].status == "ready"


def test_pasted_html_rejects_bad_url(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie
):
    r = client.post(
        "/clips/pasted",
        json={"url": "javascript:alert(1)", "html": "<p>hi</p>"},
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
    )
    assert r.status_code == 400


def test_search_clips_is_drive_scoped(client, knowledge_db, viewer_cookie):
    """GET /clips must not leak ClipJobs across drives.

    The same viewer with clips on drive A and drive B should only see
    their drive A clips when querying with ``X-Lit-Drive: A`` — drive
    is the security boundary.
    """
    from app.auth import nickname_to_viewer_id

    vid = nickname_to_viewer_id("alice")
    s = knowledge_db()
    try:
        s.add_all([
            ClipJob(
                file_id="fA1", viewer_id=vid, drive="test-drive",
                url="https://ok.example/post", status="ready",
            ),
            ClipJob(
                file_id="fB1", viewer_id=vid, drive="media",
                url="https://ok.example/post", status="ready",
            ),
        ])
        s.commit()
    finally:
        s.close()

    # Query from drive A — should only see drive A's job
    r = client.get(
        "/clips",
        params={"url": "https://ok.example/post"},
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
    )
    assert r.status_code == 200, r.text
    jobs = r.json()
    assert len(jobs) == 1
    assert jobs[0]["file_id"] == "fA1"

    # Query from drive B — should only see drive B's job
    r = client.get(
        "/clips",
        params={"url": "https://ok.example/post"},
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": "media"},
    )
    assert r.status_code == 200, r.text
    other = r.json()
    assert len(other) == 1
    assert other[0]["file_id"] == "fB1"


class TestFrontmatterSchema:
    """Spec 2026-04-24: webclip writes only url + origin + created. The
    legacy keys (title / status / clipped_at) must not appear in new
    placeholders or the ready state."""

    def test_initial_content_has_schema_fields(self):
        import re
        from app.routers.clips import _initial_content
        from app.services.frontmatter import parse

        fm = parse(_initial_content("https://example.com/x"))
        assert fm.metadata["url"] == "https://example.com/x"
        assert fm.metadata["origin"] == "webclip"
        created = fm.metadata["created"]
        assert isinstance(created, str)
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", created)

    def test_initial_content_drops_legacy_keys(self):
        from app.routers.clips import _initial_content
        from app.services.frontmatter import parse

        fm = parse(_initial_content("https://example.com/x"))
        assert "status" not in fm.metadata
        assert "title" not in fm.metadata
        assert "clipped_at" not in fm.metadata

    def test_ready_content_has_schema_fields(self):
        import re
        from app.routers.clips import _ready_content
        from app.services.extractor import ExtractedArticle
        from app.services.frontmatter import parse

        article = ExtractedArticle(title="Hello", markdown="body")
        fm = parse(_ready_content("https://example.com/x", article))
        assert fm.metadata["url"] == "https://example.com/x"
        assert fm.metadata["origin"] == "webclip"
        created = fm.metadata["created"]
        assert isinstance(created, str)
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", created)
        assert "status" not in fm.metadata
        assert "title" not in fm.metadata
        assert "clipped_at" not in fm.metadata
