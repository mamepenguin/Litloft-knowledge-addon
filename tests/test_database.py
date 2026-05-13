"""Verify the schema created by ``init_schema()`` has the shape we rely on.

After the vault removal (spec 2026-05-13-knowledge-remove-vault):

- ``user_vaults`` / ``user_vault_state`` no longer exist.
- ``note_origins`` is keyed on ``(drive, note_path)``.
- ``note_origin_sources`` cascades from ``note_origins``.
- Legacy ``user_vaults`` / ``user_vault_state`` tables left over from a
  pre-removal install are dropped on startup.
"""
import pytest
from sqlalchemy import create_engine, inspect, text


def test_tables_exist(knowledge_db):
    import app.database as database
    insp = inspect(database.engine)
    names = set(insp.get_table_names())
    assert {
        "clip_jobs",
        "note_origins",
        "note_origin_sources",
        "file_active_summaries",
    } <= names
    # Vault tables must not be created.
    assert "user_vaults" not in names
    assert "user_vault_state" not in names


def test_note_origin_pk_is_drive_and_path(knowledge_db):
    import app.database as database
    insp = inspect(database.engine)
    pks = insp.get_pk_constraint("note_origins")
    assert set(pks["constrained_columns"]) == {"drive", "note_path"}


def test_note_origin_source_cascade_on_origin_delete(knowledge_db):
    """Deleting a NoteOrigin cascades to its NoteOriginSource rows."""
    from app.models import NoteOrigin, NoteOriginSource

    Session = knowledge_db
    s = Session()
    origin = NoteOrigin(
        drive="test-drive",
        note_path="AI-Drafts/foo-summary.md",
        note_file_id="notefile01",
        origin="detailed_summary",
    )
    s.add(origin)
    s.commit()
    s.add(
        NoteOriginSource(
            drive="test-drive",
            note_path="AI-Drafts/foo-summary.md",
            source_file_id="srcfile1",
        )
    )
    s.commit()
    assert s.query(NoteOriginSource).count() == 1

    s.delete(origin)
    s.commit()
    assert s.query(NoteOriginSource).count() == 0


def test_note_origin_source_reverse_lookup_index(knowledge_db):
    """Multiple notes can share a source_file_id (future multi-file summaries)."""
    from app.models import NoteOrigin, NoteOriginSource

    Session = knowledge_db
    s = Session()
    for idx, path in enumerate(("AI-Drafts/a.md", "AI-Drafts/b.md")):
        s.add(
            NoteOrigin(
                drive="test-drive",
                note_path=path,
                note_file_id=f"note000{idx:04d}",
                origin="detailed_summary",
            )
        )
    s.commit()
    for path in ("AI-Drafts/a.md", "AI-Drafts/b.md"):
        s.add(
            NoteOriginSource(
                drive="test-drive",
                note_path=path,
                source_file_id="shared-src",
            )
        )
    s.commit()

    hits = s.query(NoteOriginSource).filter_by(source_file_id="shared-src").all()
    assert len(hits) == 2
    assert {h.note_path for h in hits} == {"AI-Drafts/a.md", "AI-Drafts/b.md"}


def test_notes_in_different_drives_can_share_path(knowledge_db):
    """``(drive, note_path)`` PK lets the same relative path live in
    multiple drives without collision."""
    from app.models import NoteOrigin

    Session = knowledge_db
    s = Session()
    s.add(
        NoteOrigin(
            drive="d1",
            note_path="Notes/a.md",
            note_file_id="fAAAAAAAAAAA",
            origin="manual",
        )
    )
    s.add(
        NoteOrigin(
            drive="d2",
            note_path="Notes/a.md",
            note_file_id="fBBBBBBBBBBB",
            origin="manual",
        )
    )
    s.commit()
    assert s.query(NoteOrigin).count() == 2


