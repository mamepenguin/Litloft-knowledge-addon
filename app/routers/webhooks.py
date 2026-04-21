"""Webhook endpoints for HomeVault core lifecycle events.

The core process sends ``files.missing``, ``files.recovered``, and
``files.purged`` events via ``event-hooks.json``. We respond by
re-rolling up ``NoteOrigin.health``. See ``app/webhook.py`` for the
business logic.

These endpoints are not exposed through the addon_proxy (no manifest
entry) — core dispatches to them directly over Docker-internal HTTP.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth import verify_webhook_secret
from app.schemas import (
    WebhookAck,
    WebhookFilesMissing,
    WebhookFilesPurged,
    WebhookFilesRecovered,
)
from app.webhook import (
    handle_files_missing,
    handle_files_purged,
    handle_files_recovered,
)

router = APIRouter(tags=["webhooks"])


@router.post("/webhook/files-missing", response_model=WebhookAck)
async def webhook_files_missing(
    body: WebhookFilesMissing,
    _: None = Depends(verify_webhook_secret),
) -> WebhookAck:
    touched = await handle_files_missing(list(body.file_ids))
    return WebhookAck(notes_touched=touched)


@router.post("/webhook/files-recovered", response_model=WebhookAck)
async def webhook_files_recovered(
    body: WebhookFilesRecovered,
    _: None = Depends(verify_webhook_secret),
) -> WebhookAck:
    touched = await handle_files_recovered(list(body.file_ids))
    return WebhookAck(notes_touched=touched)


@router.post("/webhook/files-purged", response_model=WebhookAck)
async def webhook_files_purged(
    body: WebhookFilesPurged,
    _: None = Depends(verify_webhook_secret),
) -> WebhookAck:
    touched = await handle_files_purged(list(body.file_ids))
    return WebhookAck(notes_touched=touched)
