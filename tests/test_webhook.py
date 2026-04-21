"""Unit tests for the lifecycle webhook handlers.

Exercises ``handle_files_missing``, ``handle_files_recovered``, and
``handle_files_purged`` directly against the knowledge DB, plus a
minimal HTTP smoke test for the webhook routes themselves.

The core's bulk-state API is stubbed by swapping
``InternalClient.fetch_bulk_state`` via monkeypatch so we never hit the
network in tests.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app import webhook as webhook_module
from app.models import NoteOrigin, NoteOriginSource, UserVault


def _seed_vault(session, *, viewer_id: str = "v0000000000000000") -> UserVault:
    vault = UserVault(
        viewer_id=viewer_id,
        label="Test",
        drive="test-drive",
        path="Vault",
    )
    session.add(vault)
    session.commit()
    session.refresh(vault)
    # Expunge so the returned instance is safely usable as a value-holder
    # after the test's initial session closes. The handlers always open
    # their own session via ``session_scope()``, so the detached instance
    # never re-enters SQLAlchemy's identity map.
    session.expunge(vault)
    return vault


def _seed_note(
    session,
    vault: UserVault,
    note_path: str,
    source_ids: list[str],
    *,
    note_file_id: str = "nNote123456A",
    health: str = "healthy",
) -> NoteOrigin:
    row = NoteOrigin(
        vault_id=vault.id,
        note_path=note_path,
        note_file_id=note_file_id,
        origin="detailed_summary",
        origin_ref=None,
        approved_at=datetime.now(UTC),
        health=health,
    )
    session.add(row)
    for sid in source_ids:
        session.add(
            NoteOriginSource(
                vault_id=vault.id,
                note_path=note_path,
                source_file_id=sid,
            )
        )
    session.commit()
    session.refresh(row)
    return row


def _get_note(session, vault_id: int, note_path: str) -> NoteOrigin | None:
    return (
        session.query(NoteOrigin)
        .filter(
            NoteOrigin.vault_id == vault_id,
            NoteOrigin.note_path == note_path,
        )
        .first()
    )


def _count_sources(session, vault_id: int, note_path: str) -> int:
    return (
        session.query(NoteOriginSource)
        .filter(
            NoteOriginSource.vault_id == vault_id,
            NoteOriginSource.note_path == note_path,
        )
        .count()
    )


class _FakeClient:
    """Stand-in for ``InternalClient`` used inside webhook handlers."""

    def __init__(self, state_map: dict[str, str]):
        self._state_map = state_map

    async def fetch_bulk_state(self, file_ids: list[str]) -> dict:
        statuses = [
            {"id": fid, "drive": "test-drive", "state": self._state_map[fid]}
            for fid in file_ids
            if fid in self._state_map
        ]
        not_found = [fid for fid in file_ids if fid not in self._state_map]
        return {"statuses": statuses, "not_found": not_found}


@pytest.fixture()
def stub_client(monkeypatch):
    """Install a ``InternalClient`` stub at module level.

    Tests configure the returned stub's ``state_map`` to control what
    the webhook handlers see when they call ``fetch_bulk_state``.
    """
    holder: dict[str, _FakeClient] = {}

    def _install(state_map: dict[str, str]) -> None:
        client = _FakeClient(state_map)
        holder["c"] = client
        monkeypatch.setattr(
            webhook_module, "InternalClient", lambda *a, **kw: client
        )

    _install({})  # default = no sources present
    yield _install


@pytest.mark.anyio
async def test_missing_flips_healthy_to_degraded(knowledge_db, stub_client):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "note.md", ["srcA"], health="healthy")
    vault_id = vault.id
    session.close()

    touched = await webhook_module.handle_files_missing(["srcA"])

    assert touched == 1
    verify = knowledge_db()
    note = _get_note(verify, vault_id, "note.md")
    assert note.health == "degraded"


@pytest.mark.anyio
async def test_missing_one_of_many_sources_still_degrades(
    knowledge_db, stub_client
):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "n.md", ["a", "b", "c"], health="healthy")
    session.close()

    touched = await webhook_module.handle_files_missing(["b"])

    assert touched == 1
    verify = knowledge_db()
    assert _get_note(verify, vault.id, "n.md").health == "degraded"


@pytest.mark.anyio
async def test_missing_with_no_matching_note_is_noop(knowledge_db, stub_client):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "n.md", ["a"], health="healthy")
    session.close()

    touched = await webhook_module.handle_files_missing(["unrelated-id"])

    assert touched == 0
    verify = knowledge_db()
    assert _get_note(verify, vault.id, "n.md").health == "healthy"


@pytest.mark.anyio
async def test_recovered_returns_single_source_note_to_healthy(
    knowledge_db, stub_client
):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "n.md", ["a"], health="degraded")
    session.close()
    stub_client({"a": "active"})

    touched = await webhook_module.handle_files_recovered(["a"])

    assert touched == 1
    verify = knowledge_db()
    assert _get_note(verify, vault.id, "n.md").health == "healthy"


@pytest.mark.anyio
async def test_recovered_with_other_source_still_missing_stays_degraded(
    knowledge_db, stub_client
):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "n.md", ["a", "b"], health="degraded")
    session.close()
    # "a" recovered, but "b" is still missing.
    stub_client({"a": "active", "b": "missing"})

    await webhook_module.handle_files_recovered(["a"])

    verify = knowledge_db()
    assert _get_note(verify, vault.id, "n.md").health == "degraded"


@pytest.mark.anyio
async def test_recovered_when_other_source_is_trashed_stays_degraded(
    knowledge_db, stub_client
):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "n.md", ["a", "b"], health="degraded")
    session.close()
    stub_client({"a": "active", "b": "trash"})

    await webhook_module.handle_files_recovered(["a"])

    verify = knowledge_db()
    assert _get_note(verify, vault.id, "n.md").health == "degraded"


@pytest.mark.anyio
async def test_recovered_when_other_source_is_purged_rolls_up(
    knowledge_db, stub_client
):
    """A purged source reports as ``not_found`` and thus is treated as
    gone — the remaining active source alone makes the note healthy."""
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "n.md", ["a", "b"], health="degraded")
    session.close()
    # "b" is purged → not in state_map → excluded from count.
    stub_client({"a": "active"})

    await webhook_module.handle_files_recovered(["a"])

    verify = knowledge_db()
    # "a" active, "b" absent from result → _classify_health(["active"]) == healthy
    assert _get_note(verify, vault.id, "n.md").health == "healthy"


@pytest.mark.anyio
async def test_purged_removes_source_rows(knowledge_db, stub_client):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "n.md", ["a", "b"], health="healthy")
    session.close()
    stub_client({"b": "active"})  # "a" is purged; "b" is still active

    await webhook_module.handle_files_purged(["a"])

    verify = knowledge_db()
    # "a" source row removed; "b" remains.
    remaining = (
        verify.query(NoteOriginSource.source_file_id)
        .filter(
            NoteOriginSource.vault_id == vault.id,
            NoteOriginSource.note_path == "n.md",
        )
        .all()
    )
    assert [r[0] for r in remaining] == ["b"]


@pytest.mark.anyio
async def test_purged_last_source_marks_orphaned(knowledge_db, stub_client):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "n.md", ["a"], health="degraded")
    session.close()
    stub_client({})  # "a" is the only source and it's purged.

    await webhook_module.handle_files_purged(["a"])

    verify = knowledge_db()
    note = _get_note(verify, vault.id, "n.md")
    assert note.health == "orphaned"
    assert _count_sources(verify, vault.id, "n.md") == 0


@pytest.mark.anyio
async def test_purged_one_of_many_keeps_degraded_if_others_missing(
    knowledge_db, stub_client
):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "n.md", ["a", "b", "c"], health="healthy")
    session.close()
    # Purge "a"; "b" still active, "c" is missing.
    stub_client({"b": "active", "c": "missing"})

    await webhook_module.handle_files_purged(["a"])

    verify = knowledge_db()
    assert _get_note(verify, vault.id, "n.md").health == "degraded"
    # "a" removed; "b" and "c" remain.
    assert _count_sources(verify, vault.id, "n.md") == 2


@pytest.mark.anyio
async def test_purge_restores_healthy_when_remaining_sources_are_active(
    knowledge_db, stub_client
):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "n.md", ["a", "b"], health="degraded")
    session.close()
    # Purge "a" (previously missing), "b" is active → back to healthy.
    stub_client({"b": "active"})

    await webhook_module.handle_files_purged(["a"])

    verify = knowledge_db()
    assert _get_note(verify, vault.id, "n.md").health == "healthy"


@pytest.mark.anyio
async def test_multiple_notes_sharing_a_source_all_update(
    knowledge_db, stub_client
):
    session = knowledge_db()
    vault = _seed_vault(session)
    _seed_note(session, vault, "one.md", ["shared"], health="healthy")
    _seed_note(
        session,
        vault,
        "two.md",
        ["shared"],
        health="healthy",
        note_file_id="nTwo12345678",
    )
    session.close()

    touched = await webhook_module.handle_files_missing(["shared"])

    assert touched == 2
    verify = knowledge_db()
    assert _get_note(verify, vault.id, "one.md").health == "degraded"
    assert _get_note(verify, vault.id, "two.md").health == "degraded"


@pytest.mark.anyio
async def test_empty_file_ids_is_noop(knowledge_db, stub_client):
    assert await webhook_module.handle_files_missing([]) == 0
    assert await webhook_module.handle_files_recovered([]) == 0
    assert await webhook_module.handle_files_purged([]) == 0


class TestWebhookHTTP:
    def test_files_missing_endpoint(self, client, stub_client, knowledge_db):
        session = knowledge_db()
        vault = _seed_vault(session)
        _seed_note(session, vault, "n.md", ["srcA"], health="healthy")
        session.close()

        res = client.post(
            "/webhook/files-missing", json={"file_ids": ["srcA"]}
        )
        assert res.status_code == 200
        assert res.json() == {"status": "ok", "notes_touched": 1}

    def test_files_recovered_endpoint(
        self, client, stub_client, knowledge_db
    ):
        session = knowledge_db()
        vault = _seed_vault(session)
        _seed_note(session, vault, "n.md", ["a"], health="degraded")
        session.close()
        stub_client({"a": "active"})

        res = client.post(
            "/webhook/files-recovered", json={"file_ids": ["a"]}
        )
        assert res.status_code == 200
        assert res.json()["notes_touched"] == 1

    def test_files_purged_endpoint(self, client, stub_client, knowledge_db):
        session = knowledge_db()
        vault = _seed_vault(session)
        _seed_note(session, vault, "n.md", ["a"], health="healthy")
        session.close()

        res = client.post(
            "/webhook/files-purged", json={"file_ids": ["a"]}
        )
        assert res.status_code == 200
        assert res.json()["notes_touched"] == 1

    def test_secret_required_when_configured(
        self, client, stub_client, monkeypatch
    ):
        """Setting the secret env var gates the endpoints behind a header."""
        from app import auth

        monkeypatch.setattr(auth, "_WEBHOOK_SECRET", "topsecret")

        res = client.post(
            "/webhook/files-missing", json={"file_ids": []}
        )
        assert res.status_code == 403

        res_ok = client.post(
            "/webhook/files-missing",
            json={"file_ids": []},
            headers={"X-Webhook-Secret": "topsecret"},
        )
        assert res_ok.status_code == 200

    def test_empty_payload_is_ok(self, client, stub_client):
        res = client.post("/webhook/files-missing", json={"file_ids": []})
        assert res.status_code == 200
        assert res.json()["notes_touched"] == 0


@pytest.fixture()
def anyio_backend():
    return "asyncio"
