"""File active-summary pointer endpoints.

Moved from core (spec ``2026-04-30-file-active-summary-to-knowledge``).
Two surfaces:

* Drive-scoped routes (``/file_active_summary*``) — exposed through the
  addon_proxy. Frontend reads via ``GET /{file_id}/note`` (the rendered
  summary view), addons that have user context (knowledge ``/distill``)
  write via UPSERT/DELETE.
* Internal route (``/internal/file_active_summary/{file_id}``) — used
  by intelligence regenerate to clear the pointer service-to-service.
  Bypasses addon_proxy (no X-Lit-Drive available without user context)
  and is gated by ``KNOWLEDGE_WEBHOOK_SECRET`` instead. The same secret
  that protects core → knowledge webhooks; both are "trusted-service
  authenticates to knowledge" channels within the Docker network.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import verify_webhook_secret
from app.database import get_db
from app.internal_client import InternalAPIError, InternalClient
from app.models import FileActiveSummary

logger = logging.getLogger(__name__)

router = APIRouter(tags=["active-summary"])


def _require_drive(x_lit_drive: str | None) -> str:
    if not x_lit_drive:
        raise HTTPException(status_code=400, detail="Drive context required")
    return unquote(x_lit_drive)


class ActiveSummaryUpsert(BaseModel):
    target_file_id: str = Field(min_length=1, max_length=12)
    summary_note_id: str = Field(min_length=1, max_length=12)


class ActiveSummaryOut(BaseModel):
    target_file_id: str
    summary_note_id: str
    set_at: datetime

    model_config = {"from_attributes": True}


class SummaryNoteDetail(BaseModel):
    file_id: str
    drive: str
    path: str
    title: str | None = None


class ActiveSummaryNoteResponse(BaseModel):
    has_active_summary: bool
    file_id: str
    summary_note: SummaryNoteDetail | None = None


def _row_to_out(row: FileActiveSummary) -> ActiveSummaryOut:
    return ActiveSummaryOut(
        target_file_id=row.target_file_id,
        summary_note_id=row.summary_note_id,
        set_at=row.set_at,
    )


async def _verify_files_in_drive(
    cookie: str | None,
    *,
    target_file_id: str,
    summary_note_id: str,
    drive: str,
) -> None:
    """Resolve both file IDs through core internal API and require same drive.

    Mirrors the validation that core's old ``POST /file_active_summary``
    performed: same-drive constraint, both files must exist, neither may
    be missing/trashed (active_file_filter is applied by the internal
    endpoint). Errors map to the same HTTP codes the old endpoint used
    so frontend / intelligence callers don't need to special-case the
    move.
    """
    client = InternalClient(cookie_header=cookie)
    try:
        target_info = await client.get_file(target_file_id)
        summary_info = await client.get_file(summary_note_id)
    except InternalAPIError as exc:
        if exc.status_code == 404:
            raise HTTPException(status_code=404, detail="file not found")
        raise HTTPException(status_code=502, detail=str(exc))
    if target_info.get("drive") != drive or summary_info.get("drive") != drive:
        raise HTTPException(
            status_code=400, detail="files must be in the same drive"
        )
    if target_file_id == summary_note_id:
        raise HTTPException(status_code=400, detail="files must differ")


@router.post("/file_active_summary", response_model=ActiveSummaryOut)
async def upsert_active_summary(
    body: ActiveSummaryUpsert,
    db: Annotated[Session, Depends(get_db)],
    x_lit_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
) -> ActiveSummaryOut:
    drive = _require_drive(x_lit_drive)
    await _verify_files_in_drive(
        cookie,
        target_file_id=body.target_file_id,
        summary_note_id=body.summary_note_id,
        drive=drive,
    )

    row = (
        db.query(FileActiveSummary)
        .filter(FileActiveSummary.target_file_id == body.target_file_id)
        .first()
    )
    if row is None:
        row = FileActiveSummary(
            target_file_id=body.target_file_id,
            drive=drive,
            summary_note_id=body.summary_note_id,
        )
        db.add(row)
    else:
        # Drive shouldn't change for a given target_file_id; fail loudly
        # if it somehow does so the inconsistency surfaces immediately.
        if row.drive != drive:
            raise HTTPException(
                status_code=400, detail="target file drive mismatch"
            )
        row.summary_note_id = body.summary_note_id
        row.set_at = datetime.now(UTC)
    db.commit()
    db.refresh(row)

    client = InternalClient(cookie_header=cookie)
    await client.emit_addon_event(
        "knowledge.active_summary.changed",
        {
            "file_id": body.target_file_id,
            "summary_file_id": body.summary_note_id,
        },
        drive=drive,
    )

    return _row_to_out(row)


@router.get("/file_active_summary/{file_id}", response_model=ActiveSummaryOut)
async def get_active_summary_pointer(
    file_id: str,
    db: Annotated[Session, Depends(get_db)],
    x_lit_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
) -> ActiveSummaryOut:
    drive = _require_drive(x_lit_drive)
    row = (
        db.query(FileActiveSummary)
        .filter(
            FileActiveSummary.target_file_id == file_id,
            FileActiveSummary.drive == drive,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="active summary not found")
    return _row_to_out(row)


@router.delete("/file_active_summary/{file_id}")
async def delete_active_summary(
    file_id: str,
    db: Annotated[Session, Depends(get_db)],
    x_lit_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
) -> Response:
    drive = _require_drive(x_lit_drive)
    row = (
        db.query(FileActiveSummary)
        .filter(
            FileActiveSummary.target_file_id == file_id,
            FileActiveSummary.drive == drive,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="active summary not found")
    db.delete(row)
    db.commit()

    client = InternalClient(cookie_header=cookie)
    await client.emit_addon_event(
        "knowledge.active_summary.changed",
        {"file_id": file_id, "summary_file_id": None},
        drive=drive,
    )
    return Response(status_code=204)


@router.get(
    "/file_active_summary/{file_id}/note",
    response_model=ActiveSummaryNoteResponse,
)
async def get_active_summary_note(
    file_id: str,
    db: Annotated[Session, Depends(get_db)],
    x_lit_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
) -> ActiveSummaryNoteResponse:
    """Return the rendered summary-note details for the file detail page.

    Replaces the public core endpoint ``GET /api/files/{id}/active_summary``.
    Same response shape so frontend ``useActiveSummary`` only changes URL.
    Returns ``has_active_summary: false`` (200) — not 404 — when no
    pointer exists, so the hook can render the AI-summary fallback
    instead of treating the absence as an error.
    """
    drive = _require_drive(x_lit_drive)
    row = (
        db.query(FileActiveSummary)
        .filter(
            FileActiveSummary.target_file_id == file_id,
            FileActiveSummary.drive == drive,
        )
        .first()
    )
    if row is None:
        return ActiveSummaryNoteResponse(has_active_summary=False, file_id=file_id)

    client = InternalClient(cookie_header=cookie)
    try:
        note_info = await client.get_file(row.summary_note_id)
    except InternalAPIError as exc:
        # Note file gone (purged / missing) — surface as no active summary
        # so the file detail page falls back to the AI summary view.
        if exc.status_code == 404:
            return ActiveSummaryNoteResponse(
                has_active_summary=False, file_id=file_id
            )
        raise HTTPException(status_code=502, detail=str(exc))

    title = note_info.get("filename") or None
    return ActiveSummaryNoteResponse(
        has_active_summary=True,
        file_id=file_id,
        summary_note=SummaryNoteDetail(
            file_id=row.summary_note_id,
            drive=note_info.get("drive", drive),
            path=note_info.get("folder_path", "") + "/" + (note_info.get("filename") or ""),
            title=title,
        ),
    )


@router.delete(
    "/internal/file_active_summary/{file_id}",
    dependencies=[Depends(verify_webhook_secret)],
)
async def delete_active_summary_internal(
    file_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    """Service-to-service DELETE used by intelligence regenerate.

    No drive header — intelligence has no user context and just knows
    the file_id. Auth is via shared secret (``KNOWLEDGE_WEBHOOK_SECRET``,
    same channel core → knowledge webhooks ride). 204 even when the row
    is absent so the caller can be idempotent (matches core's old
    ``best-effort`` semantics for ``_clear_core_active_summary``).
    """
    row = (
        db.query(FileActiveSummary)
        .filter(FileActiveSummary.target_file_id == file_id)
        .first()
    )
    if row is None:
        return Response(status_code=204)
    drive = row.drive
    db.delete(row)
    db.commit()

    client = InternalClient()
    await client.emit_addon_event(
        "knowledge.active_summary.changed",
        {"file_id": file_id, "summary_file_id": None},
        drive=drive,
    )
    return Response(status_code=204)
