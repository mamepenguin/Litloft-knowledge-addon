"""Clips router integration tests.

We stub both the worker and InternalClient so no real network or
filesystem writes happen. What this file guards:

- URL validation happens BEFORE we create a placeholder
- vault ownership check
- pasted-HTML path bypasses the worker and writes directly
"""
from __future__ import annotations

import pytest

from app.auth import nickname_to_viewer_id
from app.models import ClipJob, UserVault
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


def _seed_vault(knowledge_db, viewer_id):
    s = knowledge_db()
    try:
        v = UserVault(viewer_id=viewer_id, label="L", drive="test-drive", path="Notes")
        s.add(v)
        s.commit()
        s.refresh(v)
        return v.id
    finally:
        s.close()


def test_create_clip_rejects_bad_scheme(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie
):
    vid = nickname_to_viewer_id("alice")
    vault_id = _seed_vault(knowledge_db, vid)
    r = client.post(
        "/clips",
        json={"url": "file:///etc/passwd", "vault_id": vault_id},
        headers={"Cookie": viewer_cookie, "X-HV-Drive": "test-drive"},
    )
    assert r.status_code == 400
    assert "URL rejected" in r.json()["detail"]


def test_create_clip_rejects_docker_host(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie
):
    vid = nickname_to_viewer_id("alice")
    vault_id = _seed_vault(knowledge_db, vid)
    r = client.post(
        "/clips",
        json={"url": "http://backend:8000/", "vault_id": vault_id},
        headers={"Cookie": viewer_cookie, "X-HV-Drive": "test-drive"},
    )
    assert r.status_code == 400


def test_create_clip_happy_path(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie, stub_dns
):
    vid = nickname_to_viewer_id("alice")
    vault_id = _seed_vault(knowledge_db, vid)
    r = client.post(
        "/clips",
        json={"url": "https://ok.example/post", "vault_id": vault_id},
        headers={"Cookie": viewer_cookie, "X-HV-Drive": "test-drive"},
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

    # Worker received the task
    assert len(fake_worker.enqueued) == 1
    assert fake_worker.enqueued[0].url == "https://ok.example/post"


def test_create_clip_vault_ownership(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie, stub_dns
):
    # Vault belongs to "bob", cookie is "alice" → 404
    bob_id = nickname_to_viewer_id("bob")
    vault_id = _seed_vault(knowledge_db, bob_id)
    r = client.post(
        "/clips",
        json={"url": "https://ok.example/", "vault_id": vault_id},
        headers={"Cookie": viewer_cookie, "X-HV-Drive": "test-drive"},
    )
    assert r.status_code == 404


def test_create_clip_drive_mismatch_404(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie, stub_dns
):
    """Vault lives in test-drive; request arrives with X-HV-Drive=media."""
    vid = nickname_to_viewer_id("alice")
    vault_id = _seed_vault(knowledge_db, vid)
    r = client.post(
        "/clips",
        json={"url": "https://ok.example/", "vault_id": vault_id},
        headers={"Cookie": viewer_cookie, "X-HV-Drive": "media"},
    )
    assert r.status_code == 404


def test_create_clip_missing_drive_header_400(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie
):
    vid = nickname_to_viewer_id("alice")
    vault_id = _seed_vault(knowledge_db, vid)
    r = client.post(
        "/clips",
        json={"url": "https://ok.example/", "vault_id": vault_id},
        headers={"Cookie": viewer_cookie},
    )
    assert r.status_code == 400


def test_pasted_html_skips_worker(
    client, knowledge_db, fake_clips_internal, fake_worker, viewer_cookie, stub_dns
):
    vid = nickname_to_viewer_id("alice")
    vault_id = _seed_vault(knowledge_db, vid)
    html = (
        "<html><head><title>Manual</title></head><body>"
        "<article><h1>Hi</h1><p>" + ("body text " * 50) + "</p></article>"
        "</body></html>"
    )
    r = client.post(
        "/clips/pasted",
        json={"url": "https://ok.example/", "vault_id": vault_id, "html": html},
        headers={"Cookie": viewer_cookie, "X-HV-Drive": "test-drive"},
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
    vid = nickname_to_viewer_id("alice")
    vault_id = _seed_vault(knowledge_db, vid)
    r = client.post(
        "/clips/pasted",
        json={"url": "javascript:alert(1)", "vault_id": vault_id, "html": "<p>hi</p>"},
        headers={"Cookie": viewer_cookie, "X-HV-Drive": "test-drive"},
    )
    assert r.status_code == 400
