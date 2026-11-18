"""SPEC-ADDON-131: the two Knowledge routes behind Notes with sources and the pane's Sources."""
from __future__ import annotations

import logging

import httpx
import pytest

from app.internal_client import InternalAPIError
from app.models import NoteOrigin, NoteOriginSource
from tests.conftest import FakeInternalClient


class SourcesFake(FakeInternalClient):
    contents: dict[str, str] = {}
    content_failures: dict[str, Exception] = {}
    read: list[str] = []
    files: dict[str, dict] = {}
    bulk_failure: Exception | None = None
    bulk_asked: list[list[str]] = []

    async def get_file_text_content(self, file_id):
        SourcesFake.read.append(file_id)
        if file_id in SourcesFake.content_failures:
            raise SourcesFake.content_failures[file_id]
        return SourcesFake.contents[file_id]

    async def fetch_bulk_files(self, file_ids):
        SourcesFake.bulk_asked.append(list(file_ids))
        if SourcesFake.bulk_failure is not None:
            raise SourcesFake.bulk_failure
        return {
            "files": [SourcesFake.files[i] for i in file_ids if i in SourcesFake.files],
            "not_found": [i for i in file_ids if i not in SourcesFake.files],
        }


def _file(fid, drive="test-drive", **kw):
    return {
        "id": fid,
        "drive": drive,
        "title": kw.get("title", f"T-{fid}"),
        "filename": kw.get("filename", f"{fid}.mp4"),
        "folder_path": kw.get("folder_path", "videos"),
        "mime_type": kw.get("mime_type", "video/mp4"),
        "has_thumbnail": kw.get("has_thumbnail", True),
    }


@pytest.fixture()
def fake(monkeypatch):
    import app.routers.notes_sources as router

    SourcesFake.contents = {}
    SourcesFake.content_failures = {}
    SourcesFake.read = []
    SourcesFake.files = {}
    SourcesFake.bulk_failure = None
    SourcesFake.bulk_asked = []
    monkeypatch.setattr(router, "InternalClient", SourcesFake)
    return SourcesFake


def _seed(knowledge_db, note_id, sources, drive="test-drive"):
    path = f"{note_id}.md"
    with knowledge_db() as s:
        s.add(NoteOrigin(drive=drive, note_path=path, note_file_id=note_id, origin="manual", health="healthy"))
        s.flush()
        for sid in sources:
            s.add(NoteOriginSource(drive=drive, note_path=path, source_file_id=sid))
        s.commit()


def _fm(ids, body=""):
    lines = "".join(f'  - "{i}"\n' for i in ids)
    return f"---\nsource_file_ids:\n{lines}---\n{body}"


def post(client, ids, drive="test-drive"):
    return client.post("/notes/sources", json={"file_ids": ids}, headers={"X-Lit-Drive": drive})


def test_order_follows_frontmatter_not_the_index(client, knowledge_db, fake):
    """SPEC-ADDON-131 item 1 Sources 3"""
    _seed(knowledge_db, "n1", ["a", "b", "c"])
    fake.contents = {"n1": _fm(["c", "a", "b"])}
    fake.files = {i: _file(i) for i in "abc"}
    res = post(client, ["n1"])
    assert res.status_code == 200
    assert [s["source_file_id"] for s in res.json()["notes"]["n1"]] == ["c", "a", "b"]
    assert res.json()["notes"]["n1"][0]["title"] == "T-c"


def test_drops_sources_bulk_omits_or_reports_on_another_drive(client, knowledge_db, fake):
    """SPEC-ADDON-131 I7: trashed (omitted) and other-drive sources never come back."""
    _seed(knowledge_db, "n1", ["a", "b", "c"])
    fake.contents = {"n1": _fm(["a", "b", "c"])}
    fake.files = {"a": _file("a"), "c": _file("c", drive="other")}  # b is trashed
    assert [s["source_file_id"] for s in post(client, ["n1"]).json()["notes"]["n1"]] == ["a"]


def test_note_without_kept_source_maps_to_empty_list(client, knowledge_db, fake):
    """SPEC-ADDON-131 Sources 6"""
    _seed(knowledge_db, "n1", ["a"])
    fake.contents = {"n1": _fm(["a"])}
    assert post(client, ["n1"]).json() == {"notes": {"n1": []}}


