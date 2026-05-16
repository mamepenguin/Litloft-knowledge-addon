"""Dashboard connections-graph endpoint.

Returns the full file-relation graph for the current drive, used by
the knowledge dashboard's Obsidian-style force-directed view.

The graph unions two edge sources:

* ``file_relations`` (core) — explicit file-to-file relations, fetched
  via ``GET /api/internal/file_relations?drive=X``.
* ``note_origin_sources`` (knowledge) — notes citing source files via
  the ``source_file_ids`` frontmatter key. Already drive-scoped here.

Both sources may describe the same connection (distill writes to
both), so edges are deduplicated by unordered pair; when both kinds
exist, ``related`` wins over ``note_source``.

Orphans are scoped to notes (``note_origins`` rows with no outgoing
relation in either source). Non-note files that happen to have no
relations are not surfaced — the dashboard is a notes-first view
and listing every untagged video would dilute the signal.

Drive boundary: see hako ``-4selmRmM4uGucok5TX6N`` — addon must apply
``WHERE drive == header_drive`` even though the host proxy already
validates the header.
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_viewer_id
from app.database import get_db
from app.internal_client import InternalAPIError, InternalClient
from app.models import NoteOrigin, NoteOriginSource
from app.routers.distill import _require_drive

router = APIRouter(tags=["connections-graph"])


# Cap a single response to keep payloads small. Most drives stay well
# under these limits; the warning ribbon at >200 nodes nudges the user
# to use focus mode before reaching them.
_MAX_RELATIONS = 5000
_ORPHAN_SAMPLE = 20


MimeKind = Literal["md", "video", "image", "pdf", "other"]


class GraphNode(BaseModel):
    id: str
    title: str
    path: str
    mime_kind: MimeKind
    folder: str
    tags: list[str]
    relation_count: int


class GraphEdge(BaseModel):
    a: str
    b: str
    kind: Literal["related", "note_source"]


class OrphanItem(BaseModel):
    id: str
    title: str
    path: str


class ConnectionsGraph(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    orphan_count: int
    orphans: list[OrphanItem]


_VIDEO_PREFIX = "video/"
_IMAGE_PREFIX = "image/"
_PDF_MIME = "application/pdf"
_MD_EXTENSIONS = (".md", ".markdown")


def _classify_mime(mime: str | None, filename: str) -> MimeKind:
    name = filename.lower()
    if name.endswith(_MD_EXTENSIONS):
        return "md"
    if not mime:
        return "other"
    if mime.startswith(_VIDEO_PREFIX):
        return "video"
    if mime.startswith(_IMAGE_PREFIX):
        return "image"
    if mime == _PDF_MIME:
        return "pdf"
    if mime.startswith("text/markdown"):
        return "md"
    return "other"


def _node_title(file_obj: dict) -> str:
    # Prefer human-edited title; fall back to filename.
    return (file_obj.get("title") or file_obj.get("filename") or "").strip() or "(untitled)"


def _node_path(file_obj: dict) -> str:
    folder = (file_obj.get("folder_path") or "").strip("/")
    filename = file_obj.get("filename") or ""
    return f"{folder}/{filename}" if folder else filename


def _node_folder(file_obj: dict) -> str:
    folder = (file_obj.get("folder_path") or "").strip("/")
    if not folder:
        return ""
    return folder.split("/", 1)[0]


@router.get("/connections-graph", response_model=ConnectionsGraph)
async def get_connections_graph(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    _viewer_id: Annotated[str, Depends(get_viewer_id)],
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
) -> ConnectionsGraph:
    drive = _require_drive(x_hv_drive)
    cookie_header = request.headers.get("cookie")

    # ----- 1. Knowledge-local data ---------------------------------------
    note_rows = (
        db.query(NoteOrigin)
        .filter(NoteOrigin.drive == drive)
        .all()
    )
    notes_by_path = {row.note_path: row for row in note_rows}
    note_ids: set[str] = {row.note_file_id for row in note_rows}

    src_rows = (
        db.query(NoteOriginSource)
        .filter(NoteOriginSource.drive == drive)
        .all()
    )
    # note_path -> set(source_file_id)
    note_sources: dict[str, set[str]] = {}
    for s in src_rows:
        note_sources.setdefault(s.note_path, set()).add(s.source_file_id)

    # ----- 2. Core file_relations (drive-wide) ---------------------------
    client = InternalClient(cookie_header=cookie_header)
    try:
        relation_rows = await client.list_file_relations_by_drive(
            drive=drive, limit=_MAX_RELATIONS
        )
    except InternalAPIError as e:
        raise HTTPException(status_code=502, detail=f"file_relations fetch failed: {e.detail}")

    # ----- 3. Build unique edge set --------------------------------------
    # Key: tuple(sorted([a, b])). Value: edge kind ("related" beats "note_source").
    edges: dict[tuple[str, str], str] = {}
    referenced_ids: set[str] = set()

    for rel in relation_rows:
        a = str(rel["file_id_a"])
        b = str(rel["file_id_b"])
        pair = (a, b) if a < b else (b, a)
        edges[pair] = "related"
        referenced_ids.update(pair)

    for note_path, sources in note_sources.items():
        note = notes_by_path.get(note_path)
        if note is None:
            continue
        nid = note.note_file_id
        for sid in sources:
            pair = (nid, sid) if nid < sid else (sid, nid)
            referenced_ids.update(pair)
            edges.setdefault(pair, "note_source")

    # Include note nodes even if isolated (we still list them in orphans)
    referenced_ids.update(note_ids)

    # ----- 4. Fetch node metadata in one round trip ----------------------
    try:
        bulk = await client.fetch_bulk_files(list(referenced_ids))
    except InternalAPIError as e:
        raise HTTPException(status_code=502, detail=f"files/bulk fetch failed: {e.detail}")

    by_id: dict[str, dict] = {f["id"]: f for f in bulk.get("files", [])}

    # ----- 5. Defense-in-depth: confirm drive match ----------------------
    # spec hako -4selmRmM4uGucok5TX6N: assert every returned file lives
    # on the requested drive. If somehow not, drop it.
    drive_filtered = {fid for fid, f in by_id.items() if f.get("drive") == drive}

    # ----- 6. Count relations per node (for size encoding) ---------------
    relation_count: dict[str, int] = {}
    valid_edges: list[GraphEdge] = []
    for (a, b), kind in edges.items():
        if a not in drive_filtered or b not in drive_filtered:
            continue
        relation_count[a] = relation_count.get(a, 0) + 1
        relation_count[b] = relation_count.get(b, 0) + 1
        valid_edges.append(GraphEdge(a=a, b=b, kind=kind))  # type: ignore[arg-type]

    # ----- 7. Build node list --------------------------------------------
    # Include only nodes that participate in an edge — orphan notes are
    # surfaced separately so users can choose to fix them.
    connected_ids = {nid for edge in valid_edges for nid in (edge.a, edge.b)}

    nodes: list[GraphNode] = []
    for fid in connected_ids:
        f = by_id.get(fid)
        if f is None:
            continue
        nodes.append(
            GraphNode(
                id=fid,
                title=_node_title(f),
                path=_node_path(f),
                mime_kind=_classify_mime(f.get("mime_type"), f.get("filename") or ""),
                folder=_node_folder(f),
                tags=list(f.get("tags") or []),
                relation_count=relation_count.get(fid, 0),
            )
        )

    # ----- 8. Orphan notes (notes with no edge participation) ------------
    orphans_all: list[OrphanItem] = []
    for row in note_rows:
        if row.note_file_id in connected_ids:
            continue
        # Need title — fall back to note_path slug if not in bulk fetch
        # (e.g. note file was missing/trash).
        f = by_id.get(row.note_file_id)
        if f is None:
            title_fallback = row.note_path.rsplit("/", 1)[-1]
            if title_fallback.endswith(".md"):
                title_fallback = title_fallback[:-3]
            orphans_all.append(
                OrphanItem(
                    id=row.note_file_id,
                    title=title_fallback,
                    path=row.note_path,
                )
            )
        else:
            orphans_all.append(
                OrphanItem(
                    id=row.note_file_id,
                    title=_node_title(f),
                    path=_node_path(f),
                )
            )

    orphan_count = len(orphans_all)
    orphans = orphans_all[:_ORPHAN_SAMPLE]

    return ConnectionsGraph(
        nodes=nodes,
        edges=valid_edges,
        orphan_count=orphan_count,
        orphans=orphans,
    )
