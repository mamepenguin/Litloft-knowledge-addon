"""Shared fixtures for knowledge addon tests.

Each test gets its own SQLite DB in a tmp dir, swapped in via monkeypatch
on the ``app.database`` module. The core's Litloft Internal API is not
contacted in unit tests — callers of ``InternalClient`` are stubbed at
their call sites as needed.
"""
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker


@pytest.fixture()
def knowledge_db(tmp_path, monkeypatch):
    db_path = tmp_path / "knowledge.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        future=True,
    )

    @event.listens_for(engine, "connect")
    def _enable_fk(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    # Patch the module-level engine / SessionLocal so all code paths
    # (routers, services) use this per-test DB.
    import app.database as database
    from app.models import Base

    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "SessionLocal", TestSession)

    yield TestSession


@pytest.fixture()
def client(knowledge_db):
    from app.main import app
    with TestClient(app) as c:
        yield c


class FakeInternalClient:
    """Stand-in for ``InternalClient`` in unit tests.

    Defaults: every caller can see drives ``["test-drive", "media"]``.
    Override via ``FakeInternalClient.accessible_drives_override`` (set at
    the class level so the router's freshly-constructed instance sees it).
    """

    accessible_drives_override: list[str] = ["test-drive", "media"]
    # Path collision simulation: paths in this set will 409 on first
    # create_text_file; the caller retries with a suffixed filename.
    create_text_file_collisions: set[str] = set()
    # If not None, every create_text_file call raises this status code.
    create_text_file_always_fails: int | None = None
    # Track distill calls so tests can assert registered relations.
    captured_relations: list[dict] = []
    captured_active_summaries: list[dict] = []
    captured_text_writes: list[dict] = []
    # Source-file metadata returned by ``get_file`` (keyed on file_id).
    file_info_override: dict[str, dict] = {}

    def __init__(self, cookie_header: str | None = None):
        self._cookie = cookie_header

    async def accessible_drives(self) -> list[str]:
        return list(FakeInternalClient.accessible_drives_override)

    async def create_text_file(self, drive, path, content):
        from app.internal_client import InternalAPIError

        FakeInternalClient.captured_text_writes.append(
            {"drive": drive, "path": path, "content": content}
        )
        if FakeInternalClient.create_text_file_always_fails is not None:
            raise InternalAPIError(
                FakeInternalClient.create_text_file_always_fails, "forced"
            )
        if path in FakeInternalClient.create_text_file_collisions:
            raise InternalAPIError(409, "exists")
        # Assign a deterministic file id based on the path so tests can
        # tell collision-retried rows apart.
        file_id = f"f{abs(hash(path)) % 10**10:010d}"
        return {"id": file_id, "drive": drive, "file_path": path}

    async def put_file_content(self, file_id, content, if_match):
        return '"new-etag"'

    async def get_file(self, file_id):
        override = FakeInternalClient.file_info_override.get(file_id)
        if override is not None:
            return override
        return {"id": file_id, "drive": "test-drive", "filename": "x.md"}

    async def create_file_relation(
        self, file_id_a, file_id_b, kind="related", viewer_id=None
    ):
        FakeInternalClient.captured_relations.append(
            {
                "file_id_a": file_id_a,
                "file_id_b": file_id_b,
                "kind": kind,
                "viewer_id": viewer_id,
            }
        )
        return {"id": 1}

    async def set_file_active_summary(self, file_id, summary_file_id):
        FakeInternalClient.captured_active_summaries.append(
            {"file_id": file_id, "summary_file_id": summary_file_id}
        )
        return {"file_id": file_id, "summary_file_id": summary_file_id}

    captured_addon_events: list[dict] = []

    async def emit_addon_event(self, event, data, drive=None):
        FakeInternalClient.captured_addon_events.append(
            {"event": event, "data": data, "drive": drive}
        )


@pytest.fixture()
def fake_internal(monkeypatch):
    """Swap InternalClient with FakeInternalClient wherever the routers
    import it, and reset the per-test accessible-drives override."""
    import app.routers.distill as distill
    import app.routers.vaults as vaults

    FakeInternalClient.accessible_drives_override = ["test-drive", "media"]
    FakeInternalClient.create_text_file_collisions = set()
    FakeInternalClient.create_text_file_always_fails = None
    FakeInternalClient.captured_relations = []
    FakeInternalClient.captured_active_summaries = []
    FakeInternalClient.captured_text_writes = []
    FakeInternalClient.file_info_override = {}
    FakeInternalClient.captured_addon_events = []
    monkeypatch.setattr(vaults, "InternalClient", FakeInternalClient)
    monkeypatch.setattr(distill, "InternalClient", FakeInternalClient)
    yield FakeInternalClient


@pytest.fixture()
def viewer_cookie():
    """Cookie header corresponding to a nickname of 'alice'. Tests that
    need a specific viewer_id import ``nickname_to_viewer_id`` directly."""
    return "hv_viewer=alice"