@pytest.mark.parametrize(
    "body,expected",
    [
        ("see loft://a?t=75 and loft://a?t=9", {"t": 75}),
        ("loft://a?page=3 then loft://a?t=5", {"page": 3}),
        ("loft://b?t=1 only", None),
        ("no links", None),
    ],
)
def test_locator_is_the_first_link_to_that_source(client, knowledge_db, fake, body, expected):
    """SPEC-ADDON-131 I11"""
    _seed(knowledge_db, "n1", ["a", "b"])
    fake.contents = {"n1": _fm(["a"], body)}
    fake.files = {"a": _file("a"), "b": _file("b")}
    assert post(client, ["n1"]).json()["notes"]["n1"][0]["locator"] == expected


def test_failed_content_read_falls_back_to_index_order_without_locators(
    client, knowledge_db, fake, caplog
):
    """SPEC-ADDON-131 Sources 3, item 8"""
    _seed(knowledge_db, "n1", ["b", "a"])
    _seed(knowledge_db, "n2", ["z"])
    fake.content_failures = {"n1": InternalAPIError(500, "x")}
    fake.contents = {"n2": _fm(["z"], "loft://z?t=4")}
    fake.files = {i: _file(i) for i in "abz"}
    with caplog.at_level(logging.WARNING):
        res = post(client, ["n1", "n2"]).json()["notes"]
    assert [(s["source_file_id"], s["locator"]) for s in res["n1"]] == [("a", None), ("b", None)]
    assert res["n2"][0]["locator"] == {"t": 4}
    assert any("n1" in r.getMessage() for r in caplog.records)


def test_transport_error_on_content_read_also_falls_back(client, knowledge_db, fake):
    _seed(knowledge_db, "n1", ["a"])
    fake.content_failures = {"n1": httpx.ConnectError("down")}
    fake.files = {"a": _file("a")}
    assert post(client, ["n1"]).json()["notes"]["n1"][0]["locator"] is None


@pytest.mark.parametrize("ids", [[], [f"n{i}" for i in range(61)]])
def test_422_for_empty_or_too_many_ids(client, knowledge_db, fake, ids):
    """SPEC-ADDON-131 I20"""
    assert post(client, ids).status_code == 422


def test_60_ids_are_accepted(client, knowledge_db, fake):
    assert post(client, [f"n{i}" for i in range(60)]).status_code == 200


@pytest.mark.parametrize("failure", [InternalAPIError(500, "x"), httpx.ConnectError("down")])
def test_503_when_bulk_fails(client, knowledge_db, fake, failure):
    _seed(knowledge_db, "n1", ["a"])
    fake.contents = {"n1": _fm(["a"])}
    fake.bulk_failure = failure
    assert post(client, ["n1"]).status_code == 503


def test_never_reads_content_of_a_note_not_on_the_header_drive(client, knowledge_db, fake):
    """SPEC-ADDON-131 I7"""
    _seed(knowledge_db, "mine", ["a"])
    _seed(knowledge_db, "theirs", ["a"], drive="other")
    fake.contents = {"mine": _fm(["a"]), "theirs": _fm(["a"]), "unknown": _fm(["a"])}
    fake.files = {"a": _file("a")}
    res = post(client, ["mine", "theirs", "unknown"]).json()["notes"]
    assert list(res) == ["mine"]
    assert fake.read == ["mine"]


def test_drive_header_is_required(client, knowledge_db, fake):
    assert client.post("/notes/sources", json={"file_ids": ["n"]}).status_code == 400
    assert client.get("/notes/with-sources").status_code == 400


def test_with_sources_lists_this_drives_notes_with_a_source_row(client, knowledge_db, fake):
    """SPEC-ADDON-131 Home 2"""
    _seed(knowledge_db, "n1", ["a", "b"])
    _seed(knowledge_db, "n2", [])
    _seed(knowledge_db, "n3", ["a"], drive="other")
    res = client.get("/notes/with-sources", headers={"X-Lit-Drive": "test-drive"})
    assert res.json() == {"ids": ["n1"]}
    assert fake.read == []
