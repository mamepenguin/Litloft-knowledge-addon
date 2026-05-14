"""Pydantic request/response models for knowledge endpoints."""
from datetime import datetime

from pydantic import BaseModel, Field


class ClipCreate(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    # Drive-relative subfolder to place the clip under (e.g. "clips/2026").
    # Empty/None means the drive root. The core validates the drive+path
    # combination; we just pass it through after structural checks.
    subfolder: str | None = Field(default=None, max_length=2000)
    # Optional page title hint. When the frontend has it (bookmarklet
    # ?title= prefill, manual entry, etc.) the placeholder lands with a
    # readable name instead of a timestamped stub. The real title from
    # the fetched article takes over on rename after extraction.
    title: str | None = Field(default=None, max_length=400)


class ClipPasted(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    html: str = Field(min_length=1, max_length=5 * 1024 * 1024)
    subfolder: str | None = Field(default=None, max_length=2000)
    title: str | None = Field(default=None, max_length=400)


class ClipJobOut(BaseModel):
    job_id: int
    file_id: str
    status: str


class DistillRequest(BaseModel):
    """Promote a detailed_summary (or similar) into a Knowledge ``.md``.

    ``folder`` is drive-relative (e.g. ``"AI-Drafts/"``). ``filename``
    omits the folder prefix. If a file with this name already exists,
    the server appends ``-2``, ``-3``, … until it finds a free slot.
    ``title`` becomes the first H1 of the note body; the raw
    ``content`` is the markdown body (without frontmatter).
    """

    source_file_id: str = Field(min_length=1, max_length=64)
    folder: str = Field(default="AI-Drafts", max_length=512)
    filename: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=0, max_length=1 * 1024 * 1024)
    origin: str = Field(default="detailed_summary", max_length=32)


class DistillResponse(BaseModel):
    note_file_id: str
    note_path: str


class NoteCreate(BaseModel):
    """Create a Knowledge note with pre-formatted Markdown content.

    Used by the Ask → Knowledge save flow. ``content`` is a complete
    Markdown document (frontmatter + body) composed by the frontend.
    ``source_file_ids`` lists the files cited in the note so the backend
    can register ``file_relations`` immediately (before any PUT /content
    edit triggers Phase 1 sync).
    """

    folder: str = Field(default="Ask", max_length=512)
    filename: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=0, max_length=1 * 1024 * 1024)
    source_file_ids: list[str] = Field(default_factory=list, max_length=50)


class NoteFromFileRequest(BaseModel):
    """Create a Knowledge note linked to an existing file."""

    source_file_id: str = Field(min_length=1, max_length=64)
    filename: str = Field(default="Untitled.md", min_length=1, max_length=200)
    folder: str = Field(default="", max_length=512)


class NoteFromFileResponse(BaseModel):
    note_file_id: str
    note_path: str


class NoteOriginOut(BaseModel):
    """Reverse-lookup entry: a Knowledge note whose frontmatter references a source."""

    note_file_id: str
    drive: str
    path: str
    origin: str | None
    approved_at: datetime | None
    health: str


class SearchHit(BaseModel):
    file_id: str
    filename: str
    title: str
    snippet: str


class SearchResponse(BaseModel):
    query: str
    drive: str
    results: list[SearchHit]
    truncated: bool


class WebhookFilesMissing(BaseModel):
    """Files became missing on disk (still safe in core DB)."""

    file_ids: list[str] = Field(default_factory=list)


class WebhookFilesRecovered(BaseModel):
    """Previously missing files reappeared."""

    file_ids: list[str] = Field(default_factory=list)


class WebhookFilesPurged(BaseModel):
    """Files permanently deleted by the user (no coming back)."""

    file_ids: list[str] = Field(default_factory=list)


class WebhookAck(BaseModel):
    """Trivial response body for webhook handlers."""

    status: str = "ok"
    notes_touched: int = 0
