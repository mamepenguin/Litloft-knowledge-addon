from __future__ import annotations

from app.models import NoteOrigin


def _body(target: dict | None = None) -> dict:
    return {
        "target": target
        or {
            "mode": "new",
            "folder": "Research",
            "filename": "sources.md",
            "title": "Sources",
        },
        "captures": [
            {
                "source_file_id": "abc123def456",
                "filename": "Untrusted name.mp4",
                "file_type": "video",
                "kind": "transcript",
                "locator": {"seconds": 65, "end_seconds": 70},
                "quote": "Quoted text",
            }
        ],
    }


def _post(client, viewer_cookie, body: dict):
    return client.post(
        "/captures/commit",
        json=body,
        headers={**viewer_cookie, "X-Lit-Drive": "test-drive"},
    )


def test_new_note_uses_canonical_source_metadata(
    client, fake_internal, viewer_cookie
) -> None:
    fake_internal.file_info_override["abc123def456"] = {
        "id": "abc123def456",
        "drive": "test-drive",
        "filename": "Canonical.mp4",
        "file_type": "video",
    }

    response = _post(client, viewer_cookie, _body())

    assert response.status_code == 200, response.text
    assert response.json()["committed"] == 1
    written = fake_internal.captured_text_writes[0]["content"]
    assert "[Canonical.mp4](loft://abc123def456?t=65)" in written
    assert "Untrusted name" not in written


def test_new_note_uses_core_resolved_path_after_filename_collision(
    client, fake_internal, viewer_cookie, knowledge_db
) -> None:
    requested_path = "Research/sources.md"
    resolved_path = "Research/sources (1).md"
    fake_internal.create_text_file_result_paths[requested_path] = resolved_path

    session = knowledge_db()
    session.add(
        NoteOrigin(
            drive="test-drive",
            note_path=requested_path,
            note_file_id="oldnote12345",
            origin="source_capture",
            health="healthy",
        )
    )
    session.commit()
    session.close()

    response = _post(client, viewer_cookie, _body())

    assert response.status_code == 200, response.text
    assert response.json()["note_path"] == resolved_path
    verify = knowledge_db()
    assert verify.get(NoteOrigin, ("test-drive", resolved_path)) is not None
    verify.close()


def test_append_requires_matching_etag_and_preserves_basket_on_412_contract(
    client, fake_internal, viewer_cookie
) -> None:
    fake_internal.file_info_override.update(
        {
            "abc123def456": {
                "id": "abc123def456",
                "drive": "test-drive",
                "filename": "Canonical.mp4",
                "file_type": "video",
            },
            "note12345678": {
                "id": "note12345678",
                "drive": "test-drive",
                "filename": "note.md",
                "file_path": "Notes/note.md",
                "mime_type": "text/markdown",
            },
        }
    )
    fake_internal.file_content_override["note12345678"] = ("# Note\n", '"newer"')
    body = _body(
        {
            "mode": "existing",
            "file_id": "note12345678",
            "etag": '"stale"',
        }
    )

    response = _post(client, viewer_cookie, body)

    assert response.status_code == 412
    assert fake_internal.captured_content_puts == []


def test_append_writes_with_if_match(client, fake_internal, viewer_cookie) -> None:
    fake_internal.file_info_override.update(
        {
            "abc123def456": {
                "id": "abc123def456",
                "drive": "test-drive",
                "filename": "Canonical.mp4",
                "file_type": "video",
            },
            "note12345678": {
                "id": "note12345678",
                "drive": "test-drive",
                "filename": "note.md",
                "file_path": "Notes/note.md",
                "mime_type": "text/markdown",
            },
        }
    )
    fake_internal.file_content_override["note12345678"] = ("# Note\n", '"v1"')

    response = _post(
        client,
        viewer_cookie,
        _body(
            {
                "mode": "existing",
                "file_id": "note12345678",
                "etag": "v1",
            }
        ),
    )

    assert response.status_code == 200, response.text
    write = fake_internal.captured_content_puts[0]
    assert write["if_match"] == '"v1"'
    assert "## Captures" in write["content"]


def test_cross_drive_source_is_hidden(client, fake_internal, viewer_cookie) -> None:
    fake_internal.file_info_override["abc123def456"] = {
        "id": "abc123def456",
        "drive": "private",
        "filename": "Secret.mp4",
        "file_type": "video",
    }

    response = _post(client, viewer_cookie, _body())

    assert response.status_code == 404
    assert fake_internal.captured_text_writes == []


def test_quick_append_relooks_up_and_appends_existing_note(
    client, fake_internal, viewer_cookie
) -> None:
    fake_internal.file_info_override["abc123def456"] = {
        "id": "abc123def456",
        "drive": "test-drive",
        "filename": "Canonical.mp4",
        "file_type": "video",
    }
    target = {
        "id": "note12345678",
        "drive": "test-drive",
        "filename": "Inbox.md",
        "file_path": "Captures/Inbox.md",
        "mime_type": "text/markdown",
    }
    fake_internal.file_by_path_override[("test-drive", "Captures/Inbox.md")] = target
    fake_internal.file_content_override["note12345678"] = ("# Inbox\n", '"v1"')

    response = _post(
        client,
        viewer_cookie,
        _body({"mode": "quick", "folder": "Captures", "filename": "Inbox.md"}),
    )

    assert response.status_code == 200, response.text
    assert response.json()["note_path"] == "Captures/Inbox.md"
    assert fake_internal.captured_text_writes == []
    assert fake_internal.captured_content_puts[0]["if_match"] == '"v1"'


def test_quick_append_creates_exact_path_without_suffix(
    client, fake_internal, viewer_cookie
) -> None:
    response = _post(
        client,
        viewer_cookie,
        _body({"mode": "quick", "folder": "Daily", "filename": "2026-08-10.md"}),
    )

    assert response.status_code == 200, response.text
    assert fake_internal.captured_text_writes[0]["path"] == "Daily/2026-08-10.md"
    assert fake_internal.captured_text_writes[0]["conflict_mode"] == "error"


def test_quick_append_relooks_up_after_create_409(
    client, fake_internal, viewer_cookie
) -> None:
    path = "Captures/Inbox.md"
    fake_internal.create_text_file_collisions.add(path)
    target = {
        "id": "note12345678",
        "drive": "test-drive",
        "filename": "Inbox.md",
        "file_path": path,
        "mime_type": "text/markdown",
    }
    fake_internal.file_by_path_sequences[("test-drive", path)] = [None, target]
    fake_internal.file_content_override["note12345678"] = ("# Inbox\n", '"v1"')

    response = _post(
        client,
        viewer_cookie,
        _body({"mode": "quick", "folder": "Captures", "filename": "Inbox.md"}),
    )

    assert response.status_code == 200, response.text
    assert len(fake_internal.captured_content_puts) == 1


def test_quick_append_does_not_retry_etag_conflict(
    client, fake_internal, viewer_cookie, monkeypatch
) -> None:
    path = "Captures/Inbox.md"
    fake_internal.file_by_path_override[("test-drive", path)] = {
        "id": "note12345678",
        "drive": "test-drive",
        "filename": "Inbox.md",
        "file_path": path,
        "mime_type": "text/markdown",
    }
    fake_internal.file_content_override["note12345678"] = ("# Inbox\n", '"v1"')
    monkeypatch.setattr(fake_internal, "raise_on_content_put", 412)

    response = _post(
        client,
        viewer_cookie,
        _body({"mode": "quick", "folder": "Captures", "filename": "Inbox.md"}),
    )

    assert response.status_code == 412
    assert len(fake_internal.captured_content_puts) == 1
