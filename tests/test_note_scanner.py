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
    tags_synced_at: datetime | None | object = ...,
    origin: str | None = "detailed_summary",
) -> NoteOrigin:
    """Seed a NoteOrigin. By default ``tags_synced_at`` mirrors
    ``last_synced_at`` so tests predate Phase 2 land in an
    already-synced state. Pass ``tags_synced_at=None`` to test the
    migration branch (Phase 2 §D8)."""
    row = NoteOrigin(
        vault_id=vault.id,
        note_path=note_path,
        note_file_id=note_file_id,
        origin=origin,
        approved_at=datetime.now(UTC),
        health="healthy",
    )
    if last_synced_at is not None:
        row.last_synced_at = last_synced_at
    if tags_synced_at is ...:
        # default: mirror last_synced_at so pre-Phase-2 tests keep
        # their "no content fetch" expectation
        row.tags_synced_at = last_synced_at or datetime.now(UTC)
    else:
        row.tags_synced_at = tags_synced_at  # type: ignore[assignment]
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
        raise_on_content: dict[str, int] | None = None,
        raise_on_tags: dict[str, int] | None = None,
    ) -> None:
        self._info = file_info or {}
        self._content = file_content or {}
        self._info_errors = raise_on_info or {}
        self._content_errors = raise_on_content or {}
        self._tags_errors = raise_on_tags or {}
        self.content_calls: list[str] = []
        self.tag_calls: list[tuple[str, list[str]]] = []

    async def get_file(self, file_id: str) -> dict:
        from app.internal_client import InternalAPIError

        if file_id in self._info_errors:
            raise InternalAPIError(self._info_errors[file_id], "forced")
        if file_id not in self._info:
            raise InternalAPIError(404, "not found")
        return self._info[file_id]

    async def get_file_text_content(self, file_id: str) -> str:
        from app.internal_client import InternalAPIError

        self.content_calls.append(file_id)
        if file_id in self._content_errors:
            raise InternalAPIError(self._content_errors[file_id], "forced")
        return self._content.get(file_id, "")

    async def sync_core_tags(self, file_id: str, tags: list[str]) -> None:
        from app.internal_client import InternalAPIError

        self.tag_calls.append((file_id, list(tags)))
        if file_id in self._tags_errors:
            raise InternalAPIError(self._tags_errors[file_id], "forced")


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
                "created: \"2026-04-21T10:00:00Z\"\n"
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
    # approved_at column holds the frontmatter ``created`` value (see
    # models.py comment).
    assert note.approved_at.replace(tzinfo=UTC) == datetime(
        2026, 4, 21, 10, 0, 0, tzinfo=UTC
    )
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


@pytest.mark.anyio
async def test_content_403_counts_as_protected_error(knowledge_db):
    """Gated content endpoint denying us (misaligned CORE_INTERNAL_SECRET,
    or unset-on-one-side) must not pollute the generic ``errors`` counter.
    The scanner logs a hint and moves on; operators see
    ``protected_errors`` in the per-iteration summary.
    """
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nForbid00001",
        source_ids=["a"],
        last_synced_at=past,
    )
    session.close()

    client = _FakeClient(
        file_info={
            "nForbid00001": {
                "id": "nForbid00001",
                "drive": "protected-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(datetime.now(UTC)),
            }
        },
        raise_on_content={"nForbid00001": 403},
    )
    stats = await note_scanner.reconcile_once(client)

    assert stats.scanned == 1
    assert stats.updated == 0
    assert stats.errors == 0
    assert stats.protected_errors == 1


@pytest.mark.anyio
async def test_content_404_counts_as_protected_error(knowledge_db):
    """404 on the content path — the row vanished between get_file and
    the content call — is also a protected_error (benign race), not an
    error proper.
    """
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nVanish00001",
        last_synced_at=past,
    )
    session.close()

    client = _FakeClient(
        file_info={
            "nVanish00001": {
                "id": "nVanish00001",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(datetime.now(UTC)),
            }
        },
        raise_on_content={"nVanish00001": 404},
    )
    stats = await note_scanner.reconcile_once(client)

    assert stats.errors == 0
    assert stats.protected_errors == 1


