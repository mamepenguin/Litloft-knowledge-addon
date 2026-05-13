"""Tests for POST /distill — the detailed_summary → Knowledge promotion path."""
from __future__ import annotations

import pytest

from app.models import (
    FileActiveSummary,
    NoteOrigin,
    NoteOriginSource,
)
from app.services.frontmatter import parse


def _distill_payload(**overrides):
    payload = {
        "source_file_id": "src1",
        "folder": "AI-Drafts",
        "filename": "vid-summary.md",
        "title": "vid.mkv の詳細要約",
        "content": "## 全体像\n\n本編は…",
        "origin": "detailed_summary",
    }
    payload.update(overrides)
    return payload


class TestDistillHappyPath:
    def test_creates_note_with_frontmatter_and_registers_relations(
        self, client, fake_internal, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["note_path"] == "AI-Drafts/vid-summary.md"
        assert body["note_file_id"]

        # Relation registered in core. The active_summary pointer is
        # local to knowledge.db now (spec
        # 2026-04-30-file-active-summary-to-knowledge), so check the
        # row landed in the addon DB instead of the captured Internal
        # API call list.
        assert len(fake_internal.captured_relations) == 1
        rel = fake_internal.captured_relations[0]
        assert rel["file_id_a"] == "src1"
        assert rel["file_id_b"] == body["note_file_id"]
        assert rel["kind"] == "related"
        assert isinstance(rel["viewer_id"], str) and rel["viewer_id"]

        from app.database import session_scope
        with session_scope() as s:
            row = (
                s.query(FileActiveSummary)
                .filter(FileActiveSummary.target_file_id == "src1")
                .first()
            )
            assert row is not None
            assert row.summary_note_id == body["note_file_id"]
            assert row.drive == "test-drive"

    def test_emits_distilled_created_ws_event(
        self, client, fake_internal, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text
        note_file_id = res.json()["note_file_id"]

        # Two events fire: knowledge.active_summary.changed (from the
        # pointer UPSERT) and knowledge.distilled.created. Order is the
        # order they were emitted; both are scoped to the source drive.
        events = fake_internal.captured_addon_events
        event_names = [e["event"] for e in events]
        assert "knowledge.active_summary.changed" in event_names
        assert "knowledge.distilled.created" in event_names

        distilled = next(
            e for e in events if e["event"] == "knowledge.distilled.created"
        )
        assert distilled["drive"] == "test-drive"
        assert distilled["data"] == {
            "note_file_id": note_file_id,
            "source_file_id": "src1",
        }
        active = next(
            e for e in events if e["event"] == "knowledge.active_summary.changed"
        )
        assert active["drive"] == "test-drive"
        assert active["data"] == {
            "file_id": "src1",
            "summary_file_id": note_file_id,
        }

    def test_frontmatter_contains_required_fields(
        self, client, fake_internal, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text

        writes = fake_internal.captured_text_writes
        assert len(writes) == 1
        parsed = parse(writes[0]["content"])
        assert parsed.metadata["origin"] == "detailed_summary"
        assert parsed.metadata["source_file_ids"] == ["src1"]
        # ``created`` is second-precision UTC ISO 8601 with a trailing Z
        # (spec 2026-04-24 §D — no microseconds, no +00:00 suffix).
        created = parsed.metadata["created"]
        assert isinstance(created, str), (
            "created must serialise as a string, not a YAML timestamp"
        )
        import re
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", created), created
        # Legacy keys removed: origin_ref / approved_at / title / status must
        # not appear in new writes.
        assert "origin_ref" not in parsed.metadata
        assert "approved_at" not in parsed.metadata
        # The body begins with the H1 we set.
        assert parsed.body.startswith("# vid.mkv の詳細要約")

    def test_note_origins_rows_persisted(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201

        s = knowledge_db()
        origin = s.query(NoteOrigin).one()
        assert origin.drive == "test-drive"
        assert origin.note_path == "AI-Drafts/vid-summary.md"
        assert origin.origin == "detailed_summary"
        assert origin.health == "healthy"
        sources = s.query(NoteOriginSource).all()
        assert len(sources) == 1
        assert sources[0].source_file_id == "src1"
        assert sources[0].note_path == "AI-Drafts/vid-summary.md"
        assert sources[0].drive == "test-drive"


class TestDistillCollisions:
    def test_collision_appends_suffix(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        # Make the first candidate collide; the router should retry
        # ``vid-summary-2.md``.
        fake_internal.create_text_file_collisions = {
            "AI-Drafts/vid-summary.md"
        }

        res = client.post(
            "/distill",
            json=_distill_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text
        assert res.json()["note_path"] == "AI-Drafts/vid-summary-2.md"

        s = knowledge_db()
        origin = s.query(NoteOrigin).one()
        assert origin.note_path == "AI-Drafts/vid-summary-2.md"

    def test_many_collisions_yields_409(
        self, client, fake_internal, viewer_cookie
    ):
        fake_internal.create_text_file_always_fails = 409
        res = client.post(
            "/distill",
            json=_distill_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 409


class TestDistillGuards:
    def test_missing_drive_header_rejected(
        self, client, fake_internal, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(),
            headers={"Cookie": viewer_cookie},
        )
        assert res.status_code == 400

    def test_cross_drive_source_rejected(
        self, client, fake_internal, viewer_cookie
    ):
        fake_internal.file_info_override["src1"] = {
            "id": "src1",
            "drive": "other-drive",
            "filename": "x.mp4",
        }
        res = client.post(
            "/distill",
            json=_distill_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 400

    def test_readonly_drive_returns_403(
        self, client, fake_internal, viewer_cookie
    ):
        fake_internal.create_text_file_always_fails = 403
        res = client.post(
            "/distill",
            json=_distill_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 403

    def test_path_traversal_in_folder_rejected(
        self, client, fake_internal, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(folder="../secret"),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 400

    def test_slash_in_filename_rejected(
        self, client, fake_internal, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(filename="sub/file.md"),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 400


class TestReverseLookup:
    """GET /notes/by_source_file/{source_file_id}."""

    def test_returns_promoted_notes_for_source(
        self, client, fake_internal, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201
        created = res.json()

        res2 = client.get(
            "/notes/by_source_file/src1",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res2.status_code == 200
        body = res2.json()
        assert len(body) == 1
        entry = body[0]
        assert entry["note_file_id"] == created["note_file_id"]
        assert entry["drive"] == "test-drive"
        assert entry["path"] == "AI-Drafts/vid-summary.md"
        assert entry["origin"] == "detailed_summary"
        assert "origin_ref" not in entry
        assert entry["health"] == "healthy"

    def test_empty_list_when_no_matches(
        self, client, fake_internal, viewer_cookie
    ):
        res = client.get(
            "/notes/by_source_file/unknown-src",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 200
        assert res.json() == []

    def test_excludes_other_drives(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        """A distill recorded against ``test-drive`` is invisible to a
        caller claiming ``media`` — drive boundary enforced at query time."""
        res = client.post(
            "/distill",
            json=_distill_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201

        res2 = client.get(
            "/notes/by_source_file/src1",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "media"},
        )
        assert res2.status_code == 200
        assert res2.json() == []

    def test_missing_drive_header_rejected(
        self, client, fake_internal, viewer_cookie
    ):
        res = client.get(
            "/notes/by_source_file/src1",
            headers={"Cookie": viewer_cookie},
        )
        assert res.status_code == 400
