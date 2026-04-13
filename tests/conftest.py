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