@pytest.mark.anyio
async def test_content_5xx_counts_as_error(knowledge_db):
    """A 5xx from the content endpoint is still a real error — the
    generic ``errors`` counter is what oncall should be watching."""
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nBoom0000001",
        last_synced_at=past,
    )
    session.close()

    client = _FakeClient(
        file_info={
            "nBoom0000001": {
                "id": "nBoom0000001",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(datetime.now(UTC)),
            }
        },
        raise_on_content={"nBoom0000001": 502},
    )
    stats = await note_scanner.reconcile_once(client)

    assert stats.errors == 1
    assert stats.protected_errors == 0


@pytest.mark.anyio
async def test_legacy_approved_at_read_as_created_fallback(knowledge_db):
    """Existing ``.md`` with the old ``approved_at`` key still populates
    the DB. The scanner reads ``created`` → ``approved_at`` → ``clipped_at``
    in order."""
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nLegacyAppr0",
        source_ids=["a"],
        last_synced_at=past,
    )
    vault_id = vault.id
    session.close()

    client = _FakeClient(
        file_info={
            "nLegacyAppr0": {
                "id": "nLegacyAppr0",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(datetime.now(UTC)),
            }
        },
        file_content={
            "nLegacyAppr0": (
                "---\n"
                "origin: detailed_summary\n"
                "source_file_ids:\n"
                "  - a\n"
                "approved_at: \"2026-01-15T12:00:00Z\"\n"
                "---\n"
                "body\n"
            )
        },
    )
    stats = await note_scanner.reconcile_once(client)
    assert stats.updated == 1

    verify = knowledge_db()
    note = (
        verify.query(NoteOrigin)
        .filter(NoteOrigin.vault_id == vault_id, NoteOrigin.note_path == "n.md")
        .first()
    )
    assert note.approved_at.replace(tzinfo=UTC) == datetime(
        2026, 1, 15, 12, 0, 0, tzinfo=UTC
    )


@pytest.mark.anyio
async def test_legacy_clipped_at_read_as_created_fallback(knowledge_db):
    """Older webclip ``.md`` written before the created rename still
    populate the DB via the ``clipped_at`` fallback."""
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nLegacyClip0",
        source_ids=[],
        last_synced_at=past,
        origin="webclip",
    )
    vault_id = vault.id
    session.close()

    client = _FakeClient(
        file_info={
            "nLegacyClip0": {
                "id": "nLegacyClip0",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(datetime.now(UTC)),
            }
        },
        file_content={
            "nLegacyClip0": (
                "---\n"
                "url: https://example.com/x\n"
                "origin: webclip\n"
                "clipped_at: \"2026-02-01T08:30:00Z\"\n"
                "---\n"
                "body\n"
            )
        },
    )
    stats = await note_scanner.reconcile_once(client)
    assert stats.updated == 1

    verify = knowledge_db()
    note = (
        verify.query(NoteOrigin)
        .filter(
            NoteOrigin.vault_id == vault_id, NoteOrigin.note_path == "n.md"
        )
        .first()
    )
    assert note.approved_at.replace(tzinfo=UTC) == datetime(
        2026, 2, 1, 8, 30, 0, tzinfo=UTC
    )


@pytest.mark.anyio
async def test_created_takes_precedence_over_legacy_keys(knowledge_db):
    """When both ``created`` and ``approved_at`` are present, ``created`` wins."""
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nMixedKey001",
        source_ids=[],
        last_synced_at=past,
    )
    vault_id = vault.id
    session.close()

    client = _FakeClient(
        file_info={
            "nMixedKey001": {
                "id": "nMixedKey001",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(datetime.now(UTC)),
            }
        },
        file_content={
            "nMixedKey001": (
                "---\n"
                "origin: detailed_summary\n"
                "created: \"2026-03-10T09:00:00Z\"\n"
                "approved_at: \"2026-01-01T00:00:00Z\"\n"
                "---\n"
                "body\n"
            )
        },
    )
    await note_scanner.reconcile_once(client)

    verify = knowledge_db()
    note = (
        verify.query(NoteOrigin)
        .filter(
            NoteOrigin.vault_id == vault_id, NoteOrigin.note_path == "n.md"
        )
        .first()
    )
    assert note.approved_at.replace(tzinfo=UTC) == datetime(
        2026, 3, 10, 9, 0, 0, tzinfo=UTC
    )


