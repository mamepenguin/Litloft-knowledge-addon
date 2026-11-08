"""SPEC-ADDON-082: notes saved through the Ask save land unverified.

The save route is driven through ``FakeInternalClient``. The startup pass is
driven through the real ``InternalClient`` with its HTTP layer replaced, so the
test does not depend on where the pass imports the client from: what core
would have received is the observable.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.models import NoteOrigin, NoteOriginSource

TRUST_PATH = re.compile(r"/api/internal/files/([^/]+)/trust-tier$")


def _post_note(client, viewer_cookie, *, origin: str | None = "ask_answer",
               filename: str = "my-note", drive: str = "test-drive"):
    payload = {
        "filename": filename,
        "folder": "Ask",
        "content": "---\norigin: ask_answer\n---\n\n# Q\n\nA\n",
        "source_file_ids": ["src000000aa"],
    }
    if origin is not None:
        payload["origin"] = origin
    return client.post(
        "/notes", json=payload, headers={**viewer_cookie, "X-Lit-Drive": drive},
    )


def _origin_row(knowledge_db, note_file_id: str) -> NoteOrigin:
    session = knowledge_db()
    try:
        row = session.query(NoteOrigin).filter(
            NoteOrigin.note_file_id == note_file_id
        ).one()
        session.expunge(row)
        return row
    finally:
        session.close()


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _is_now(value: datetime | None, before: datetime) -> bool:
    if value is None:
        return False
    stamp = _as_utc(value)
    return before - timedelta(seconds=1) <= stamp <= datetime.now(UTC) + timedelta(seconds=1)


# ---------------------------------------------------------------------------
# POST /notes
# ---------------------------------------------------------------------------


class TestTheSaveRoute:
    @pytest.mark.parametrize("origin", ["ask_answer", None], ids=["named", "schema-default"])
    def test_an_ask_note_is_declared_unverified_and_marked_declared(
        self, origin, client, fake_internal, viewer_cookie, knowledge_db,
    ):
        """SPEC-ADDON-082 1, I8 and I9: one declaration; ``trust_declared_at`` set to now."""
        before = datetime.now(UTC)

        r = _post_note(client, viewer_cookie, origin=origin)

        assert r.status_code == 201, r.text
        note_id = r.json()["note_file_id"]
        assert fake_internal.captured_trust_declarations == [
            {"file_id": note_id, "tier": "unverified"}
        ]
        assert _is_now(_origin_row(knowledge_db, note_id).trust_declared_at, before)

    def test_a_viewer_who_already_ruled_answers_201_and_marks_declared(
        self, client, fake_internal, viewer_cookie, knowledge_db,
    ):
        """SPEC-ADDON-082 1 and I8: 409 means the viewer's ruling stands."""
        fake_internal.raise_on_declare_trust_tier = 409
        before = datetime.now(UTC)

        r = _post_note(client, viewer_cookie)

        assert r.status_code == 201, r.text
        assert _is_now(
            _origin_row(knowledge_db, r.json()["note_file_id"]).trust_declared_at, before,
        )

    @pytest.mark.parametrize("status", [403, 404, 503])
    def test_a_rejected_declaration_is_502_and_the_note_stays(
        self, status, client, fake_internal, viewer_cookie, knowledge_db,
    ):
        """SPEC-ADDON-082 failure cases and I8: 502, row committed, event sent, column null."""
        fake_internal.raise_on_declare_trust_tier = status

        r = _post_note(client, viewer_cookie)

        assert r.status_code == 502
        assert "unverified" in r.json()["detail"]
        assert len(fake_internal.captured_text_writes) == 1
        verify = knowledge_db()
        rows = verify.query(NoteOrigin).all()
        verify.close()
        assert len(rows) == 1
        assert rows[0].origin == "ask_answer"
        assert rows[0].trust_declared_at is None
        assert [e["event"] for e in fake_internal.captured_addon_events].count(
            "knowledge.note.created"
        ) == 1

    @pytest.mark.parametrize(
        "error",
        [
            httpx.ConnectError("core unreachable"),
            httpx.ReadTimeout("core too slow"),
        ],
        ids=["connect", "timeout"],
    )
    def test_a_transport_error_is_502_and_the_note_stays(
        self, error, client, fake_internal, viewer_cookie, knowledge_db,
    ):
        """SPEC-ADDON-082 failure cases: a transport error is caught, unlike the clip route."""
        fake_internal.transport_error_on_declare_trust_tier = error

        r = _post_note(client, viewer_cookie)

        assert r.status_code == 502
        assert "unverified" in r.json()["detail"]
        verify = knowledge_db()
        rows = verify.query(NoteOrigin).all()
        verify.close()
        assert len(rows) == 1
        assert rows[0].trust_declared_at is None
        assert [e["event"] for e in fake_internal.captured_addon_events].count(
            "knowledge.note.created"
        ) == 1

    def test_a_capture_note_is_never_declared(
        self, client, fake_internal, viewer_cookie, knowledge_db,
    ):
        """SPEC-ADDON-082 1 and I8: ``source_capture`` notes stay verified, column null."""
        r = client.post(
            "/captures/commit",
            json={
                "target": {
                    "mode": "new", "folder": "Research",
                    "filename": "sources.md", "title": "Sources",
                },
                "captures": [{
                    "source_file_id": "abc123def456",
                    "filename": "x.mp4",
                    "file_type": "video",
                    "kind": "transcript",
                    "locator": {"seconds": 65, "end_seconds": 70},
                    "quote": "Quoted text",
                }],
            },
            headers={**viewer_cookie, "X-Lit-Drive": "test-drive"},
        )

        assert r.status_code == 200, r.text
        assert fake_internal.captured_trust_declarations == []
        verify = knowledge_db()
        rows = verify.query(NoteOrigin).all()
        verify.close()
        assert [row.origin for row in rows] == ["source_capture"]
        assert rows[0].trust_declared_at is None


