"""Unit tests for the frontmatter reconcile scanner.

We exercise ``reconcile_once`` with a stubbed InternalClient so we can
drive the scanner through every branch without hitting core. The
scanner_loop wrapper is a simple asyncio.sleep loop and is not tested
directly (its logic is single-line + cancellation, and the FastAPI
lifespan test would own it).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.models import NoteOrigin, NoteOriginSource, UserVault
from app.services import note_scanner


def _seed_vault(session) -> UserVault:
    vault = UserVault(
        viewer_id="v0000000000000000",
        label="T",
        drive="test-drive",
        path="Vault",
    )
    session.add(vault)
    session.commit()
    session.refresh(vault)
    session.expunge(vault)
    return vault


def _seed_note(
    session,
    vault: UserVault,
    *,
    note_path: str = "n.md",
    note_file_id: str = "nNote0000001",
    source_ids: list[str] | None = None,
    last_synced_at: datetime | None = None,
    origin: str | None = "detailed_summary",
    origin_ref: str | None = None,
) -> NoteOrigin:
    row = NoteOrigin(
        vault_id=vault.id,
        note_path=note_path,
        note_file_id=note_file_id,
        origin=origin,
        origin_ref=origin_ref,
        approved_at=datetime.now(UTC),
        health="healthy",
    )
    if last_synced_at is not None:
        row.last_synced_at = last_synced_at
    session.add(row)
    for sid in source_ids or []:
        session.add(
            NoteOriginSource(
                vault_id=vault.id,
                note_path=note_path,
                source_file_id=sid,
            )
        )
    session.commit()
    session.refresh(row)
    session.expunge(row)
    return row


class _FakeClient:
    """Minimal InternalClient stub for the scanner."""

    def __init__(
        self,
        *,
        file_info: dict[str, dict] | None = None,
        file_content: dict[str, str] | None = None,
        raise_on_info: dict[str, int] | None = None,
    ) -> None:
        self._info = file_info or {}
        self._content = file_content or {}
        self._info_errors = raise_on_info or {}
        self.content_calls: list[str] = []

    async def get_file(self, file_id: str) -> dict:
        from app.internal_client import InternalAPIError

        if file_id in self._info_errors:
            raise InternalAPIError(self._info_errors[file_id], "forced")
        if file_id not in self._info:
            raise InternalAPIError(404, "not found")
        return self._info[file_id]

    async def get_file_content(self, file_id: str) -> str:
        self.content_calls.append(file_id)
        return self._content.get(file_id, "")


def _iso(dt: datetime) -> str:
    return dt.isoformat()


@pytest.mark.anyio
async def test_no_rows_returns_zero(knowledge_db):
    client = _FakeClient()
    stats = await note_scanner.reconcile_once(client)
    assert stats.scanned == 0
    assert stats.updated == 0
    assert stats.errors == 0


@pytest.mark.anyio
async def test_unchanged_note_skipped(knowledge_db):
    session = knowledge_db()
    vault = _seed_vault(session)
    now = datetime.now(UTC)
    _seed_note(
        session,
        vault,
        note_file_id="nKeep0000001",
        source_ids=["srcA"],
        last_synced_at=now,
    )
    session.close()

    client = _FakeClient(
        file_info={
            "nKeep0000001": {
                "id": "nKeep0000001",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                # same timestamp as last_synced_at → no work
                "updated_at": _iso(now),
            }
        }
    )
    stats = await note_scanner.reconcile_once(client)

    assert stats.scanned == 1
    assert stats.updated == 0
    assert client.content_calls == []


@pytest.mark.anyio
async def test_updated_note_reparses_frontmatter(knowledge_db):
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nEdit0000001",
        source_ids=["orig-src"],
        last_synced_at=past,
        origin_ref="intelligence:orig-src/detailed_summary",
    )
    vault_id = vault.id
    session.close()

    fresh = datetime.now(UTC)
    client = _FakeClient(
        file_info={
            "nEdit0000001": {
                "id": "nEdit0000001",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(fresh),
            }
        },
        file_content={
            "nEdit0000001": (
                "---\n"
                "origin: detailed_summary\n"
                "source_file_ids:\n"
                "  - new-src-1\n"
                "  - new-src-2\n"
                "origin_ref: intelligence:new-src-1/detailed_summary\n"
                "approved_at: \"2026-04-21T10:00:00Z\"\n"
                "---\n"
                "\n"
                "# Retitled\n"
                "body\n"
            )
        },
    )

    stats = await note_scanner.reconcile_once(client)

    assert stats.scanned == 1
    assert stats.updated == 1
    assert stats.errors == 0

    verify = knowledge_db()
    note = (
        verify.query(NoteOrigin)
        .filter(NoteOrigin.vault_id == vault_id, NoteOrigin.note_path == "n.md")
        .first()
    )
    assert note is not None
    assert note.origin == "detailed_summary"
    assert note.origin_ref == "intelligence:new-src-1/detailed_summary"
    # last_synced_at advanced past the old baseline.
    assert note.last_synced_at.replace(tzinfo=UTC) > past

    src_rows = (
        verify.query(NoteOriginSource.source_file_id)
        .filter(
            NoteOriginSource.vault_id == vault_id,
            NoteOriginSource.note_path == "n.md",
        )
        .all()
    )
    assert sorted(r[0] for r in src_rows) == ["new-src-1", "new-src-2"]


@pytest.mark.anyio
async def test_source_file_ids_shrink(knowledge_db):
    """Removing one of three sources drops exactly one row."""
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nShrink001xx",
        source_ids=["a", "b", "c"],
        last_synced_at=past,
    )
    vault_id = vault.id
    session.close()

    client = _FakeClient(
        file_info={
            "nShrink001xx": {
                "id": "nShrink001xx",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(datetime.now(UTC)),
            }
        },
        file_content={
            "nShrink001xx": (
                "---\n"
                "origin: detailed_summary\n"
                "source_file_ids:\n"
                "  - a\n"
                "  - c\n"
                "---\n"
                "body\n"
            )
        },
    )
    await note_scanner.reconcile_once(client)

    verify = knowledge_db()
    rows = (
        verify.query(NoteOriginSource.source_file_id)
        .filter(
            NoteOriginSource.vault_id == vault_id,
            NoteOriginSource.note_path == "n.md",
        )
        .all()
    )
    assert sorted(r[0] for r in rows) == ["a", "c"]


@pytest.mark.anyio
async def test_frontmatter_without_source_ids_clears_rows(knowledge_db):
    """User stripped the source_file_ids block entirely."""
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nStripXXX001",
        source_ids=["a", "b"],
        last_synced_at=past,
    )
    vault_id = vault.id
    session.close()

    client = _FakeClient(
        file_info={
            "nStripXXX001": {
                "id": "nStripXXX001",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(datetime.now(UTC)),
            }
        },
        file_content={
            "nStripXXX001": (
                "---\n"
                "origin: manual\n"
                "---\n"
                "just my notes now\n"
            )
        },
    )
    await note_scanner.reconcile_once(client)

    verify = knowledge_db()
    count = (
        verify.query(NoteOriginSource)
        .filter(
            NoteOriginSource.vault_id == vault_id,
            NoteOriginSource.note_path == "n.md",
        )
        .count()
    )
    assert count == 0
    note = (
        verify.query(NoteOrigin)
        .filter(NoteOrigin.vault_id == vault_id, NoteOrigin.note_path == "n.md")
        .first()
    )
    assert note.origin == "manual"


@pytest.mark.anyio
async def test_missing_note_file_id_is_skipped(knowledge_db):
    """Core returns 404 (note was purged) → leave the row for webhooks."""
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nGhostXXXXXX",
        source_ids=["a"],
        last_synced_at=past,
    )
    session.close()

    client = _FakeClient()  # no file_info → everything 404
    stats = await note_scanner.reconcile_once(client)

    assert stats.scanned == 1
    assert stats.updated == 0
    assert stats.errors == 0  # 404 is not an error in the stats


@pytest.mark.anyio
async def test_core_error_counts_as_error(knowledge_db):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, note_file_id="nFailXXXXXXX")
    session.close()

    client = _FakeClient(raise_on_info={"nFailXXXXXXX": 500})
    stats = await note_scanner.reconcile_once(client)

    assert stats.scanned == 1
    assert stats.updated == 0
    assert stats.errors == 1


@pytest.mark.anyio
async def test_missing_updated_at_skips(knowledge_db):
    """Core returns no updated_at → scanner can't decide, skip."""
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, note_file_id="nNoTSXXXXXXX")
    session.close()

    client = _FakeClient(
        file_info={
            "nNoTSXXXXXXX": {
                "id": "nNoTSXXXXXXX",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": None,
            }
        }
    )
    stats = await note_scanner.reconcile_once(client)
    assert stats.updated == 0
    assert stats.errors == 0


@pytest.mark.anyio
async def test_malformed_frontmatter_still_updates_timestamp(knowledge_db):
    """A .md with no frontmatter should just clear out source_file_ids."""
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nBadFMXXXXXX",
        source_ids=["a"],
        last_synced_at=past,
    )
    vault_id = vault.id
    session.close()

    client = _FakeClient(
        file_info={
            "nBadFMXXXXXX": {
                "id": "nBadFMXXXXXX",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(datetime.now(UTC)),
            }
        },
        file_content={"nBadFMXXXXXX": "# Plain note\nno metadata\n"},
    )
    stats = await note_scanner.reconcile_once(client)
    assert stats.updated == 1

    verify = knowledge_db()
    count = (
        verify.query(NoteOriginSource)
        .filter(
            NoteOriginSource.vault_id == vault_id,
            NoteOriginSource.note_path == "n.md",
        )
        .count()
    )
    assert count == 0


@pytest.fixture()
def anyio_backend():
    return "asyncio"