def test_legacy_vault_tables_are_dropped(tmp_path, monkeypatch):
    """Startup migration drops legacy ``user_vaults`` / ``user_vault_state``
    tables left over from a pre-removal install.

    Rebuild the on-disk layout with the legacy tables, point the engine
    at it, call ``init_schema()``, and assert the legacy tables are gone.
    """
    import app.database as database

    db_path = tmp_path / "legacy.db"
    legacy_engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    with legacy_engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE user_vaults ("
            "  id INTEGER PRIMARY KEY,"
            "  viewer_id VARCHAR(16) NOT NULL,"
            "  label VARCHAR(64) NOT NULL,"
            "  drive VARCHAR(128) NOT NULL,"
            "  path VARCHAR(2048) NOT NULL"
            ")"
        ))
        conn.execute(text(
            "CREATE TABLE user_vault_state ("
            "  viewer_id VARCHAR(16) NOT NULL,"
            "  drive VARCHAR(128) NOT NULL,"
            "  active_vault_id INTEGER NOT NULL,"
            "  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"
            "  PRIMARY KEY (viewer_id, drive)"
            ")"
        ))

    monkeypatch.setattr(database, "engine", legacy_engine)
    database.init_schema()

    insp = inspect(legacy_engine)
    names = set(insp.get_table_names())
    assert "user_vaults" not in names
    assert "user_vault_state" not in names


def test_legacy_note_origins_with_vault_id_is_rebuilt(tmp_path, monkeypatch):
    """A legacy ``note_origins`` table that still uses ``vault_id`` is
    dropped on startup so the new schema can be created cleanly.

    Drive info cannot be recovered from a dropped user_vaults table, so
    the migration accepts the data loss; the frontmatter scanner
    repopulates rows from .md files on the next pass.
    """
    import app.database as database

    db_path = tmp_path / "legacy-no.db"
    legacy_engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    with legacy_engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE note_origins ("
            "  vault_id INTEGER NOT NULL,"
            "  note_path VARCHAR(4096) NOT NULL,"
            "  note_file_id VARCHAR(12) NOT NULL,"
            "  PRIMARY KEY (vault_id, note_path)"
            ")"
        ))
        conn.execute(text(
            "INSERT INTO note_origins (vault_id, note_path, note_file_id) "
            "VALUES (1, 'a.md', 'fAAAAAAAAAAA')"
        ))

    monkeypatch.setattr(database, "engine", legacy_engine)
    database.init_schema()

    insp = inspect(legacy_engine)
    cols = {c["name"] for c in insp.get_columns("note_origins")}
    assert "drive" in cols
    assert "vault_id" not in cols


def test_legacy_clip_jobs_without_drive_gets_drive_added(tmp_path, monkeypatch):
    """A legacy ``clip_jobs`` table without ``drive`` is migrated.

    Existing rows are cleared because the historical drive value cannot
    be recovered from ``(viewer_id, url)`` alone; the alternative
    (misattributing rows to an arbitrary drive) would violate the drive
    boundary.
    """
    import app.database as database

    db_path = tmp_path / "legacy-clipjobs.db"
    legacy_engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    with legacy_engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE clip_jobs ("
            "  id INTEGER PRIMARY KEY,"
            "  file_id VARCHAR(12) NOT NULL UNIQUE,"
            "  viewer_id VARCHAR(16) NOT NULL,"
            "  url VARCHAR(4096) NOT NULL,"
            "  status VARCHAR(16) NOT NULL DEFAULT 'fetching',"
            "  retry_count INTEGER NOT NULL DEFAULT 0,"
            "  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"
            "  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
            ")"
        ))
        conn.execute(text(
            "INSERT INTO clip_jobs (file_id, viewer_id, url) "
            "VALUES ('fAAA', 'v1', 'https://ok.example/')"
        ))

    monkeypatch.setattr(database, "engine", legacy_engine)
    database.init_schema()

    insp = inspect(legacy_engine)
    cols = {c["name"] for c in insp.get_columns("clip_jobs")}
    assert "drive" in cols
    # Legacy row was cleared because the historical drive is unrecoverable.
    with legacy_engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM clip_jobs")).scalar()
    assert count == 0
