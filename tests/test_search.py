"""Drive-scoped search router integration tests.

We stub InternalClient.list_drive_files + get_file_content so the
router exercises only its own scanning/snippet logic without hitting
the core.
"""
from __future__ import annotations

import pytest

from tests.conftest import FakeInternalClient


class SearchableFake(FakeInternalClient):
    """FakeInternalClient that also returns canned file lists + contents.

    Tests set ``files`` to the drive listing they want the core to
    return, and ``contents`` to the (file_id → bytes-as-str) body map.
    """
    files: list[dict] = []
    contents: dict[str, str] = {}

    async def list_drive_files(self, drive, path, *, limit=500):
        return list(SearchableFake.files)

    async def get_file_content(self, file_id: str) -> str:
        return SearchableFake.contents.get(file_id, "")


@pytest.fixture()
def fake_search_internal(monkeypatch):
    import app.routers.search as search_router
    SearchableFake.accessible_drives_override = ["test-drive"]
    SearchableFake.files = []
    SearchableFake.contents = {}
    monkeypatch.setattr(search_router, "InternalClient", SearchableFake)
    return SearchableFake


def test_search_returns_matches(client, knowledge_db, fake_search_internal, viewer_cookie):
    SearchableFake.files = [
        {
            "id": "f1", "filename": "alpha.md", "title": "Alpha",
            "mime_type": "text/markdown",
        },
        {
            "id": "f2", "filename": "beta.md", "title": "Beta",
            "mime_type": "text/markdown",
        },
        {
            "id": "f3", "filename": "vid.mp4", "title": "Vid",
            "mime_type": "video/mp4",
        },
    ]
    SearchableFake.contents = {
        "f1": "---\ntitle: Alpha\n---\nThis note contains the magic word needle.",
        "f2": "Nothing relevant here.",
        "f3": "binary... shouldn't be scanned anyway",
    }
    r = client.get(
        "/search?q=needle",
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["query"] == "needle"
    assert body["drive"] == "test-drive"
    assert len(body["results"]) == 1
    hit = body["results"][0]
    assert hit["file_id"] == "f1"
    assert "needle" in hit["snippet"]
    # Frontmatter excluded from search body
    assert "title: Alpha" not in hit["snippet"]


def test_search_case_insensitive(client, knowledge_db, fake_search_internal, viewer_cookie):
    SearchableFake.files = [{
        "id": "f1", "filename": "a.md", "title": "A",
        "mime_type": "text/markdown",
    }]
    SearchableFake.contents = {"f1": "Some Content Here"}
    r = client.get(
        "/search?q=content",
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
    )
    assert r.status_code == 200
    assert len(r.json()["results"]) == 1


def test_search_missing_query_param(client, knowledge_db, fake_search_internal, viewer_cookie):
    r = client.get(
        "/search",
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
    )
    assert r.status_code == 422  # pydantic validation


def test_search_missing_drive_header_400(
    client, knowledge_db, fake_search_internal, viewer_cookie
):
    r = client.get(
        "/search?q=anything",
        headers={"Cookie": viewer_cookie},
    )
    assert r.status_code == 400


def test_search_skips_non_text_files(client, knowledge_db, fake_search_internal, viewer_cookie):
    SearchableFake.files = [{
        "id": "f1", "filename": "x.mp4", "title": "X",
        "mime_type": "video/mp4",
    }]
    SearchableFake.contents = {"f1": "contains needle"}
    r = client.get(
        "/search?q=needle",
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
    )
    assert r.status_code == 200
    assert r.json()["results"] == []