# ---------------------------------------------------------------------------
# The startup pass
# ---------------------------------------------------------------------------


class Core:
    """Core's Internal API as the real client reaches it: trust-tier PUTs are recorded."""

    def __init__(self):
        self.declared: list[str] = []
        self.status: dict[str, int] = {}
        self.unreachable: set[str] = set()
        self.delay: float = 0.0
        self.everything_unreachable = False

    async def handler(self, request: httpx.Request) -> httpx.Response:
        import asyncio

        if self.everything_unreachable:
            raise httpx.ConnectError("core unreachable", request=request)
        match = TRUST_PATH.search(request.url.path)
        if request.method != "PUT" or match is None:
            return httpx.Response(404, json={"detail": "not stubbed"})
        file_id = match.group(1)
        if self.delay:
            await asyncio.sleep(self.delay)
        self.declared.append(file_id)
        assert json.loads(request.read()) == {"tier": "unverified"}
        if file_id in self.unreachable:
            raise httpx.ConnectError("core unreachable", request=request)
        return httpx.Response(self.status.get(file_id, 204))


@pytest.fixture()
def core(monkeypatch):
    from app import internal_client

    fake = Core()
    original = httpx.AsyncClient

    def _factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(fake.handler)
        return original(*args, **kwargs)

    monkeypatch.setattr(internal_client, "CORE_INTERNAL_SECRET", "topsecret")
    monkeypatch.setattr(internal_client.httpx, "AsyncClient", _factory)
    return fake


def _seed(knowledge_db, rows: list[tuple[str, str | None, datetime | None]]) -> None:
    session = knowledge_db()
    for index, (file_id, origin, declared) in enumerate(rows):
        row = NoteOrigin(
            drive="test-drive",
            note_path=f"Ask/n{index}.md",
            note_file_id=file_id,
            origin=origin,
            health="healthy",
        )
        row.trust_declared_at = declared
        session.add(row)
    session.commit()
    session.close()


