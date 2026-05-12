"""Tests for note_scanner.reconcile_once: frontmatter ``id:`` fill behaviour.

Spec: docs/superpowers/specs/2026-05-12-markdown-link-three-forms.md §3.1 / §4 Phase A.

When the scanner fetches a ``.md`` body via the gated internal content
endpoint and finds no frontmatter ``id:``, it must write back the same
content with ``id:`` injected so the file gets a stable handle for
future wiki-link resolution. The write goes through the existing
``InternalClient.put_file_content`` call (If-Match enforced).

Edge cases:
- Body already has a valid ``id:`` → no write-back.
- 412 etag conflict on write-back → logged but the reconcile pass
  continues (id will be filled next pass when the etag aligns).
- 403/404 on write-back → counted as ``protected_errors`` (same as the
  existing pattern for read denials).
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.models import NoteOrigin, UserVault
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


def _seed_note(session, vault: UserVault, *, note_file_id: str) -> NoteOrigin:
    past = datetime.now(UTC) - timedelta(hours=2)
    row = NoteOrigin(
        vault_id=vault.id,
        note_path="n.md",
        note_file_id=note_file_id,
        origin="detailed_summary",
        approved_at=datetime.now(UTC),
        health="healthy",
        last_synced_at=past,
        tags_synced_at=past,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    session.expunge(row)
    return row


def _iso(dt: datetime) -> str:
    return dt.isoformat()


class _FakeClient:
    """InternalClient stub that records put_file_content calls so the
    test can assert id was injected before write-back."""

    def __init__(
        self,
        *,
        file_info: dict[str, dict] | None = None,
        file_content: dict[str, str] | None = None,
        put_status: dict[str, int] | None = None,
    ) -> None:
        self._info = file_info or {}
        self._content = file_content or {}
        # Map of file_id → HTTP status the put_file_content call should
        # raise (e.g. 412, 403). Unset entries succeed.
        self._put_status = put_status or {}
        self.put_calls: list[dict] = []
        self.tag_calls: list[tuple[str, list[str]]] = []
        self.content_calls: list[str] = []

    async def get_file(self, file_id: str) -> dict:
        from app.internal_client import InternalAPIError

        if file_id not in self._info:
            raise InternalAPIError(404, "not found")
        return self._info[file_id]

    async def get_file_text_content(self, file_id: str) -> str:
        self.content_calls.append(file_id)
        return self._content.get(file_id, "")

    async def put_file_content(
        self, file_id: str, content: str, if_match: str
    ) -> str:
        from app.internal_client import InternalAPIError

        self.put_calls.append(
            {"file_id": file_id, "content": content, "if_match": if_match}
        )
        if file_id in self._put_status:
            raise InternalAPIError(self._put_status[file_id], "forced")
        return '"new-etag"'

    async def sync_core_tags(self, file_id: str, tags: list[str]) -> None:
        self.tag_calls.append((file_id, list(tags)))


@pytest.mark.anyio
async def test_missing_id_triggers_writeback(knowledge_db):
    """A note fetched without ``id:`` in its frontmatter must be written
    back with an injected id."""
    session = knowledge_db()
    vault = _seed_vault(session)
    note = _seed_note(session, vault, note_file_id="nFill0000001")
    session.close()

    fresh = datetime.now(UTC)
    client = _FakeClient(
        file_info={
            "nFill0000001": {
                "id": "nFill0000001",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(fresh),
            }
        },
        file_content={
            "nFill0000001": (
                "---\n"
                "origin: detailed_summary\n"
                "tags:\n  - a\n"
                "---\n"
                "\n"
                "body\n"
            )
        },
    )

    await note_scanner.reconcile_once(client)

    # Exactly one write-back with id injected.
    assert len(client.put_calls) == 1
    written = client.put_calls[0]
    assert written["file_id"] == "nFill0000001"
    assert "id:" in written["content"]
    # The written body still contains the rest of the original content.
    assert "origin: detailed_summary" in written["content"]
    assert "body" in written["content"]


@pytest.mark.anyio
async def test_present_id_does_not_trigger_writeback(knowledge_db):
    """When the body already has a valid ``id:`` no write-back is sent."""
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, note_file_id="nKeep0000001")
    session.close()

    fresh = datetime.now(UTC)
    client = _FakeClient(
        file_info={
            "nKeep0000001": {
                "id": "nKeep0000001",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(fresh),
            }
        },
        file_content={
            "nKeep0000001": (
                "---\n"
                "id: \"20260101000000\"\n"
                "origin: detailed_summary\n"
                "---\n"
                "\n"
                "body\n"
            )
        },
    )

    await note_scanner.reconcile_once(client)

    assert client.put_calls == []


@pytest.mark.anyio
async def test_412_writeback_does_not_error_reconcile(knowledge_db):
    """A 412 (etag mismatch) from put_file_content is logged but the
    reconcile pass completes — the next pass picks up the right etag."""
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, note_file_id="nEtag0000001")
    session.close()

    fresh = datetime.now(UTC)
    client = _FakeClient(
        file_info={
            "nEtag0000001": {
                "id": "nEtag0000001",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(fresh),
            }
        },
        file_content={
            "nEtag0000001": "---\norigin: detailed_summary\n---\n\nbody\n"
        },
        put_status={"nEtag0000001": 412},
    )

    stats = await note_scanner.reconcile_once(client)

    # Reconcile completes; the 412 is a soft failure, not a hard error.
    assert stats.scanned == 1
    assert stats.errors == 0


@pytest.mark.anyio
async def test_403_writeback_counts_as_protected(knowledge_db):
    """A 403 (protected drive / secret mismatch) on the id-fill
    write-back increments ``protected_errors`` rather than ``errors``."""
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, note_file_id="nProt0000001")
    session.close()

    fresh = datetime.now(UTC)
    client = _FakeClient(
        file_info={
            "nProt0000001": {
                "id": "nProt0000001",
                "drive": "test-drive",
                "filename": "n.md",
                "file_type": "document",
                "folder_path": "",
                "updated_at": _iso(fresh),
            }
        },
        file_content={
            "nProt0000001": "---\norigin: detailed_summary\n---\n\nbody\n"
        },
        put_status={"nProt0000001": 403},
    )

    stats = await note_scanner.reconcile_once(client)
    assert stats.protected_errors >= 1
    assert stats.errors == 0
