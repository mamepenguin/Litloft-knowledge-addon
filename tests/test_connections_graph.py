"""Tests for GET /connections-graph.

Covers:
- Drive header required (400 without ``X-Lit-Drive``)
- Drive boundary: cross-drive relations and file rows are filtered out
- Edge union: file_relations ∪ note_origin_sources, deduplicated by pair
- ``related`` wins over ``note_source`` for the same pair
- Orphan notes (no edge participation) listed separately
- mime_kind classification (md / video / image / pdf / other)
- 502 surfaced when Internal API fails
"""
from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.models import NoteOrigin, NoteOriginSource


def _seed_note(
    session,
    *,
    drive: str = "test-drive",
    note_path: str = "n.md",
    note_file_id: str = "n_default",
) -> None:
    row = NoteOrigin(
        drive=drive,
        note_path=note_path,
        note_file_id=note_file_id,
        origin="manual",
        health="healthy",
    )
    session.add(row)
    session.commit()


def _seed_source(
    session,
    *,
    drive: str = "test-drive",
    note_path: str,
    source_file_id: str,
) -> None:
    row = NoteOriginSource(
        drive=drive,
        note_path=note_path,
        source_file_id=source_file_id,
    )
    session.add(row)
    session.commit()


def _file_meta(
    file_id: str,
    *,
    drive: str = "test-drive",
    filename: str = "x.md",
    mime: str = "text/markdown",
    folder: str = "",
    tags: list[str] | None = None,
    title: str | None = None,
) -> dict:
    return {
        "id": file_id,
        "drive": drive,
        "filename": filename,
        "title": title or filename,
        "mime_type": mime,
        "folder_path": folder,
        "tags": tags or [],
    }


