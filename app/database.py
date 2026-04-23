"""SQLite-backed storage for Vault registrations and webclip job state.

knowledge owns its own DB — it never writes to the Litloft core DB. The
schema is managed by ``init_schema()`` (CREATE IF NOT EXISTS) called from
the FastAPI lifespan; there is no migration framework because the schema
is small and additive.
"""
import logging
import os
from contextlib import contextmanager

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import sessionmaker

from app.config import DB_PATH, DATA_DIR
from app.models import Base

logger = logging.getLogger(__name__)


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


def _migrate_user_vault_state_to_drive_scope() -> None:
    """Drop the legacy ``user_vault_state`` table when it predates the
    drive-scoped PK.

    The spec (2026-04-14-knowledge-drive-scope) accepts resetting active
    Vault selection: a user's real Vault rows live in ``user_vaults`` and
    survive; active pointers are cheap to re-pick per drive. We check for
    the ``drive`` column and drop the table if it's missing so the
    subsequent ``create_all`` rebuilds it with the composite PK.
    """
    insp = inspect(engine)
    if "user_vault_state" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("user_vault_state")}
    if "drive" in cols:
        return
    logger.warning(
        "knowledge: migrating user_vault_state to drive-scoped schema "
        "(dropping legacy table; active Vault selection will reset)"
    )
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE user_vault_state"))


def init_schema() -> None:
    """Create all tables if not present. Safe to call on every startup."""
    _migrate_user_vault_state_to_drive_scope()
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
