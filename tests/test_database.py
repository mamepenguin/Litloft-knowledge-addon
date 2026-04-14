"""Verify the schema created by ``init_schema()`` has the shape we rely on.

Specifically:
- All three tables exist
- ``user_vault_state`` PK is the composite ``(viewer_id, drive)`` —
  lets each user pick a different active Vault per drive while keeping
  "exactly one active per (user, drive)" as a DB invariant.
- CASCADE DELETE from user_vaults → user_vault_state works
- unique (viewer_id, drive, path) on user_vaults is enforced
- Migration drops legacy single-PK ``user_vault_state`` on startup
"""
import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

# Base import kept for potential future use; models are re-imported inside tests.


def test_tables_exist(knowledge_db):
    import app.database as database
    insp = inspect(database.engine)
    names = set(insp.get_table_names())
    assert {"user_vaults", "user_vault_state", "clip_jobs"} <= names


def test_user_vault_state_pk_is_viewer_id_and_drive(knowledge_db):
    import app.database as database
    insp = inspect(database.engine)
    pks = insp.get_pk_constraint("user_vault_state")
    assert set(pks["constrained_columns"]) == {"viewer_id", "drive"}


def test_unique_vault_location(knowledge_db):
    from app.models import UserVault

    Session = knowledge_db
    s = Session()
    s.add(UserVault(viewer_id="abc", label="A", drive="d1", path="Notes"))
    s.commit()
    s.add(UserVault(viewer_id="abc", label="A2", drive="d1", path="Notes"))
    with pytest.raises(IntegrityError):
        s.commit()
    s.rollback()


def test_different_viewers_can_share_location(knowledge_db):
    from app.models import UserVault

    Session = knowledge_db
    s = Session()
    s.add(UserVault(viewer_id="u1", label="A", drive="d1", path="Notes"))
    s.add(UserVault(viewer_id="u2", label="A", drive="d1", path="Notes"))
    s.commit()  # no error — (viewer_id, drive, path) composite unique
    assert s.query(UserVault).count() == 2


def test_vault_delete_cascades_state(knowledge_db):
    from app.models import UserVault, UserVaultState

    Session = knowledge_db
    s = Session()
    v = UserVault(viewer_id="abc", label="A", drive="d1", path="Notes")
    s.add(v)
    s.commit()
    s.add(UserVaultState(viewer_id="abc", drive="d1", active_vault_id=v.id))
    s.commit()
    assert s.query(UserVaultState).count() == 1
    s.delete(v)
    s.commit()
    assert s.query(UserVaultState).count() == 0  # CASCADE


def test_active_vault_state_independent_per_drive(knowledge_db):
    """Two drives for the same user keep independent active Vaults."""
    from app.models import UserVault, UserVaultState

    Session = knowledge_db
    s = Session()
    v1 = UserVault(viewer_id="u1", label="Work", drive="work", path="w")
    v2 = UserVault(viewer_id="u1", label="Private", drive="private", path="p")
    s.add_all([v1, v2])
    s.commit()
    s.add(UserVaultState(viewer_id="u1", drive="work", active_vault_id=v1.id))
    s.add(UserVaultState(viewer_id="u1", drive="private", active_vault_id=v2.id))
    s.commit()
    rows = s.query(UserVaultState).filter_by(viewer_id="u1").all()
    assert {r.drive: r.active_vault_id for r in rows} == {
        "work": v1.id,
        "private": v2.id,
    }


def test_legacy_user_vault_state_table_is_dropped(tmp_path, monkeypatch):
    """Startup migration drops a legacy single-PK user_vault_state.

    We rebuild the on-disk layout from scratch with the legacy schema,
    then point ``app.database.engine`` at it, call ``init_schema()``,
    and assert the composite PK is in place.
    """
    import app.database as database

    db_path = tmp_path / "legacy.db"
    legacy_engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    # Legacy schema: single-column PK, no drive
    with legacy_engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE user_vault_state ("
            "  viewer_id VARCHAR(16) PRIMARY KEY,"
            "  active_vault_id INTEGER NOT NULL,"
            "  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
            ")"
        ))

    monkeypatch.setattr(database, "engine", legacy_engine)
    # init_schema should drop the legacy table and rebuild
    database.init_schema()

    insp = inspect(legacy_engine)
    pks = insp.get_pk_constraint("user_vault_state")
    assert set(pks["constrained_columns"]) == {"viewer_id", "drive"}
