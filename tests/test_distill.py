"""Tests for POST /distill — the detailed_summary → Vault promotion path."""
from __future__ import annotations

import pytest

from app.models import NoteOrigin, NoteOriginSource, UserVault
from app.services.frontmatter import parse


@pytest.fixture()
def alice_vault(knowledge_db):
    from app.auth import nickname_to_viewer_id

    Session = knowledge_db
    s = Session()
    viewer_id = nickname_to_viewer_id("alice")
    v = UserVault(
        viewer_id=viewer_id,
        label="Notes",
        drive="test-drive",
        path="Notes",
    )
    s.add(v)
    s.commit()
    s.refresh(v)
    return v


def _distill_payload(**overrides):
    payload = {
        "source_file_id": "src1",
        "vault_id": 0,  # caller fills in
        "folder": "AI-Drafts",
        "filename": "vid-summary.md",
        "title": "vid.mkv の詳細要約",
        "content": "## 全体像\n\n本編は…",
        "origin": "detailed_summary",
        "origin_ref": "intelligence:src1/detailed_summary",
    }
    payload.update(overrides)
    return payload


class TestDistillHappyPath:
    def test_creates_note_with_frontmatter_and_registers_relations(
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["vault_id"] == alice_vault.id
        assert body["note_path"] == "Notes/AI-Drafts/vid-summary.md"
        assert body["note_file_id"]

        # Relation + active_summary were both registered.
        assert len(fake_internal.captured_relations) == 1
        rel = fake_internal.captured_relations[0]
        assert rel["file_id_a"] == "src1"
        assert rel["file_id_b"] == body["note_file_id"]
        assert rel["kind"] == "related"
        assert isinstance(rel["viewer_id"], str) and rel["viewer_id"]
        assert fake_internal.captured_active_summaries == [
            {"file_id": "src1", "summary_file_id": body["note_file_id"]}
        ]

    def test_emits_distilled_created_ws_event(
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text
        note_file_id = res.json()["note_file_id"]

        events = fake_internal.captured_addon_events
        assert len(events) == 1
        evt = events[0]
        assert evt["event"] == "knowledge.distilled.created"
        assert evt["drive"] == "test-drive"
        assert evt["data"] == {
            "vault_id": alice_vault.id,
            "note_file_id": note_file_id,
            "source_file_id": "src1",
        }

    def test_frontmatter_contains_required_fields(
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text

        writes = fake_internal.captured_text_writes
        assert len(writes) == 1
        parsed = parse(writes[0]["content"])
        assert parsed.metadata["origin"] == "detailed_summary"
        assert parsed.metadata["source_file_ids"] == ["src1"]
        assert parsed.metadata["origin_ref"] == "intelligence:src1/detailed_summary"
        assert "approved_at" in parsed.metadata
        # The body begins with the H1 we set.
        assert parsed.body.startswith("# vid.mkv の詳細要約")

    def test_note_origins_rows_persisted(
        self, client, fake_internal, alice_vault, viewer_cookie, knowledge_db
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201

        s = knowledge_db()
        origin = s.query(NoteOrigin).one()
        assert origin.vault_id == alice_vault.id
        assert origin.note_path == "AI-Drafts/vid-summary.md"
        assert origin.origin == "detailed_summary"
        assert origin.health == "healthy"
        sources = s.query(NoteOriginSource).all()
        assert len(sources) == 1
        assert sources[0].source_file_id == "src1"
        assert sources[0].note_path == "AI-Drafts/vid-summary.md"


class TestDistillCollisions:
    def test_collision_appends_suffix(
        self, client, fake_internal, alice_vault, viewer_cookie, knowledge_db
    ):
        # Make the first candidate collide; the router should retry
        # ``vid-summary-2.md``.
        fake_internal.create_text_file_collisions = {
            "Notes/AI-Drafts/vid-summary.md"
        }

        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text
        assert res.json()["note_path"] == "Notes/AI-Drafts/vid-summary-2.md"

        s = knowledge_db()
        origin = s.query(NoteOrigin).one()
        assert origin.note_path == "AI-Drafts/vid-summary-2.md"

    def test_many_collisions_yields_409(
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        fake_internal.create_text_file_always_fails = 409
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 409


class TestDistillGuards:
    def test_missing_drive_header_rejected(
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id),
            headers={"Cookie": viewer_cookie},
        )
        assert res.status_code == 400

    def test_unknown_vault_rejected(
        self, client, fake_internal, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=9999),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 404

    def test_cross_drive_source_rejected(
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        fake_internal.file_info_override["src1"] = {
            "id": "src1",
            "drive": "other-drive",
            "filename": "x.mp4",
        }
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 400

    def test_readonly_drive_returns_403(
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        fake_internal.create_text_file_always_fails = 403
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 403

    def test_path_traversal_in_folder_rejected(
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id, folder="../secret"),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 400

    def test_slash_in_filename_rejected(
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(
                vault_id=alice_vault.id, filename="sub/file.md"
            ),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 400


class TestReverseLookup:
    """GET /notes/by_source_file/{source_file_id}."""

    def test_returns_promoted_notes_for_source(
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id),
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
        assert entry["vault_id"] == alice_vault.id
        assert entry["drive"] == "test-drive"
        assert entry["path"] == "Notes/AI-Drafts/vid-summary.md"
        assert entry["origin"] == "detailed_summary"
        assert entry["origin_ref"] == "intelligence:src1/detailed_summary"
        assert entry["health"] == "healthy"

    def test_empty_list_when_no_matches(
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        res = client.get(
            "/notes/by_source_file/unknown-src",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 200
        assert res.json() == []

    def test_excludes_other_drive_vaults(
        self, client, fake_internal, alice_vault, viewer_cookie, knowledge_db
    ):
        """A distill recorded against ``test-drive`` is invisible to a
        caller claiming ``media`` — drive boundary enforced at query time."""
        res = client.post(
            "/distill",
            json=_distill_payload(vault_id=alice_vault.id),
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
        self, client, fake_internal, alice_vault, viewer_cookie
    ):
        res = client.get(
            "/notes/by_source_file/src1",
            headers={"Cookie": viewer_cookie},
        )
        assert res.status_code == 400