# ---------------------------------------------------------------------
# Phase 2: frontmatter.tags → core File.tags projection
# ---------------------------------------------------------------------


@pytest.mark.anyio
async def test_tags_projected_when_frontmatter_changes(knowledge_db):
    """After frontmatter edit, scanner pushes the new tag list to core."""
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nTags0000001",
        last_synced_at=past,
        tags_synced_at=past,
    )
    session.close()

    client = _FakeClient(
        file_info={
            "nTags0000001": {
                "updated_at": _iso(datetime.now(UTC)),
            }
        },
        file_content={
            "nTags0000001": (
                "---\n"
                "tags:\n"
                "  - cooking\n"
                "  - japanese\n"
                "---\n"
                "body\n"
            )
        },
    )
    stats = await note_scanner.reconcile_once(client)

    assert stats.tags_projected == 1
    assert client.tag_calls == [("nTags0000001", ["cooking", "japanese"])]


@pytest.mark.anyio
async def test_tags_synced_at_null_forces_fetch_even_when_metadata_current(
    knowledge_db,
):
    """Phase 2 migration (§D8): NULL tags_synced_at ⇒ force content fetch
    so every existing row syncs on the first post-deploy scan, even if
    the .md hasn't been touched (updated_at == last_synced_at).
    """
    session = knowledge_db()
    vault = _seed_vault(session)
    frozen = datetime.now(UTC)
    _seed_note(
        session,
        vault,
        note_file_id="nMigr0000001",
        last_synced_at=frozen,
        tags_synced_at=None,  # ← explicit Phase 2 migration state
    )
    vault_id = vault.id
    session.close()

    client = _FakeClient(
        file_info={
            "nMigr0000001": {
                "updated_at": _iso(frozen),
            }
        },
        file_content={
            "nMigr0000001": (
                "---\n"
                "tags: [migrated]\n"
                "---\n"
                "body\n"
            )
        },
    )
    stats = await note_scanner.reconcile_once(client)

    assert client.content_calls == ["nMigr0000001"]
    assert client.tag_calls == [("nMigr0000001", ["migrated"])]
    assert stats.tags_projected == 1
    # Crucially ``updated`` stays 0 — metadata isn't re-applied when
    # last_synced_at was already current; only tags are caught up.
    assert stats.updated == 0

    verify = knowledge_db()
    note = (
        verify.query(NoteOrigin)
        .filter(NoteOrigin.vault_id == vault_id, NoteOrigin.note_path == "n.md")
        .first()
    )
    assert note.tags_synced_at is not None


@pytest.mark.anyio
async def test_empty_tags_list_clears_core_tags(knowledge_db):
    """Frontmatter without a ``tags:`` key sends an empty list, which
    core interprets as "remove all tags" (β canonical rule — frontmatter
    wins over DB, including "no tags here")."""
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(
        session,
        vault,
        note_file_id="nClear000001",
        tags_synced_at=None,
    )
    session.close()

    client = _FakeClient(
        file_info={
            "nClear000001": {"updated_at": _iso(datetime.now(UTC))}
        },
        file_content={
            "nClear000001": "---\ntitle: x\n---\nbody\n"
        },
    )
    await note_scanner.reconcile_once(client)

    assert client.tag_calls == [("nClear000001", [])]


@pytest.mark.anyio
async def test_invalid_tag_names_are_dropped(knowledge_db):
    """Non-string entries, over-length, spaces, and special chars are
    silently skipped — core's validator would 422 on them, so filter
    upstream. Valid names survive in order-of-appearance."""
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(
        session,
        vault,
        note_file_id="nFilt0000001",
        tags_synced_at=None,
    )
    session.close()

    client = _FakeClient(
        file_info={
            "nFilt0000001": {"updated_at": _iso(datetime.now(UTC))}
        },
        file_content={
            "nFilt0000001": (
                "---\n"
                "tags:\n"
                "  - ok-tag\n"
                "  - has spaces\n"
                "  - 'has!punct'\n"
                "  - 日本語\n"
                "  - 42\n"
                "  - '" + ("x" * 31) + "'\n"
                "---\n"
                "body\n"
            )
        },
    )
    await note_scanner.reconcile_once(client)

    assert client.tag_calls == [("nFilt0000001", ["ok-tag", "日本語"])]


