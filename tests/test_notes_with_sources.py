"""SPEC-ADDON-131: `GET /notes/with-sources` and `POST /notes/sources`.

Invariant ids are those of docs/specs/notes-app.md in the core repository.
The core is stubbed on the wire (``httpx.MockTransport``) rather than by
replacing ``InternalClient`` in a router module, so these tests hold whichever
client method the routes use: what counts is the request the core receives.
"""
from __future__ import annotations

import logging
import re
from urllib.parse import unquote

import httpx
import pytest

from app.models import NoteOrigin, NoteOriginSource

DRIVE = "test-drive"
OTHER = "other-drive"
CONTENT = re.compile(r"/internal/files/([^/]+)/content$")
BULK = re.compile(r"/internal/files/bulk$")


class FakeCore:
    def __init__(self) -> None:
        self.contents: dict[str, str] = {}
        self.content_status: dict[str, int] = {}
        self.files: dict[str, dict] = {}
        self.bulk_status: int | None = None
        self.requests: list[httpx.Request] = []

    def content_reads(self) -> list[str]:
        out = []
        for req in self.requests:
            m = CONTENT.search(req.url.path)
            if m:
                out.append(unquote(m.group(1)))
        return out

    def bulk_bodies(self) -> list[list[str]]:
        import json

        return [
            json.loads(req.content)["file_ids"]
            for req in self.requests
            if BULK.search(req.url.path)
        ]

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        m = CONTENT.search(path)
        if m and request.method == "GET":
            fid = unquote(m.group(1))
            status = self.content_status.get(fid)
            if status is not None:
                return httpx.Response(status, json={"detail": "forced"})
            if fid not in self.contents:
                return httpx.Response(404, json={"detail": "not found"})
            return httpx.Response(
                200,
                content=self.contents[fid].encode("utf-8"),
                headers={"content-type": "text/plain; charset=utf-8"},
            )
        if BULK.search(path) and request.method == "POST":
            if self.bulk_status is not None:
                return httpx.Response(self.bulk_status, json={"detail": "forced"})
            import json

            ids = json.loads(request.content)["file_ids"]
            return httpx.Response(
                200,
                json={
                    "files": [self.files[i] for i in ids if i in self.files],
                    "not_found": [i for i in ids if i not in self.files],
                },
            )
        return httpx.Response(404, json={"detail": "unexpected"})