def _declared_at(knowledge_db) -> dict[str, datetime | None]:
    session = knowledge_db()
    try:
        return {row.note_file_id: row.trust_declared_at for row in session.query(NoteOrigin)}
    finally:
        session.close()


def _start_and_wait(core: Core, expected: set[str], *, settle: float = 0.3):
    """Start the app, wait (bounded) for ``expected`` declarations, then stop it."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        deadline = time.monotonic() + 5
        while set(core.declared) < expected and time.monotonic() < deadline:
            time.sleep(0.05)
        time.sleep(settle)
        health = client.get("/health")
    return health


ASK_NULL = "askNull00001"
ASK_DONE = "askDone00001"
ASK_TRASHED = "askTrash0001"
ASK_FAILING = "askFail00001"
ASK_UNREACHABLE = "askConn00001"
CAPTURE = "capture00001"
SUMMARY = "summary00001"
NO_ORIGIN = "noOrigin0001"


class TestTheStartupPass:
    def test_only_undeclared_ask_notes_are_declared_and_only_204_or_409_marks_them(
        self, knowledge_db, core,
    ):
        """SPEC-ADDON-082 2 and I9: ask_answer rows still null, one call each."""
        _seed(knowledge_db, [
            (ASK_NULL, "ask_answer", None),
            (ASK_DONE, "ask_answer", datetime(2026, 1, 1, tzinfo=UTC)),
            (ASK_TRASHED, "ask_answer", None),
            (ASK_FAILING, "ask_answer", None),
            (ASK_UNREACHABLE, "ask_answer", None),
            ("askRuled0001", "ask_answer", None),
            (CAPTURE, "source_capture", None),
            (SUMMARY, "detailed_summary", None),
            (NO_ORIGIN, None, None),
        ])
        core.status = {ASK_TRASHED: 404, ASK_FAILING: 503, "askRuled0001": 409}
        core.unreachable = {ASK_UNREACHABLE}
        before = datetime.now(UTC)
        expected = {ASK_NULL, ASK_TRASHED, ASK_FAILING, ASK_UNREACHABLE, "askRuled0001"}

        _start_and_wait(core, expected)

        assert sorted(core.declared) == sorted(expected)
        stamps = _declared_at(knowledge_db)
        assert _is_now(stamps[ASK_NULL], before)
        assert _is_now(stamps["askRuled0001"], before)
        assert _as_utc(stamps[ASK_DONE]) == datetime(2026, 1, 1, tzinfo=UTC)
        for still_null in (ASK_TRASHED, ASK_FAILING, ASK_UNREACHABLE, CAPTURE, SUMMARY, NO_ORIGIN):
            assert stamps[still_null] is None

    def test_the_next_start_retries_only_what_did_not_succeed(self, knowledge_db, core):
        """SPEC-ADDON-082 2 and I9: a declared row makes no call at the next start."""
        _seed(knowledge_db, [
            (ASK_NULL, "ask_answer", None),
            (ASK_TRASHED, "ask_answer", None),
        ])
        core.status = {ASK_TRASHED: 404}

        _start_and_wait(core, {ASK_NULL, ASK_TRASHED})
        first = sorted(core.declared)
        core.declared.clear()
        _start_and_wait(core, {ASK_TRASHED})

        assert first == sorted([ASK_NULL, ASK_TRASHED])
        assert core.declared == [ASK_TRASHED]

    def test_health_answers_while_the_pass_waits_on_core(self, knowledge_db, core):
        """SPEC-ADDON-082 2 and I9: the pass runs in the background and never delays /health."""
        from fastapi.testclient import TestClient

        from app.main import app

        _seed(knowledge_db, [(ASK_NULL, "ask_answer", None)])
        core.delay = 2.0

        started = time.monotonic()
        with TestClient(app) as client:
            health = client.get("/health")
            answered_after = time.monotonic() - started
            deadline = time.monotonic() + 5
            while not core.declared and time.monotonic() < deadline:
                time.sleep(0.05)

        assert health.status_code == 200
        assert answered_after < 1.5
        assert core.declared == [ASK_NULL]

    def test_an_unreachable_core_neither_blocks_nor_stops_startup(self, knowledge_db, core):
        """SPEC-ADDON-082 2: a transport error keeps the row null and the app serving."""
        _seed(knowledge_db, [(ASK_NULL, "ask_answer", None), (ASK_TRASHED, "ask_answer", None)])
        core.unreachable = {ASK_NULL, ASK_TRASHED}

        health = _start_and_wait(core, {ASK_NULL, ASK_TRASHED})

        assert health.status_code == 200
        assert sorted(core.declared) == sorted([ASK_NULL, ASK_TRASHED])
        assert set(_declared_at(knowledge_db).values()) == {None}

    def test_a_failed_declaration_is_logged_with_the_file_id_and_status(
        self, knowledge_db, core, caplog,
    ):
        """SPEC-ADDON-082 failure cases and 8: one line per failed file, with id and status."""
        _seed(knowledge_db, [(ASK_FAILING, "ask_answer", None)])
        core.status = {ASK_FAILING: 503}
        caplog.set_level(logging.DEBUG)

        _start_and_wait(core, {ASK_FAILING})

        assert core.declared == [ASK_FAILING]
        assert any(
            ASK_FAILING in record.getMessage() and "503" in record.getMessage()
            for record in caplog.records
        )


# ---------------------------------------------------------------------------
# The migration
# ---------------------------------------------------------------------------


def _without_trust_declared_at(engine) -> None:
    """Shape the table as it was before the column existed."""
    columns = {c["name"] for c in inspect(engine).get_columns("note_origins")}
    if "trust_declared_at" in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE note_origins DROP COLUMN trust_declared_at"))


def _snapshot(engine) -> tuple[list[dict], list[dict]]:
    with engine.connect() as conn:
        origins = [
            {k: v for k, v in row._mapping.items() if k != "trust_declared_at"}
            for row in conn.execute(text("SELECT * FROM note_origins ORDER BY drive, note_path"))
        ]
        sources = [
            dict(row._mapping)
            for row in conn.execute(text(
                "SELECT * FROM note_origin_sources ORDER BY drive, note_path, source_file_id"
            ))
        ]
    return origins, sources


def test_the_migration_adds_a_null_column_and_keeps_every_row(tmp_path, monkeypatch):
    """SPEC-ADDON-082 4 and I10: the column is added as null, rows untouched, twice is a no-op."""
    import app.database as database
    from app.models import Base

    engine = create_engine(
        f"sqlite:///{tmp_path / 'before.db'}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, future=True)()
    for index, origin in enumerate(("ask_answer", "source_capture", "detailed_summary")):
        session.add(NoteOrigin(
            drive="test-drive", note_path=f"Ask/n{index}.md",
            note_file_id=f"note0000000{index}", origin=origin, health="healthy",
            tags_synced_at=datetime(2026, 2, 3, 4, 5, 6),
        ))
        session.flush()
        session.add(NoteOriginSource(
            drive="test-drive", note_path=f"Ask/n{index}.md", source_file_id=f"src{index}",
        ))
    session.commit()
    session.close()
    _without_trust_declared_at(engine)
    before = _snapshot(engine)

    monkeypatch.setattr(database, "engine", engine)
    database.init_schema()
    after_first = _snapshot(engine)
    database.init_schema()
    after_second = _snapshot(engine)

    columns = {c["name"] for c in inspect(engine).get_columns("note_origins")}
    assert "trust_declared_at" in columns
    with engine.connect() as conn:
        values = conn.execute(text("SELECT trust_declared_at FROM note_origins")).scalars().all()
    assert values == [None, None, None]
    assert after_first == before
    assert after_second == before