class TestConnectionsGraph:
    def test_400_without_drive_header(self, client, fake_internal, viewer_cookie):
        r = client.get(
            "/connections-graph",
            headers={"Cookie": viewer_cookie},
        )
        assert r.status_code == 400

    def test_empty_drive_returns_empty_graph(self, client, fake_internal, viewer_cookie):
        r = client.get(
            "/connections-graph",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body == {
            "nodes": [],
            "edges": [],
            "orphan_count": 0,
            "orphans": [],
        }

    def test_unions_file_relations_and_note_sources(
        self, client, fake_internal, knowledge_db, viewer_cookie
    ):
        session = knowledge_db()
        try:
            _seed_note(
                session,
                note_path="note1.md",
                note_file_id="fNote000001",
            )
            _seed_source(
                session,
                note_path="note1.md",
                source_file_id="fSrc0000001",
            )
        finally:
            session.close()

        fake_internal.relations_by_drive_override = {
            "test-drive": [
                {
                    "id": 1,
                    "file_id_a": "fRel0000001",
                    "file_id_b": "fRel0000002",
                    "kind": "related",
                    "created_at": "2026-05-15T00:00:00Z",
                    "created_by": None,
                }
            ]
        }
        fake_internal.bulk_files_override = {
            "fNote000001": _file_meta("fNote000001", filename="note1.md"),
            "fSrc0000001": _file_meta(
                "fSrc0000001", filename="article.pdf", mime="application/pdf"
            ),
            "fRel0000001": _file_meta(
                "fRel0000001", filename="a.mp4", mime="video/mp4"
            ),
            "fRel0000002": _file_meta(
                "fRel0000002", filename="b.mp4", mime="video/mp4"
            ),
        }

        r = client.get(
            "/connections-graph",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["edges"]) == 2
        kinds = {(min(e["a"], e["b"]), max(e["a"], e["b"])): e["kind"] for e in body["edges"]}
        assert kinds[("fRel0000001", "fRel0000002")] == "related"
        # note→source pair
        note_src_pair = (
            min("fNote000001", "fSrc0000001"),
            max("fNote000001", "fSrc0000001"),
        )
        assert kinds[note_src_pair] == "note_source"
        # Each node appears once
        node_ids = {n["id"] for n in body["nodes"]}
        assert node_ids == {
            "fNote000001",
            "fSrc0000001",
            "fRel0000001",
            "fRel0000002",
        }

    def test_related_wins_over_note_source_on_same_pair(
        self, client, fake_internal, knowledge_db, viewer_cookie
    ):
        """distill writes both file_relations(kind=related) and a
        note_origin_source row for the same pair. The graph should
        report a single edge with kind=related."""
        session = knowledge_db()
        try:
            _seed_note(
                session,
                note_path="n.md",
                note_file_id="fNote000001",
            )
            _seed_source(
                session,
                note_path="n.md",
                source_file_id="fSrc0000001",
            )
        finally:
            session.close()

        fake_internal.relations_by_drive_override = {
            "test-drive": [
                {
                    "id": 1,
                    "file_id_a": "fSrc0000001",
                    "file_id_b": "fNote000001",
                    "kind": "related",
                    "created_at": "2026-05-15T00:00:00Z",
                    "created_by": None,
                }
            ]
        }
        fake_internal.bulk_files_override = {
            "fNote000001": _file_meta("fNote000001", filename="n.md"),
            "fSrc0000001": _file_meta(
                "fSrc0000001", filename="article.pdf", mime="application/pdf"
            ),
        }

        r = client.get(
            "/connections-graph",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        body = r.json()
        assert len(body["edges"]) == 1
        assert body["edges"][0]["kind"] == "related"

    def test_orphan_note_listed_separately(
        self, client, fake_internal, knowledge_db, viewer_cookie
    ):
        session = knowledge_db()
        try:
            _seed_note(
                session,
                note_path="lonely.md",
                note_file_id="fLone000001",
            )
        finally:
            session.close()

        fake_internal.bulk_files_override = {
            "fLone000001": _file_meta("fLone000001", filename="lonely.md"),
        }

        r = client.get(
            "/connections-graph",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        body = r.json()
        assert body["nodes"] == []
        assert body["edges"] == []
        assert body["orphan_count"] == 1
        assert body["orphans"] == [
            {"id": "fLone000001", "title": "lonely.md", "path": "lonely.md"}
        ]

    def test_drive_boundary_filters_cross_drive_files(
        self, client, fake_internal, knowledge_db, viewer_cookie
    ):
        """Even if Internal API somehow returns a file from another drive,
        the addon must drop it (hako -4selmRmM4uGucok5TX6N)."""
        fake_internal.relations_by_drive_override = {
            "test-drive": [
                {
                    "id": 1,
                    "file_id_a": "fGood000001",
                    "file_id_b": "fLeak000001",
                    "kind": "related",
                    "created_at": "2026-05-15T00:00:00Z",
                    "created_by": None,
                }
            ]
        }
        fake_internal.bulk_files_override = {
            "fGood000001": _file_meta(
                "fGood000001", filename="a.mp4", mime="video/mp4"
            ),
            "fLeak000001": _file_meta(
                "fLeak000001",
                drive="other-drive",
                filename="leaked.mp4",
                mime="video/mp4",
            ),
        }

        r = client.get(
            "/connections-graph",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        body = r.json()
        # Edge is dropped because one endpoint belongs to another drive
        assert body["edges"] == []
        assert body["nodes"] == []

    def test_mime_classification(self, client, fake_internal, knowledge_db, viewer_cookie):
        session = knowledge_db()
        try:
            _seed_note(session, note_path="n.md", note_file_id="fN000000001")
            _seed_source(
                session, note_path="n.md", source_file_id="fV000000001"
            )
            _seed_source(
                session, note_path="n.md", source_file_id="fI000000001"
            )
            _seed_source(
                session, note_path="n.md", source_file_id="fP000000001"
            )
            _seed_source(
                session, note_path="n.md", source_file_id="fO000000001"
            )
        finally:
            session.close()

        fake_internal.bulk_files_override = {
            "fN000000001": _file_meta(
                "fN000000001", filename="n.md", mime="text/markdown"
            ),
            "fV000000001": _file_meta(
                "fV000000001", filename="v.mp4", mime="video/mp4"
            ),
            "fI000000001": _file_meta(
                "fI000000001", filename="i.jpg", mime="image/jpeg"
            ),
            "fP000000001": _file_meta(
                "fP000000001", filename="p.pdf", mime="application/pdf"
            ),
            "fO000000001": _file_meta(
                "fO000000001", filename="o.csv", mime="text/csv"
            ),
        }

        r = client.get(
            "/connections-graph",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        body = r.json()
        by_id = {n["id"]: n["mime_kind"] for n in body["nodes"]}
        assert by_id["fN000000001"] == "md"
        assert by_id["fV000000001"] == "video"
        assert by_id["fI000000001"] == "image"
        assert by_id["fP000000001"] == "pdf"
        assert by_id["fO000000001"] == "other"

    def test_relation_count_per_node(
        self, client, fake_internal, knowledge_db, viewer_cookie
    ):
        """A hub note connected to three sources should have rc=3."""
        session = knowledge_db()
        try:
            _seed_note(session, note_path="hub.md", note_file_id="fH000000001")
            _seed_source(
                session, note_path="hub.md", source_file_id="fS000000001"
            )
            _seed_source(
                session, note_path="hub.md", source_file_id="fS000000002"
            )
            _seed_source(
                session, note_path="hub.md", source_file_id="fS000000003"
            )
        finally:
            session.close()

        fake_internal.bulk_files_override = {
            "fH000000001": _file_meta("fH000000001", filename="hub.md"),
            "fS000000001": _file_meta(
                "fS000000001", filename="s1.mp4", mime="video/mp4"
            ),
            "fS000000002": _file_meta(
                "fS000000002", filename="s2.mp4", mime="video/mp4"
            ),
            "fS000000003": _file_meta(
                "fS000000003", filename="s3.mp4", mime="video/mp4"
            ),
        }

        r = client.get(
            "/connections-graph",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        body = r.json()
        by_id = {n["id"]: n["relation_count"] for n in body["nodes"]}
        assert by_id["fH000000001"] == 3
        assert by_id["fS000000001"] == 1
        assert by_id["fS000000002"] == 1
        assert by_id["fS000000003"] == 1

    def test_502_on_internal_api_failure(
        self, client, fake_internal, knowledge_db, viewer_cookie
    ):
        fake_internal.raise_on_relations_by_drive = 500
        r = client.get(
            "/connections-graph",
            headers={"Cookie": viewer_cookie, "X-Lit-Drive": "test-drive"},
        )
        assert r.status_code == 502
