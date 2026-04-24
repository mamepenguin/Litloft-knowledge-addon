"""Pydantic request/response models for knowledge endpoints."""
from datetime import datetime

from pydantic import BaseModel, Field


class VaultCreate(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    drive: str = Field(min_length=1, max_length=128)
    path: str = Field(default="", max_length=4000)


class VaultUpdate(BaseModel):
    label: str = Field(min_length=1, max_length=100)


class VaultOut(BaseModel):
    id: int
    label: str
    drive: str
    path: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class VaultListResponse(BaseModel):
    vaults: list[VaultOut]
    active_vault_id: int | None


class ClipCreate(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    vault_id: int
    # Vault-relative subfolder to place the clip under (e.g. "clips/2026").
    # Empty/None means Vault root. The core validates the drive+path
    # combination; we just pass it through after structural checks.
    subfolder: str | None = Field(default=None, max_length=2000)
    # Optional page title hint. When the frontend has it (bookmarklet
    # ?title= prefill, manual entry, etc.) the placeholder lands with a
    # readable name instead of a timestamped stub. The real title from
    # the fetched article takes over on rename after extraction.
    title: str | None = Field(default=None, max_length=400)


class ClipPasted(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    vault_id: int
    html: str = Field(min_length=1, max_length=5 * 1024 * 1024)
    subfolder: str | None = Field(default=None, max_length=2000)
    title: str | None = Field(default=None, max_length=400)


class ClipJobOut(BaseModel):
    job_id: int
    file_id: str
    status: str


class DistillRequest(BaseModel):
    """Promote a detailed_summary (or similar) into a Vault ``.md``.

    ``folder`` is Vault-relative (e.g. ``"AI-Drafts/"``). ``filename``
    omits the folder prefix. If a file with this name already exists,
    the server appends ``-2``, ``-3``, … until it finds a free slot.
    ``title`` becomes the first H1 of the note body; the raw
    ``content`` is the markdown body (without frontmatter).
    """

    source_file_id: str = Field(min_length=1, max_length=64)
    vault_id: int
    folder: str = Field(default="AI-Drafts", max_length=512)
    filename: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=0, max_length=1 * 1024 * 1024)
    origin: str = Field(default="detailed_summary", max_length=32)


class DistillResponse(BaseModel):
    note_file_id: str
    note_path: str
    vault_id: int


class NoteOriginOut(BaseModel):
    """Reverse-lookup entry: a Vault note whose frontmatter references a source."""

    note_file_id: str
    vault_id: int
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
    vault_id: int
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
