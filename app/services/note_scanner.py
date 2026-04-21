"""Periodic reconciliation of ``note_origins`` against Vault ``.md`` files.

The scanner asks core's Internal API for each note's current
``updated_at`` timestamp. When it's newer than the row's
``last_synced_at`` we re-fetch the file content, re-parse its
frontmatter, and refresh the origin + source rows accordingly. This
keeps external edits (users opening the ``.md`` in Obsidian and
tweaking ``source_file_ids``, ``origin_ref``, etc.) from drifting our
cache.

Why a scanner and not event hooks: core currently has no
``files.content_updated`` event, and adding one expands core's
responsibility (see hako ``u_QwFBXIYqgVyRIQW86_Z`` for the rationale
on deferring that). A coarse 1h scan is cheap — it's an
``updated_at`` compare per row, a content fetch only on actual
changes.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.database import session_scope
from app.internal_client import InternalAPIError, InternalClient
from app.models import NoteOrigin, NoteOriginSource
from app.services.frontmatter import parse as parse_frontmatter

logger = logging.getLogger(__name__)

_DEFAULT_INTERVAL_SECONDS = 3600


@dataclass(frozen=True)
class ReconcileStats:
    scanned: int
    updated: int
    errors: int


def _assume_utc(dt: datetime) -> datetime:
    """Treat a naive datetime as UTC; pass an aware datetime through.

    The core's SQLite rows are tz-naive (DateTime column stores tz-naive
    values) while our in-process timestamps and parsed ISO strings are
    tz-aware. Normalise both sides so comparisons don't raise.
    """
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    # Handle both "...Z" and "...+00:00" styles. SQLAlchemy ISO output uses
    # "+00:00" for tz-aware rows, but intelligence-era payloads sometimes
    # use trailing Z — accept both to be resilient to drift.
    cleaned = ts.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        return None


def _normalise_source_ids(metadata: dict[str, Any]) -> list[str]:
    raw = metadata.get("source_file_ids")
    if not isinstance(raw, list):
        return []
    return [str(x) for x in raw if isinstance(x, (str, int))]


def _normalise_approved_at(metadata: dict[str, Any]) -> datetime | None:
    raw = metadata.get("approved_at")
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=UTC)
    if isinstance(raw, str):
        return _parse_iso(raw)
    return None


def _apply_frontmatter(
    session: Session,
    note: NoteOrigin,
    metadata: dict[str, Any],
) -> None:
    """Rewrite origin fields and (vault_id, note_path) source rows in place."""
    origin = metadata.get("origin")
    note.origin = origin if isinstance(origin, str) else None

    origin_ref = metadata.get("origin_ref")
    note.origin_ref = origin_ref if isinstance(origin_ref, str) else None

    approved = _normalise_approved_at(metadata)
    if approved is not None:
        note.approved_at = approved

    note.last_synced_at = datetime.now(UTC)

    wanted = set(_normalise_source_ids(metadata))
    existing_rows = (
        session.query(NoteOriginSource)
        .filter(
            NoteOriginSource.vault_id == note.vault_id,
            NoteOriginSource.note_path == note.note_path,
        )
        .all()
    )
    existing = {r.source_file_id for r in existing_rows}

    for row in existing_rows:
        if row.source_file_id not in wanted:
            session.delete(row)
    for sid in wanted - existing:
        session.add(
            NoteOriginSource(
                vault_id=note.vault_id,
                note_path=note.note_path,
                source_file_id=sid,
            )
        )


async def _reconcile_one(
    client: InternalClient, note_info: tuple[int, str, str, datetime | None]
) -> tuple[bool, bool]:
    """Return (updated, errored). Called outside any DB session."""
    vault_id, note_path, note_file_id, last_synced_at = note_info

    try:
        info = await client.get_file(note_file_id)
    except InternalAPIError as exc:
        if exc.status_code == 404:
            # The .md disappeared from core's active index. Purged/missing
            # webhooks already handle the corresponding relation cleanup;
            # leave this pass alone rather than racing them.
            return False, False
        logger.warning(
            "note scan: get_file failed vault=%s path=%s: %s",
            vault_id,
            note_path,
            exc,
        )
        return False, True

    updated_at = _parse_iso(info.get("updated_at"))
    if updated_at is None:
        # Core returned no timestamp — nothing we can compare. Skip.
        return False, False

    # Both timestamps are UTC by construction. SQLite strips tzinfo on
    # store, and core's DateTime column is tz-naive — so either side
    # can arrive tz-naive even when the other is tz-aware. Normalise
    # both before comparison to avoid TypeError.
    updated_at = _assume_utc(updated_at)
    if last_synced_at is not None:
        baseline = _assume_utc(last_synced_at)
        if updated_at <= baseline:
            return False, False

    try:
        content = await client.get_file_content(note_file_id)
    except InternalAPIError as exc:
        logger.warning(
            "note scan: content fetch failed vault=%s path=%s: %s",
            vault_id,
            note_path,
            exc,
        )
        return False, True

    parsed = parse_frontmatter(content)

    with session_scope() as session:
        note = (
            session.query(NoteOrigin)
            .filter(
                NoteOrigin.vault_id == vault_id,
                NoteOrigin.note_path == note_path,
            )
            .first()
        )
        if note is None:
            # Raced with a purge/delete between the list and this update.
            return False, False
        _apply_frontmatter(session, note, parsed.metadata)
    return True, False


async def reconcile_once(
    client: InternalClient | None = None,
) -> ReconcileStats:
    """Run one full pass over every ``note_origins`` row.

    Safe to call concurrently with webhook handlers — each row update
    happens in its own short-lived session. Returns a stats tuple for
    logging and tests.
    """
    client = client or InternalClient()

    with session_scope() as session:
        rows = (
            session.query(
                NoteOrigin.vault_id,
                NoteOrigin.note_path,
                NoteOrigin.note_file_id,
                NoteOrigin.last_synced_at,
            ).all()
        )
        notes = [(r[0], r[1], r[2], r[3]) for r in rows]

    updated = 0
    errors = 0
    for info in notes:
        did_update, errored = await _reconcile_one(client, info)
        if did_update:
            updated += 1
        if errored:
            errors += 1

    return ReconcileStats(scanned=len(notes), updated=updated, errors=errors)


async def scanner_loop(
    interval_seconds: int = _DEFAULT_INTERVAL_SECONDS,
) -> None:
    """Long-lived background task: reconcile on boot, then every hour.

    Cancelled from the FastAPI lifespan shutdown. Each iteration catches
    and logs exceptions so a transient core outage never crashes the
    loop.
    """
    while True:
        try:
            stats = await reconcile_once()
            logger.info(
                "note scanner: scanned=%d updated=%d errors=%d",
                stats.scanned,
                stats.updated,
                stats.errors,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("note scanner iteration failed")
        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            raise
