"""Verify the schema created by ``init_schema()`` has the shape we rely on.

Specifically:
- All three tables exist
- ``user_vault_state.viewer_id`` is a PRIMARY KEY (single-active-vault
  invariant)
- CASCADE DELETE from user_vaults → user_vault_state works
- unique (viewer_id, drive, path) on user_vaults is enforced
"""
import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError


def test_tables_exist(knowledge_db):
    import app.database as database
    insp = inspect(database.engine)
    names = set(insp.get_table_names())
    assert {"user_vaults", "user_vault_state", "clip_jobs"} <= names


def test_user_vault_state_pk_is_viewer_id(knowledge_db):
    import app.database as database
    insp = inspect(database.engine)
    pks = insp.get_pk_constraint("user_vault_state")
    assert pks["constrained_columns"] == ["viewer_id"]


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
    s.add(UserVaultState(viewer_id="abc", active_vault_id=v.id))
    s.commit()
    assert s.query(UserVaultState).count() == 1
    s.delete(v)
    s.commit()
    assert s.query(UserVaultState).count() == 0  # CASCADE
