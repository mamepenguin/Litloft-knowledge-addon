"""Tests for the file_active_summary endpoints (drive-scoped + internal).

Spec: ``2026-04-30-file-active-summary-to-knowledge``. The pointer was
moved here from core; these tests cover the drive isolation rule, the
service-to-service DELETE path used by intelligence regenerate, and
purge cleanup parity with the cross-DB ``note_origin_sources`` handler.
"""
from __future__ import annotations

from app.models import FileActiveSummary


def _put_pointer(client, viewer_cookie, *, target, summary, drive="test-drive"):
    return client.post(
        "/file_active_summary",
        json={"target_file_id": target, "summary_note_id": summary},
        headers={"Cookie": viewer_cookie, "X-Lit-Drive": drive},
    )


class TestUpsert:
    def test_creates_pointer(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "test-drive", "filename": "v.mp4"},
            "note1": {"id": "note1", "drive": "test-drive", "filename": "v.md"},
        }
        res = _put_pointer(
            client, viewer_cookie, target="src1", summary="note1"
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["target_file_id"] == "src1"
        assert body["summary_note_id"] == "note1"

        Session = knowledge_db
        with Session() as s:
            row = s.query(FileActiveSummary).first()
            assert row is not None
            assert row.drive == "test-drive"
            assert row.target_file_id == "src1"

    def test_updates_existing_pointer(
        self, client, fake_internal, viewer_cookie
    ):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "test-drive", "filename": "v.mp4"},
            "note1": {"id": "note1", "drive": "test-drive", "filename": "v.md"},
            "note2": {"id": "note2", "drive": "test-drive", "filename": "v2.md"},
        }
        _put_pointer(client, viewer_cookie, target="src1", summary="note1")
        res = _put_pointer(client, viewer_cookie, target="src1", summary="note2")
        assert res.status_code == 200, res.text
        assert res.json()["summary_note_id"] == "note2"

    def test_rejects_cross_drive(self, client, fake_internal, viewer_cookie):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "media", "filename": "v.mp4"},
            "note1": {"id": "note1", "drive": "test-drive", "filename": "v.md"},
        }
        res = _put_pointer(
            client, viewer_cookie, target="src1", summary="note1"
        )
        assert res.status_code == 400

    def test_rejects_self_relation(self, client, fake_internal, viewer_cookie):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "test-drive", "filename": "v.md"},
        }
        res = _put_pointer(client, viewer_cookie, target="src1", summary="src1")
        assert res.status_code == 400

    def test_404_when_files_missing(
        self, client, fake_internal, viewer_cookie
    ):
        # Default FakeInternalClient.get_file returns "test-drive" for any
        # id, so we override to simulate a missing file by raising 404.
        from app.internal_client import InternalAPIError

        async def _raise(self, file_id):
            raise InternalAPIError(404, "not found")

        from tests.conftest import FakeInternalClient

        original = FakeInternalClient.get_file
        FakeInternalClient.get_file = _raise
        try:
            res = _put_pointer(
                client, viewer_cookie, target="ghost", summary="note1"
            )
            assert res.status_code == 404
        finally:
            FakeInternalClient.get_file = original

    def test_requires_drive_header(self, client, viewer_cookie):
        res = client.post(
            "/file_active_summary",
            json={"target_file_id": "x", "summary_note_id": "y"},
            headers={"Cookie": viewer_cookie},
        )
        assert res.status_code == 400

    def test_emits_changed_event(
        self, client, fake_internal, viewer_cookie
    ):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "test-drive", "filename": "v.mp4"},
            "note1": {"id": "note1", "drive": "test-drive", "filename": "v.md"},
        }
        _put_pointer(client, viewer_cookie, target="src1", summary="note1")
        events = fake_internal.captured_addon_events
        assert any(e["event"] == "knowledge.active_summary.changed" for e in events)


