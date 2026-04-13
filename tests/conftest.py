"""Shared fixtures for knowledge addon tests.

Each test gets its own SQLite DB in a tmp dir, swapped in via monkeypatch
on the ``app.database`` module. The core's HomeVault Internal API is not
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

    def __init__(self, cookie_header: str | None = None):
        self._cookie = cookie_header

    async def accessible_drives(self) -> list[str]:
        return list(FakeInternalClient.accessible_drives_override)

    async def create_text_file(self, drive, path, content):
        return {"id": "fake12345678", "drive": drive, "file_path": path}

    async def put_file_content(self, file_id, content, if_match):
        return '"new-etag"'

    async def get_file(self, file_id):
        return {"id": file_id, "drive": "test-drive", "filename": "x.md"}


@pytest.fixture()
def fake_internal(monkeypatch):
    """Swap InternalClient with FakeInternalClient wherever the routers
    import it, and reset the per-test accessible-drives override."""
    import app.routers.vaults as vaults

    FakeInternalClient.accessible_drives_override = ["test-drive", "media"]
    monkeypatch.setattr(vaults, "InternalClient", FakeInternalClient)
    yield FakeInternalClient


@pytest.fixture()
def viewer_cookie():
    """Cookie header corresponding to a nickname of 'alice'. Tests that
    need a specific viewer_id import ``nickname_to_viewer_id`` directly."""
    return "hv_viewer=alice"
