"""Tests for POST /note-from-file."""
from __future__ import annotations

import pytest

from app.services.frontmatter import parse as parse_frontmatter


def _payload(**overrides):
    base = {
        "source_file_id": "src001",
        "filename": "Untitled.md",
        "folder": "",
    }
    base.update(overrides)
    return base


class TestNoteFromFileHappyPath:
    def test_creates_note_and_seeds_relation(self, client, fake_internal, viewer_cookie):
        res = client.post(
            "/note-from-file",
            json=_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text
        body = res.json()
        assert body["note_file_id"]
        assert body["note_path"] == "Untitled.md"

        # Relation registered in core.
        assert len(fake_internal.captured_relations) == 1
        rel = fake_internal.captured_relations[0]
        assert rel["file_id_a"] == "src001"
        assert rel["file_id_b"] == body["note_file_id"]
        assert rel["kind"] == "related"

    def test_initial_content_has_source_file_ids_frontmatter(
        self, client, fake_internal, viewer_cookie
    ):
        res = client.post(
            "/note-from-file",
            json=_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text

        assert len(fake_internal.captured_text_writes) == 1
        written = fake_internal.captured_text_writes[0]
        parsed = parse_frontmatter(written["content"])
        assert parsed.metadata.get("source_file_ids") == ["src001"]

    def test_folder_included_in_path(self, client, fake_internal, viewer_cookie):
        res = client.post(
            "/note-from-file",
            json=_payload(folder="Notes"),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text
        assert res.json()["note_path"] == "Notes/Untitled.md"

    def test_emits_note_created_event(self, client, fake_internal, viewer_cookie):
        res = client.post(
            "/note-from-file",
            json=_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text
        events = [e["event"] for e in fake_internal.captured_addon_events]
        assert "knowledge.note.created" in events


class TestNoteFromFileCollisionRetry:
    def test_filename_suffix_on_collision(self, client, fake_internal, viewer_cookie):
        fake_internal.create_text_file_collisions = {"Untitled.md"}
        res = client.post(
            "/note-from-file",
            json=_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 201, res.text
        assert res.json()["note_path"] == "Untitled-2.md"


class TestNoteFromFileErrors:
    def test_missing_drive_header_returns_400(self, client, fake_internal, viewer_cookie):
        res = client.post(
            "/note-from-file",
            json=_payload(),
            headers={"Cookie": viewer_cookie},
        )
        assert res.status_code == 400

    def test_source_file_not_found_returns_404(self, client, fake_internal, viewer_cookie):
        fake_internal.raise_on_get_file = 404
        res = client.post(
            "/note-from-file",
            json=_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 404

    def test_cross_drive_source_returns_400(self, client, fake_internal, viewer_cookie):
        fake_internal.file_info_override = {
            "src001": {"id": "src001", "drive": "other-drive", "filename": "x.mp4"}
        }
        res = client.post(
            "/note-from-file",
            json=_payload(),
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 400
        assert "different drive" in res.json()["detail"]
