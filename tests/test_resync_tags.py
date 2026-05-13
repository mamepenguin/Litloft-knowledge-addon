"""Tests for POST /resync-tags/{file_id}.

Triggered by the frontend after a content PUT so the new frontmatter
``tags:`` reach core ``File.tags`` without waiting for the hourly scanner
(spec §D5). Access control is applied by the host addon proxy's
``file_access`` pre_check — not reproduced here, so the tests
exercise the handler in isolation.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.models import NoteOrigin


def _seed_note_origin(
    session,
    *,
    note_file_id: str,
    tags_synced_at: datetime | None = None,
) -> None:
    row = NoteOrigin(
        drive="test-drive",
        note_path="n.md",
        note_file_id=note_file_id,
        origin="manual",
        health="healthy",
    )
    row.tags_synced_at = tags_synced_at
    session.add(row)
    session.commit()


class TestResyncTags:
    def test_projects_frontmatter_tags(self, client, fake_internal):
        fake_internal.file_text_override = {
            "fMd000000001": (
                "---\n"
                "tags:\n"
                "  - cooking\n"
                "  - japanese\n"
                "---\n"
                "body\n"
            )
        }
        r = client.post("/resync-tags/fMd000000001")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data == {
            "file_id": "fMd000000001",
            "tags": ["cooking", "japanese"],
        }
        assert fake_internal.captured_tag_syncs == [
            ("fMd000000001", ["cooking", "japanese"])
        ]

    def test_empty_frontmatter_clears_tags(self, client, fake_internal):
        fake_internal.file_text_override = {
            "fMd000000002": "no frontmatter, just body\n"
        }
        r = client.post("/resync-tags/fMd000000002")
        assert r.status_code == 200
        assert r.json()["tags"] == []
        assert fake_internal.captured_tag_syncs == [("fMd000000002", [])]

    def test_invalid_tags_are_filtered(self, client, fake_internal):
        fake_internal.file_text_override = {
            "fMd000000003": (
                "---\n"
                "tags:\n"
                "  - ok-tag\n"
                "  - has space\n"
                "  - '!bang'\n"
                "---\n"
            )
        }
        r = client.post("/resync-tags/fMd000000003")
        assert r.status_code == 200
        assert r.json()["tags"] == ["ok-tag"]

    def test_bumps_tags_synced_at_for_tracked_note(
        self, client, fake_internal, knowledge_db
    ):
        session = knowledge_db()
        past = datetime.now(UTC) - timedelta(hours=5)
        _seed_note_origin(
            session, note_file_id="fMd000000004", tags_synced_at=past
        )
        session.close()

        fake_internal.file_text_override = {
            "fMd000000004": "---\ntags: [x]\n---\n"
        }
        r = client.post("/resync-tags/fMd000000004")
        assert r.status_code == 200

        verify = knowledge_db()
        row = (
            verify.query(NoteOrigin)
            .filter(NoteOrigin.note_file_id == "fMd000000004")
            .one()
        )
        assert row.tags_synced_at is not None
        assert row.tags_synced_at.replace(tzinfo=UTC) > past

    def test_works_for_untracked_md(self, client, fake_internal):
        """A .md that was never distilled/clipped has no note_origin row.
        The endpoint should still project tags (the user is editing a
        plain note) without 404-ing on the missing row.
        """
        fake_internal.file_text_override = {
            "fMd000000005": "---\ntags: [personal]\n---\n"
        }
        r = client.post("/resync-tags/fMd000000005")
        assert r.status_code == 200
        assert r.json()["tags"] == ["personal"]

    def test_404_when_file_missing_from_core(self, client, fake_internal):
        # No file_text_override entry → FakeInternalClient raises 404
        r = client.post("/resync-tags/fMd000000099")
        assert r.status_code == 404

    def test_400_when_file_not_text(self, client, fake_internal):
        fake_internal.raise_on_text_content = {"fVid000000001": 415}
        r = client.post("/resync-tags/fVid000000001")
        assert r.status_code == 400

    def test_502_when_core_rejects_tag(self, client, fake_internal):
        fake_internal.file_text_override = {
            "fMd000000006": "---\ntags: [valid]\n---\n"
        }
        fake_internal.raise_on_tag_sync = {"fMd000000006": 422}
        r = client.post("/resync-tags/fMd000000006")
        assert r.status_code == 502

    def test_502_when_core_content_errors(self, client, fake_internal):
        fake_internal.raise_on_text_content = {"fMd000000007": 500}
        r = client.post("/resync-tags/fMd000000007")
        assert r.status_code == 502


@pytest.fixture()
def anyio_backend():
    return "asyncio"
