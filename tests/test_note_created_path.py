"""Routes that create notes must record and return the path core chose."""
from __future__ import annotations

import pytest

from app.models import NoteOrigin

ASKED = "Ask/thread.md"


def _save(client, viewer_cookie, route: str):
    headers = {**viewer_cookie, "X-Lit-Drive": "test-drive"}
    if route == "/notes":
        return client.post(
            "/notes",
            json={
                "filename": "thread",
                "folder": "Ask",
                "content": "body",
                "source_file_ids": [],
            },
            headers=headers,
        )
    if route == "/distill":
        return client.post(
            "/distill",
            json={
                "source_file_id": "src1",
                "folder": "Ask",
                "filename": "thread.md",
                "title": "Thread",
                "content": "body",
            },
            headers=headers,
        )
    return client.post(
        "/note-from-file",
        json={
            "source_file_id": "src001",
            "folder": "Ask",
            "filename": "thread.md",
        },
        headers=headers,
    )


@pytest.mark.parametrize("route", ["/notes", "/distill", "/note-from-file"])
def test_core_rename_decides_the_recorded_and_returned_path(
    route, client, fake_internal, viewer_cookie, knowledge_db
):
    fake_internal.create_text_file_renames = True
    fake_internal.occupied_paths = {ASKED}

    first = _save(client, viewer_cookie, route)

    assert first.status_code == 201, first.text
    assert first.json()["note_path"] == "Ask/thread (1).md"
    if route == "/note-from-file":
        return
    verify = knowledge_db()
    assert [row.note_path for row in verify.query(NoteOrigin).all()] == [
        "Ask/thread (1).md"
    ]
    verify.close()

    second = _save(client, viewer_cookie, route)

    assert second.status_code == 201, second.text
    assert second.json()["note_path"] == "Ask/thread (2).md"
    verify = knowledge_db()
    assert verify.query(NoteOrigin).count() == 2
    verify.close()
