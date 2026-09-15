"""Tests for POST /notes — Ask → Knowledge save endpoint.

Spec: docs/superpowers/specs/2026-05-06-knowledge-ask-citation-links.md
"""
from __future__ import annotations

from app.models import NoteOrigin, NoteOriginSource


def _post_note(client, viewer_cookie, *, content: str,
               filename: str = "my-note", folder: str = "Ask",
               source_file_ids: list[str] | None = None,
               drive: str = "test-drive"):
    return client.post(
        "/notes",
        json={
            "filename": filename,
            "folder": folder,
            "content": content,
            "source_file_ids": source_file_ids or [],
        },
        headers={**viewer_cookie, "X-Lit-Drive": drive},
    )


class TestCreateNote:
    def test_creates_note_and_returns_201(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        content = "---\norigin: ask_answer\n---\n\n# Test\n\nAnswer text.\n"
        r = _post_note(client, viewer_cookie, content=content)
        assert r.status_code == 201, r.text
        body = r.json()
        assert "note_file_id" in body
        # Note is written under the requested folder relative to the drive.
        assert body["note_path"] == "Ask/my-note.md"

    def test_write_passed_to_core(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        content = "---\norigin: ask_answer\n---\n\nbody\n"
        _post_note(client, viewer_cookie, content=content)
        writes = fake_internal.captured_text_writes
        assert len(writes) == 1
        assert writes[0]["content"] == content
        assert writes[0]["drive"] == "test-drive"
        assert writes[0]["path"] == "Ask/my-note.md"

    def test_writes_no_relation(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        r = _post_note(
            client, viewer_cookie,
            content="body",
            source_file_ids=["src000000aa", "src000000bb"],
        )
        assert r.status_code == 201, r.text
        assert fake_internal.captured_relations == []

    def test_only_same_drive_sources_are_recorded(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        fake_internal.bulk_state_drives = {"src000000bb": "media", "src000000cc": None}
        r = _post_note(
            client, viewer_cookie,
            content="body",
            source_file_ids=["src000000aa", "src000000bb", "src000000cc"],
        )
        assert r.status_code == 201, r.text

        verify = knowledge_db()
        recorded = {s.source_file_id for s in verify.query(NoteOriginSource).all()}
        verify.close()
        assert recorded == {"src000000aa"}

    def test_repeated_source_is_recorded_once(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        r = _post_note(
            client, viewer_cookie,
            content="body",
            source_file_ids=["src000000aa", "src000000aa"],
        )
        assert r.status_code == 201, r.text

        verify = knowledge_db()
        assert verify.query(NoteOriginSource).count() == 1
        verify.close()

    def test_source_lookup_failure_still_creates_the_note(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        fake_internal.raise_on_bulk_state = 500
        r = _post_note(
            client, viewer_cookie,
            content="body",
            source_file_ids=["src000000aa"],
        )
        assert r.status_code == 201, r.text

        verify = knowledge_db()
        assert verify.query(NoteOrigin).count() == 1
        assert verify.query(NoteOriginSource).count() == 0
        verify.close()

    def test_inserts_note_origins(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        r = _post_note(
            client, viewer_cookie,
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
        assert origin.drive == "test-drive"
        assert origin.note_path == "Ask/my-note.md"
        assert origin.origin == "ask_answer"
        assert origin.health == "healthy"
        sources = verify.query(NoteOriginSource).filter(
            NoteOriginSource.drive == "test-drive"
        ).all()
        assert len(sources) == 1
        assert sources[0].source_file_id == "src000000aa"
        verify.close()

    def test_emits_ws_event(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        r = _post_note(
            client, viewer_cookie,
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
        collide_path = "Ask/my-note.md"
        fake_internal.create_text_file_collisions = {collide_path}

        r = _post_note(client, viewer_cookie, content="body")
        assert r.status_code == 201, r.text
        writes = fake_internal.captured_text_writes
        assert len(writes) == 2
        assert "-2.md" in writes[1]["path"]

    def test_missing_drive_header_rejected(
        self, client, fake_internal, viewer_cookie
    ):
        r = client.post(
            "/notes",
            json={
                "filename": "x",
                "folder": "Ask",
                "content": "body",
                "source_file_ids": [],
            },
            headers=viewer_cookie,
        )
        assert r.status_code == 400

    def test_no_source_ids_still_succeeds(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        r = _post_note(client, viewer_cookie, content="body")
        assert r.status_code == 201
        assert fake_internal.captured_relations == []
