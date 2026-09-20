"""Note openings, fetched once per listing rather than once per row."""
from __future__ import annotations

import httpx
import pytest

from app.internal_client import InternalAPIError
from tests.conftest import FakeInternalClient


class OpeningsFake(FakeInternalClient):
    accessible_ids: list[str] = []
    drive_of: dict[str, str] = {}
    mime_of: dict[str, str] = {}
    meta_failure: Exception | None = None
    contents: dict[str, str] = {}
    content_failures: dict[str, Exception] = {}
    filter_failure: Exception | None = None
    filtered: list[list[str]] = []
    fetched: list[tuple[str, int]] = []

    async def filter_file_ids(self, file_ids):
        OpeningsFake.filtered.append(list(file_ids))
        if OpeningsFake.filter_failure is not None:
            raise OpeningsFake.filter_failure
        return [i for i in file_ids if i in OpeningsFake.accessible_ids]

    async def fetch_bulk_files(self, file_ids):
        if OpeningsFake.meta_failure is not None:
            raise OpeningsFake.meta_failure
        return {
            "files": [
                {
                    "id": i,
                    "drive": OpeningsFake.drive_of.get(i, "test-drive"),
                    "mime_type": OpeningsFake.mime_of.get(i, "text/markdown"),
                }
                for i in file_ids
            ],
            "not_found": [],
        }

    async def get_file_opening(self, file_id: str, max_bytes: int) -> str:
        OpeningsFake.fetched.append((file_id, max_bytes))
        failure = OpeningsFake.content_failures.get(file_id)
        if failure is not None:
            raise failure
        return OpeningsFake.contents.get(file_id, "")[:max_bytes]


@pytest.fixture()
def fake_openings(monkeypatch):
    import app.routers.note_openings as router

    OpeningsFake.accessible_ids = []
    OpeningsFake.drive_of = {}
    OpeningsFake.mime_of = {}
    OpeningsFake.meta_failure = None
    OpeningsFake.contents = {}
    OpeningsFake.content_failures = {}
    OpeningsFake.filter_failure = None
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
    assert [i for i, _ in OpeningsFake.fetched] == ["mine"]


def test_one_unreadable_file_does_not_take_the_others_down(
    client, knowledge_db, fake_openings, viewer_cookie
):
    OpeningsFake.accessible_ids = ["a", "b"]
    OpeningsFake.contents = {"b": "Body."}
    OpeningsFake.content_failures = {"a": InternalAPIError(404, "gone")}

    res = post(client, ["a", "b"], viewer_cookie)

    assert res.status_code == 200
    assert res.json()["openings"] == {"b": "Body."}


def test_only_the_opening_is_read_and_returned(
    client, knowledge_db, fake_openings, viewer_cookie
):
    OpeningsFake.accessible_ids = ["a"]
    OpeningsFake.contents = {"a": "x" * 2000}

    res = post(client, ["a"], viewer_cookie)

    # 1024 characters, and the bytes for them: a character outside ASCII
    # takes up to four, and a read of 1024 bytes would cut a Japanese note
    # to a third of the opening everyone else gets.
    assert OpeningsFake.fetched == [("a", 4096)]
    assert res.json()["openings"]["a"] == "x" * 1024


def test_a_file_from_another_drive_is_not_read(
    client, knowledge_db, fake_openings, viewer_cookie
):
    OpeningsFake.accessible_ids = ["here", "elsewhere"]
    OpeningsFake.drive_of = {"here": "test-drive", "elsewhere": "other-drive"}
    OpeningsFake.contents = {"here": "This drive.", "elsewhere": "Another drive."}

    res = post(client, ["here", "elsewhere"], viewer_cookie)

    assert res.json()["openings"] == {"here": "This drive."}
    assert [i for i, _ in OpeningsFake.fetched] == ["here"]


def test_a_timeout_on_one_file_leaves_the_others(
    client, knowledge_db, fake_openings, viewer_cookie
):
    OpeningsFake.accessible_ids = ["a", "b"]
    OpeningsFake.contents = {"b": "Body."}
    OpeningsFake.content_failures = {"a": httpx.ReadTimeout("slow")}

    res = post(client, ["a", "b"], viewer_cookie)

    assert res.status_code == 200
    assert res.json()["openings"] == {"b": "Body."}


def test_when_the_access_filter_fails_nothing_is_read(
    client, knowledge_db, fake_openings, viewer_cookie
):
    OpeningsFake.filter_failure = InternalAPIError(503, "core is down")
    OpeningsFake.contents = {"a": "secret"}

    res = post(client, ["a"], viewer_cookie)

    assert res.status_code == 502
    assert OpeningsFake.fetched == []


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


def test_a_percent_encoded_drive_name_is_the_drive_it_names(
    client, knowledge_db, fake_openings, viewer_cookie
):
    # Header values are ISO-8859-1, so the frontend percent-encodes the
    # drive and the core proxy forwards it as it stands.
    OpeningsFake.accessible_ids = ["a"]
    OpeningsFake.drive_of = {"a": "仕事"}
    OpeningsFake.contents = {"a": "Body."}

    res = post(client, ["a"], viewer_cookie, drive="%E4%BB%95%E4%BA%8B")

    assert res.json()["openings"] == {"a": "Body."}


def test_a_file_that_is_not_text_is_not_read(
    client, knowledge_db, fake_openings, viewer_cookie
):
    OpeningsFake.accessible_ids = ["note", "clip"]
    OpeningsFake.mime_of = {"note": "text/markdown", "clip": "video/mp4"}
    OpeningsFake.contents = {"note": "Body.", "clip": "\x00\x00"}

    res = post(client, ["note", "clip"], viewer_cookie)

    assert res.json()["openings"] == {"note": "Body."}
    assert [i for i, _ in OpeningsFake.fetched] == ["note"]


def test_when_the_metadata_lookup_fails_nothing_is_read(
    client, knowledge_db, fake_openings, viewer_cookie
):
    OpeningsFake.accessible_ids = ["a"]
    OpeningsFake.meta_failure = httpx.ReadTimeout("slow")
    OpeningsFake.contents = {"a": "Body."}

    res = post(client, ["a"], viewer_cookie)

    assert res.status_code == 502
    assert OpeningsFake.fetched == []
