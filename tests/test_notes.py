"""Tests for POST /notes — Ask → Knowledge save endpoint.

Spec: docs/superpowers/specs/2026-05-06-knowledge-ask-citation-links.md
"""
from __future__ import annotations

from app.auth import nickname_to_viewer_id
from app.models import NoteOrigin, NoteOriginSource, UserVault

_ALICE_ID = nickname_to_viewer_id("alice")


def _seed_vault(session, *, drive: str = "test-drive", path: str = "vault") -> UserVault:
    v = UserVault(viewer_id=_ALICE_ID, drive=drive, label="My Vault", path=path)
    session.add(v)
    session.commit()
    session.refresh(v)
    session.expunge(v)
    return v


def _post_note(client, viewer_cookie, *, vault_id: int, content: str,
               filename: str = "my-note", folder: str = "Ask",
               source_file_ids: list[str] | None = None,
               drive: str = "test-drive"):
    return client.post(
        "/notes",
        json={
            "vault_id": vault_id,
            "filename": filename,
            "folder": folder,
            "content": content,
            "source_file_ids": source_file_ids or [],
        },
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": drive},
    )


class TestCreateNote:
    def test_creates_note_and_returns_201(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        s = knowledge_db()
        vault = _seed_vault(s)
        s.close()
        content = "---\norigin: ask_answer\n---\n\n# Test\n\nAnswer text.\n"
        r = _post_note(client, viewer_cookie, vault_id=vault.id, content=content)
        assert r.status_code == 201, r.text
        body = r.json()
        assert "note_file_id" in body
        assert body["vault_id"] == vault.id
        assert "Ask/my-note.md" in body["note_path"]

    def test_write_passed_to_core(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        s = knowledge_db()
        vault = _seed_vault(s)
        s.close()
        content = "---\norigin: ask_answer\n---\n\nbody\n"
        _post_note(client, viewer_cookie, vault_id=vault.id, content=content)
        writes = fake_internal.captured_text_writes
        assert len(writes) == 1
        assert writes[0]["content"] == content
        assert writes[0]["drive"] == "test-drive"

    def test_registers_file_relations_for_each_source(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        s = knowledge_db()
        vault = _seed_vault(s)
        s.close()
        r = _post_note(
            client, viewer_cookie,
            vault_id=vault.id,
            content="body",
            source_file_ids=["src000000aa", "src000000bb"],
        )
        assert r.status_code == 201, r.text
        note_id = r.json()["note_file_id"]
        rels = fake_internal.captured_relations
        assert len(rels) == 2
        related_ids = {(rel["file_id_a"], rel["file_id_b"]) for rel in rels}
        assert ("src000000aa", note_id) in related_ids
        assert ("src000000bb", note_id) in related_ids

    def test_inserts_note_origins(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        s = knowledge_db()
        vault = _seed_vault(s)
        s.close()
        r = _post_note(
            client, viewer_cookie,
            vault_id=vault.id,
            content="body",
            source_file_ids=["src000000aa"],
        )
        assert r.status_code == 201, r.text
        note_id = r.json()["note_file_id"]

        verify = knowledge_db()
        origin = verify.query(NoteOrigin).filter(
            NoteOrigin.note_file_id == note_id
        ).first()
        assert origin is not None
        assert origin.origin == "ask_answer"
        assert origin.health == "healthy"
        sources = verify.query(NoteOriginSource).filter(
            NoteOriginSource.vault_id == vault.id
        ).all()
        assert len(sources) == 1
        assert sources[0].source_file_id == "src000000aa"
        verify.close()

    def test_emits_ws_event(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        s = knowledge_db()
        vault = _seed_vault(s)
        s.close()
        r = _post_note(
            client, viewer_cookie,
            vault_id=vault.id,
            content="body",
            source_file_ids=["src000000aa"],
        )
        assert r.status_code == 201, r.text
        events = [e for e in fake_internal.captured_addon_events
                  if e["event"] == "knowledge.note.created"]
        assert len(events) == 1
        assert events[0]["drive"] == "test-drive"
        assert "src000000aa" in events[0]["data"]["source_file_ids"]

    def test_handles_path_collision_with_retry(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        s = knowledge_db()
        vault = _seed_vault(s, path="vault")
        s.close()
        collide_path = "vault/Ask/my-note.md"
        fake_internal.create_text_file_collisions = {collide_path}

        r = _post_note(client, viewer_cookie, vault_id=vault.id, content="body")
        assert r.status_code == 201, r.text
        writes = fake_internal.captured_text_writes
        assert len(writes) == 2
        assert "-2.md" in writes[1]["path"]

    def test_rejects_wrong_vault(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        r = _post_note(client, viewer_cookie, vault_id=999, content="body")
        assert r.status_code == 404

    def test_rejects_wrong_drive(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        s = knowledge_db()
        vault = _seed_vault(s, drive="test-drive")
        s.close()
        r = _post_note(
            client, viewer_cookie, vault_id=vault.id,
            content="body", drive="other-drive",
        )
        assert r.status_code == 404

    def test_no_source_ids_still_succeeds(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        s = knowledge_db()
        vault = _seed_vault(s)
        s.close()
        r = _post_note(client, viewer_cookie, vault_id=vault.id, content="body")
        assert r.status_code == 201
        assert fake_internal.captured_relations == []
