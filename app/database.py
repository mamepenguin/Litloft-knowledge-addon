"""SQLite-backed storage for Vault registrations and webclip job state.

knowledge owns its own DB — it never writes to the HomeVault core DB. The
schema is managed by ``init_schema()`` (CREATE IF NOT EXISTS) called from
the FastAPI lifespan; there is no migration framework because the schema
is small and additive.
"""
import os
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.config import DB_PATH, DATA_DIR
from app.models import Base


def _engine_for(path: str):
    engine = create_engine(
        f"sqlite:///{path}",
        connect_args={"check_same_thread": False},
        future=True,
    )

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()

    return engine


DATA_DIR.mkdir(parents=True, exist_ok=True)
engine = _engine_for(str(DB_PATH))
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_schema() -> None:
    """Create all tables if not present. Safe to call on every startup."""
    Base.metadata.create_all(bind=engine)


@contextmanager
def session_scope():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db():
    """FastAPI dependency injecting a scoped Session."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
