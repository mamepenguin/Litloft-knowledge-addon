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


def _migrate_drop_note_origin_ref() -> None:
    """Drop the legacy ``note_origins.origin_ref`` column.

    Spec 2026-04-24-knowledge-frontmatter-schema-and-display §B1: the
    column held dead metadata (written + read + stored, never queried
    or branched on). SQLite 3.35+ supports ``ALTER TABLE ... DROP
    COLUMN`` natively; if that fails we skip silently because a leftover
    column is harmless (the ORM no longer references it) and the rebuild
    dance would risk data loss on restart.
    """
    insp = inspect(engine)
    if "note_origins" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("note_origins")}
    if "origin_ref" not in cols:
        return
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE note_origins DROP COLUMN origin_ref"))
        logger.info("knowledge: dropped legacy note_origins.origin_ref column")
    except Exception as exc:
        logger.warning(
            "knowledge: could not drop note_origins.origin_ref (%s); "
            "leaving column in place (harmless — ORM no longer uses it)",
            exc,
        )


def _migrate_add_tags_synced_at() -> None:
    """Add ``note_origins.tags_synced_at`` if the column is missing.

    Spec 2026-04-24-knowledge-tag-unification §D8: on the first scan
    after Phase 2 deploy every row's ``tags_synced_at`` is NULL, which
    tells ``note_scanner`` to force-fetch content and project frontmatter
    tags onto core ``File.tags``. The column is nullable with no server
    default so existing rows carry NULL without an explicit UPDATE —
    the scanner's NULL-check is the migration trigger.
    """
    insp = inspect(engine)
    if "note_origins" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("note_origins")}
    if "tags_synced_at" in cols:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE note_origins ADD COLUMN tags_synced_at DATETIME"))
    logger.info("knowledge: added note_origins.tags_synced_at column (tags projection pending)")


def init_schema() -> None:
    """Create all tables if not present. Safe to call on every startup."""
    _migrate_user_vault_state_to_drive_scope()
    Base.metadata.create_all(bind=engine)
    _migrate_drop_note_origin_ref()
    _migrate_add_tags_synced_at()


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