@pytest.fixture()
def core(monkeypatch):
    fake = FakeCore()
    original = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(fake.handle)
        return original(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    import app.internal_client as internal_client

    monkeypatch.setattr(internal_client.httpx, "AsyncClient", factory)
    return fake


def _source(fid: str, *, drive: str = DRIVE, title: str | None = None, folder: str = "Lectures",
            mime: str = "video/mp4", thumb: bool = True) -> dict:
    return {
        "id": fid,
        "drive": drive,
        "filename": f"{fid}.bin",
        "title": title or f"Title {fid}",
        "folder_path": folder,
        "mime_type": mime,
        "has_thumbnail": thumb,
        "file_type": "video",
        "file_size": 1,
        "thumbnail_url": f"/api/files/{fid}/thumbnail",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        "tags": [],
        "subtitles": [],
    }


def _note(session_factory, note_file_id: str, sources: list[str], *, drive: str = DRIVE,
          path: str | None = None) -> None:
    s = session_factory()
    note_path = path or f"Notes/{note_file_id}.md"
    s.add(NoteOrigin(drive=drive, note_path=note_path, note_file_id=note_file_id, origin="manual"))
    s.commit()
    for sid in sources:
        s.add(NoteOriginSource(drive=drive, note_path=note_path, source_file_id=sid))
    s.commit()
    s.close()


def _body(source_ids: list[str], text: str = "") -> str:
    listed = "".join(f"  - {sid}\n" for sid in source_ids)
    return f"---\nsource_file_ids:\n{listed}---\n{text}"


def _headers(drive: str | None = DRIVE) -> dict[str, str]:
    return {"X-Lit-Drive": drive} if drive is not None else {}


def _post(client, ids, drive: str | None = DRIVE):
    return client.post("/notes/sources", json={"file_ids": ids}, headers=_headers(drive))


class TestWithSources:
    """SPEC-ADDON-131 Home step 2, I7, item 10."""

    def test_spec_addon_131_lists_the_notes_of_the_drive_that_have_sources(self, client, knowledge_db, core):
        _note(knowledge_db, "nWith1", ["s1"])
        _note(knowledge_db, "nWith3", ["s1", "s2", "s3"])
        _note(knowledge_db, "nBare", [])
        _note(knowledge_db, "nOther", ["s9"], drive=OTHER)

        res = client.get("/notes/with-sources", headers=_headers())

        assert res.status_code == 200, res.text
        ids = res.json()["ids"]
        assert sorted(ids) == ["nWith1", "nWith3"]
        assert len(ids) == len(set(ids))

    def test_spec_addon_131_reads_the_knowledge_db_alone(self, client, knowledge_db, core):
        _note(knowledge_db, "nWith1", ["s1"])

        res = client.get("/notes/with-sources", headers=_headers())

        assert res.json() == {"ids": ["nWith1"]}
        assert core.requests == []

    def test_spec_addon_131_a_drive_with_no_such_note_answers_an_empty_list(self, client, knowledge_db, core):
        _note(knowledge_db, "nOther", ["s9"], drive=OTHER)
        _note(knowledge_db, "nBare", [])

        res = client.get("/notes/with-sources", headers=_headers())

        assert res.status_code == 200, res.text
        assert res.json() == {"ids": []}

    def test_spec_addon_131_the_other_drive_sees_only_its_own(self, client, knowledge_db, core):
        _note(knowledge_db, "nMine", ["s1"])
        _note(knowledge_db, "nTheirs", ["s9"], drive=OTHER)

        res = client.get("/notes/with-sources", headers=_headers(OTHER))

        assert res.json() == {"ids": ["nTheirs"]}


class TestSourcesValidation:
    """SPEC-ADDON-131 Sources step 1, I20."""

    def test_spec_addon_131_an_empty_list_is_422(self, client, knowledge_db, core):
        res = _post(client, [])

        assert res.status_code == 422
        assert core.content_reads() == []

    def test_spec_addon_131_more_than_60_ids_is_422(self, client, knowledge_db, core):
        _note(knowledge_db, "n0", ["s1"])

        res = _post(client, ["n0"] + [f"x{i}" for i in range(60)])

        assert res.status_code == 422
        assert core.content_reads() == []

    def test_spec_addon_131_sixty_ids_are_accepted(self, client, knowledge_db, core):
        _note(knowledge_db, "n0", ["s1"])
        core.contents["n0"] = _body(["s1"], "[x](loft://s1?t=5)")
        core.files["s1"] = _source("s1")

        res = _post(client, ["n0"] + [f"x{i}" for i in range(59)])

        assert res.status_code == 200, res.text
        assert list(res.json()["notes"]) == ["n0"]


class TestSourcesAnswer:
    """SPEC-ADDON-131 Sources steps 2-6, I7, I11."""

    def test_spec_addon_131_each_source_in_frontmatter_order_with_its_locator(self, client, knowledge_db, core):
        _note(knowledge_db, "nA", ["sVid", "sPdf", "sDoc"])
        core.contents["nA"] = _body(
            ["sVid", "sPdf", "sDoc"],
            "Intro [pdf](loft://sPdf?page=12) then [v](loft://sVid?t=3725) "
            "and later [v2](loft://sVid?t=10) and [doc](loft://sDoc).\n",
        )
        core.files["sVid"] = _source("sVid", title="Lecture", folder="Lectures", mime="video/mp4")
        core.files["sPdf"] = _source("sPdf", title="Paper", folder="", mime="application/pdf", thumb=False)
        core.files["sDoc"] = _source("sDoc", title="Guide", folder="Docs", mime="text/markdown")

        res = _post(client, ["nA"])

        assert res.status_code == 200, res.text
        assert res.json() == {
            "notes": {
                "nA": [
                    {
                        "source_file_id": "sVid",
                        "title": "Lecture",
                        "filename": "sVid.bin",
                        "folder_path": "Lectures",
                        "mime_type": "video/mp4",
                        "has_thumbnail": True,
                        "locator": {"t": 3725},
                    },
                    {
                        "source_file_id": "sPdf",
                        "title": "Paper",
                        "filename": "sPdf.bin",
                        "folder_path": "",
                        "mime_type": "application/pdf",
                        "has_thumbnail": False,
                        "locator": {"page": 12},
                    },
                    {
                        "source_file_id": "sDoc",
                        "title": "Guide",
                        "filename": "sDoc.bin",
                        "folder_path": "Docs",
                        "mime_type": "text/markdown",
                        "has_thumbnail": True,
                        "locator": None,
                    },
                ]
            }
        }
        assert core.bulk_bodies() and set(core.bulk_bodies()[0]) == {"sVid", "sPdf", "sDoc"}

    def test_spec_addon_131_frontmatter_order_is_kept_not_sorted(self, client, knowledge_db, core):
        _note(knowledge_db, "nA", ["a1", "z9"])
        core.contents["nA"] = _body(["z9", "a1"])
        core.files["a1"] = _source("a1")
        core.files["z9"] = _source("z9")

        res = _post(client, ["nA"])

        assert [s["source_file_id"] for s in res.json()["notes"]["nA"]] == ["z9", "a1"]

    def test_spec_addon_131_an_id_that_is_not_a_note_of_the_drive_is_left_out_and_never_read(
        self, client, knowledge_db, core
    ):
        _note(knowledge_db, "nMine", ["s1"])
        _note(knowledge_db, "nTheirs", ["s1"], drive=OTHER)
        for nid in ("nMine", "nTheirs", "plain"):
            core.contents[nid] = _body(["s1"])
        core.files["s1"] = _source("s1")

        res = _post(client, ["nMine", "nTheirs", "plain"])

        assert res.status_code == 200, res.text
        assert list(res.json()["notes"]) == ["nMine"]
        assert core.content_reads() == ["nMine"]

    def test_spec_addon_131_a_source_on_another_drive_or_not_active_is_dropped(self, client, knowledge_db, core):
        _note(knowledge_db, "nA", ["sHere", "sThere", "sGone"])
        core.contents["nA"] = _body(["sHere", "sThere", "sGone"])
        core.files["sHere"] = _source("sHere")
        core.files["sThere"] = _source("sThere", drive=OTHER)

        res = _post(client, ["nA"])

        assert [s["source_file_id"] for s in res.json()["notes"]["nA"]] == ["sHere"]

    def test_spec_addon_131_a_note_with_no_kept_source_maps_to_an_empty_list(self, client, knowledge_db, core):
        _note(knowledge_db, "nA", ["sThere"])
        _note(knowledge_db, "nB", ["s1"])
        core.contents["nA"] = _body(["sThere"])
        core.contents["nB"] = _body(["s1"])
        core.files["sThere"] = _source("sThere", drive=OTHER)
        core.files["s1"] = _source("s1")

        res = _post(client, ["nA", "nB"])

        assert res.json()["notes"]["nA"] == []
        assert [s["source_file_id"] for s in res.json()["notes"]["nB"]] == ["s1"]

    def test_spec_addon_131_the_locator_is_the_first_link_to_that_source(self, client, knowledge_db, core):
        _note(knowledge_db, "nA", ["s1", "s2", "s3"])
        core.contents["nA"] = _body(
            ["s1", "s2", "s3"],
            "[a](loft://s2?page=3) [b](loft://s1?page=4) [c](loft://s1?t=60) "
            "[d](loft://s3?t=0) [e](loft://s2?t=9)\n",
        )
        for sid in ("s1", "s2", "s3"):
            core.files[sid] = _source(sid)

        res = _post(client, ["nA"])

        locators = {s["source_file_id"]: s["locator"] for s in res.json()["notes"]["nA"]}
        assert locators == {"s1": {"page": 4}, "s2": {"page": 3}, "s3": {"t": 0}}

    def test_spec_addon_131_a_link_to_another_file_gives_no_locator(self, client, knowledge_db, core):
        _note(knowledge_db, "nA", ["s1"])
        core.contents["nA"] = _body(["s1"], "[x](loft://elsewhere?t=30) [y](loft://s1)\n")
        core.files["s1"] = _source("s1")

        res = _post(client, ["nA"])

        assert res.json()["notes"]["nA"][0]["locator"] is None

    def test_spec_addon_131_a_failed_read_falls_back_to_the_index_and_logs_the_note(
        self, client, knowledge_db, core, caplog
    ):
        _note(knowledge_db, "nA", ["s3", "s1", "s2"])
        core.content_status["nA"] = 500
        for sid in ("s1", "s2", "s3"):
            core.files[sid] = _source(sid)
        caplog.set_level(logging.WARNING)

        res = _post(client, ["nA"])

        assert res.status_code == 200, res.text
        sources = res.json()["notes"]["nA"]
        assert [s["source_file_id"] for s in sources] == ["s1", "s2", "s3"]
        assert [s["locator"] for s in sources] == [None, None, None]
        assert any(
            r.levelno == logging.WARNING and "nA" in r.getMessage() for r in caplog.records
        )

    def test_spec_addon_131_a_bulk_failure_is_503(self, client, knowledge_db, core):
        _note(knowledge_db, "nA", ["s1"])
        core.contents["nA"] = _body(["s1"])
        core.bulk_status = 500

        res = _post(client, ["nA"])

        assert res.status_code == 503

    def test_spec_addon_131_a_knowledge_db_failure_is_503(self, client, knowledge_db, core, monkeypatch):
        import app.database as database
        from sqlalchemy.exc import OperationalError

        _note(knowledge_db, "nA", ["s1"])
        core.contents["nA"] = _body(["s1"])
        core.files["s1"] = _source("s1")
        assert _post(client, ["nA"]).status_code == 200

        def broken(*_a, **_kw):
            raise OperationalError("SELECT 1", {}, Exception("database is locked"))

        monkeypatch.setattr(database, "SessionLocal", broken)

        res = _post(client, ["nA"])

        assert res.status_code == 503

