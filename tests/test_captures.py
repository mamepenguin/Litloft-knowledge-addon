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