@pytest.mark.anyio
async def test_case_insensitive_dedup_keeps_first(knowledge_db):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(
        session,
        vault,
        note_file_id="nDedu0000001",
        tags_synced_at=None,
    )
    session.close()

    client = _FakeClient(
        file_info={
            "nDedu0000001": {"updated_at": _iso(datetime.now(UTC))}
        },
        file_content={
            "nDedu0000001": (
                "---\n"
                "tags:\n"
                "  - Cooking\n"
                "  - cooking\n"
                "  - COOKING\n"
                "  - japanese\n"
                "---\n"
                "body\n"
            )
        },
    )
    await note_scanner.reconcile_once(client)

    assert client.tag_calls == [("nDedu0000001", ["Cooking", "japanese"])]


@pytest.mark.anyio
async def test_tags_capped_at_ten(knowledge_db):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(
        session,
        vault,
        note_file_id="nCap00000001",
        tags_synced_at=None,
    )
    session.close()

    tag_list = "\n".join(f"  - t{i}" for i in range(15))
    client = _FakeClient(
        file_info={
            "nCap00000001": {"updated_at": _iso(datetime.now(UTC))}
        },
        file_content={
            "nCap00000001": f"---\ntags:\n{tag_list}\n---\nbody\n"
        },
    )
    await note_scanner.reconcile_once(client)

    assert len(client.tag_calls[0][1]) == 10
    assert client.tag_calls[0][1] == [f"t{i}" for i in range(10)]


@pytest.mark.anyio
async def test_tags_sync_error_does_not_block_metadata_update(knowledge_db):
    """A 422 from core tags API must not prevent note_origins metadata
    refresh. The scanner retries tags on the next pass via
    tags_synced_at remaining NULL."""
    session = knowledge_db()
    vault = _seed_vault(session)
    past = datetime.now(UTC) - timedelta(hours=2)
    _seed_note(
        session,
        vault,
        note_file_id="nTagErr00001",
        last_synced_at=past,
        tags_synced_at=past,
    )
    vault_id = vault.id
    session.close()

    client = _FakeClient(
        file_info={
            "nTagErr00001": {"updated_at": _iso(datetime.now(UTC))}
        },
        file_content={
            "nTagErr00001": (
                "---\n"
                "origin: manual\n"
                "tags: [keep]\n"
                "---\n"
                "body\n"
            )
        },
        raise_on_tags={"nTagErr00001": 500},
    )
    stats = await note_scanner.reconcile_once(client)

    # metadata still applied even though tags failed
    assert stats.updated == 1
    assert stats.tags_projected == 0
    verify = knowledge_db()
    note = (
        verify.query(NoteOrigin)
        .filter(NoteOrigin.vault_id == vault_id, NoteOrigin.note_path == "n.md")
        .first()
    )
    assert note.origin == "manual"
    # tags_synced_at stays at the seeded past value → next pass retries
    assert note.tags_synced_at.replace(tzinfo=UTC) == past.replace(microsecond=note.tags_synced_at.microsecond)


@pytest.mark.anyio
async def test_unchanged_note_with_synced_tags_is_fully_skipped(knowledge_db):
    """When both metadata and tags are current, no HTTP calls at all."""
    session = knowledge_db()
    vault = _seed_vault(session)
    now = datetime.now(UTC)
    _seed_note(
        session,
        vault,
        note_file_id="nSkip0000001",
        last_synced_at=now,
        tags_synced_at=now,  # both up-to-date
    )
    session.close()

    client = _FakeClient(
        file_info={
            "nSkip0000001": {"updated_at": _iso(now)}
        }
    )
    stats = await note_scanner.reconcile_once(client)

    assert client.content_calls == []
    assert client.tag_calls == []
    assert stats.scanned == 1
    assert stats.updated == 0
    assert stats.tags_projected == 0


@pytest.fixture()
def anyio_backend():
    return "asyncio"
