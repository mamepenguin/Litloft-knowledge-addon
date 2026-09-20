"""Note openings, fetched once per listing rather than once per row."""
from __future__ import annotations

import pytest

from app.internal_client import InternalAPIError
from tests.conftest import FakeInternalClient


class OpeningsFake(FakeInternalClient):
    accessible_ids: list[str] = []
    contents: dict[str, str] = {}
    content_failures: set[str] = set()
    filtered: list[list[str]] = []
    fetched: list[str] = []

    async def filter_file_ids(self, file_ids):
        OpeningsFake.filtered.append(list(file_ids))
        return [i for i in file_ids if i in OpeningsFake.accessible_ids]

    async def get_file_content(self, file_id: str) -> str:
        OpeningsFake.fetched.append(file_id)
        if file_id in OpeningsFake.content_failures:
            raise InternalAPIError(404, "gone")
        return OpeningsFake.contents.get(file_id, "")


@pytest.fixture()
def fake_openings(monkeypatch):
    import app.routers.note_openings as router

    OpeningsFake.accessible_ids = []
    OpeningsFake.contents = {}
    OpeningsFake.content_failures = set()
    OpeningsFake.filtered = []
    OpeningsFake.fetched = []
    monkeypatch.setattr(router, "InternalClient", OpeningsFake)
    return OpeningsFake


def post(client, ids, viewer_cookie, drive="test-drive"):
    headers = dict(viewer_cookie)
    if drive is not None:
        headers["X-Lit-Drive"] = drive
    return client.post("/note-openings", json={"file_ids": ids}, headers=headers)


def test_returns_the_opening_of_each_note(client, knowledge_db, fake_openings, viewer_cookie):
    OpeningsFake.accessible_ids = ["a", "b"]
    OpeningsFake.contents = {"a": "---\nid: 1\n---\n# Trip\n\nDay one.", "b": "Plain body."}

    res = post(client, ["a", "b"], viewer_cookie)

    assert res.status_code == 200
    assert res.json()["openings"] == {
        "a": "---\nid: 1\n---\n# Trip\n\nDay one.",
        "b": "Plain body.",
    }


def test_a_file_the_caller_cannot_read_is_never_fetched_or_returned(
    client, knowledge_db, fake_openings, viewer_cookie
):
    OpeningsFake.accessible_ids = ["mine"]
    OpeningsFake.contents = {"mine": "ok", "locked": "secret"}

    res = post(client, ["mine", "locked"], viewer_cookie)

    assert res.json()["openings"] == {"mine": "ok"}
    assert OpeningsFake.filtered == [["mine", "locked"]]
    assert "locked" not in OpeningsFake.fetched


def test_one_unreadable_file_does_not_take_the_others_down(
    client, knowledge_db, fake_openings, viewer_cookie
):
    OpeningsFake.accessible_ids = ["a", "b"]
    OpeningsFake.contents = {"b": "Body."}
    OpeningsFake.content_failures = {"a"}

    res = post(client, ["a", "b"], viewer_cookie)

    assert res.status_code == 200
    assert res.json()["openings"] == {"b": "Body."}


def test_only_the_opening_is_returned(client, knowledge_db, fake_openings, viewer_cookie):
    from app.routers.note_openings import OPENING_CHARS

    OpeningsFake.accessible_ids = ["a"]
    OpeningsFake.contents = {"a": "x" * (OPENING_CHARS + 500)}

    res = post(client, ["a"], viewer_cookie)

    assert res.json()["openings"]["a"] == "x" * OPENING_CHARS


def test_more_ids_than_a_listing_can_hold_are_refused(
    client, knowledge_db, fake_openings, viewer_cookie
):
    from app.routers.note_openings import MAX_IDS

    res = post(client, [f"f{i}" for i in range(MAX_IDS + 1)], viewer_cookie)

    assert res.status_code == 422
    assert OpeningsFake.fetched == []


def test_without_a_drive_it_answers_nothing(client, knowledge_db, fake_openings, viewer_cookie):
    res = post(client, ["a"], viewer_cookie, drive=None)

    assert res.status_code == 400
    assert OpeningsFake.fetched == []