class TestGetAndDelete:
    def test_get_pointer(self, client, fake_internal, viewer_cookie):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "test-drive", "filename": "v.mp4"},
            "note1": {"id": "note1", "drive": "test-drive", "filename": "v.md"},
        }
        _put_pointer(client, viewer_cookie, target="src1", summary="note1")

        res = client.get(
            "/file_active_summary/src1",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 200
        assert res.json()["summary_note_id"] == "note1"

    def test_get_404_when_drive_mismatch(
        self, client, fake_internal, viewer_cookie
    ):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "test-drive", "filename": "v.mp4"},
            "note1": {"id": "note1", "drive": "test-drive", "filename": "v.md"},
        }
        _put_pointer(client, viewer_cookie, target="src1", summary="note1")
        res = client.get(
            "/file_active_summary/src1",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "media"},
        )
        assert res.status_code == 404

    def test_delete_pointer(self, client, fake_internal, viewer_cookie):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "test-drive", "filename": "v.mp4"},
            "note1": {"id": "note1", "drive": "test-drive", "filename": "v.md"},
        }
        _put_pointer(client, viewer_cookie, target="src1", summary="note1")
        res = client.delete(
            "/file_active_summary/src1",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 204

        res2 = client.get(
            "/file_active_summary/src1",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res2.status_code == 404


class TestNoteEndpoint:
    def test_returns_summary_note_details(
        self, client, fake_internal, viewer_cookie
    ):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "test-drive", "filename": "v.mp4"},
            "note1": {
                "id": "note1",
                "drive": "test-drive",
                "filename": "v.md",
                "folder_path": "Notes",
            },
        }
        _put_pointer(client, viewer_cookie, target="src1", summary="note1")

        res = client.get(
            "/file_active_summary/src1/note",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["has_active_summary"] is True
        assert body["file_id"] == "src1"
        assert body["summary_note"]["file_id"] == "note1"

    def test_returns_false_when_no_pointer(self, client, viewer_cookie):
        res = client.get(
            "/file_active_summary/missing/note",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["has_active_summary"] is False
        assert body["summary_note"] is None


class TestInternalDelete:
    """``DELETE /internal/file_active_summary/{file_id}`` — used by
    intelligence regenerate. Bypasses addon_proxy; gated by webhook secret.
    """

    def test_deletes_without_drive_header(
        self, client, fake_internal, viewer_cookie, monkeypatch
    ):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "test-drive", "filename": "v.mp4"},
            "note1": {"id": "note1", "drive": "test-drive", "filename": "v.md"},
        }
        _put_pointer(client, viewer_cookie, target="src1", summary="note1")

        # Secret unset in tests → gate is no-op (matches webhook handler).
        res = client.delete("/internal/file_active_summary/src1")
        assert res.status_code == 204

        # Pointer is gone.
        res2 = client.get(
            "/file_active_summary/src1",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert res2.status_code == 404

    def test_idempotent_on_missing(self, client):
        res = client.delete("/internal/file_active_summary/ghost")
        assert res.status_code == 204

    def test_secret_mismatch_403(self, client, monkeypatch):
        import app.auth as auth

        monkeypatch.setattr(auth, "_WEBHOOK_SECRET", "topsecret")
        res = client.delete(
            "/internal/file_active_summary/src1",
            headers={"X-Webhook-Secret": "wrong"},
        )
        assert res.status_code == 403


class TestPurgeWebhook:
    """``files.purged`` cleans up active_summary rows that name purged
    files on either side. Cross-DB so core's CASCADE doesn't reach us."""

    def test_purge_clears_pointer_on_target(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "test-drive", "filename": "v.mp4"},
            "note1": {"id": "note1", "drive": "test-drive", "filename": "v.md"},
        }
        _put_pointer(client, viewer_cookie, target="src1", summary="note1")

        res = client.post(
            "/webhook/files-purged",
            json={"event": "files.purged", "file_ids": ["src1"]},
        )
        assert res.status_code == 200

        Session = knowledge_db
        with Session() as s:
            assert s.query(FileActiveSummary).count() == 0

    def test_purge_clears_pointer_on_summary_note(
        self, client, fake_internal, viewer_cookie, knowledge_db
    ):
        fake_internal.file_info_override = {
            "src1": {"id": "src1", "drive": "test-drive", "filename": "v.mp4"},
            "note1": {"id": "note1", "drive": "test-drive", "filename": "v.md"},
        }
        _put_pointer(client, viewer_cookie, target="src1", summary="note1")

        res = client.post(
            "/webhook/files-purged",
            json={"event": "files.purged", "file_ids": ["note1"]},
        )
        assert res.status_code == 200

        Session = knowledge_db
        with Session() as s:
            assert s.query(FileActiveSummary).count() == 0
