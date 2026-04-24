"""Periodic reconciliation of ``note_origins`` against Vault ``.md`` files.

The scanner asks core's Internal API for each note's current
``updated_at`` timestamp. When it's newer than the row's
``last_synced_at`` we re-fetch the file content, re-parse its
frontmatter, and refresh the origin + source rows accordingly. This
keeps external edits (users opening the ``.md`` in Obsidian and
tweaking ``source_file_ids`` etc.) from drifting our cache.

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
import re
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
    # 403/404 from core's gated content endpoint — separated from
    # ``errors`` so genuine faults stay visible. Protected-drive reads
    # fail here when ``CORE_INTERNAL_SECRET`` is unset (or misaligned)
    # and the scanner has no cookie; webhook-driven health reconcile
    # still works because that path uses the non-gated bulk-state route.
    protected_errors: int = 0
    # Count of notes whose frontmatter ``tags:`` were successfully
    # projected to core ``File.tags`` on this pass. Separate from
    # ``updated`` because a single note can trigger either or both
    # (frontmatter metadata + tags), and debugging migration issues is
    # easier when the two are distinguishable.
    tags_projected: int = 0


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


# Mirror the core TagUpdate validator (backend/app/schemas.py::TagUpdate)
# so we reject tags here rather than round-tripping them to the API just
# to receive a 422. Keep the regex and length caps in sync if core changes.
_TAG_RE = re.compile(r"^[\w\-]+$", re.UNICODE)
_MAX_TAGS = 10
_MAX_TAG_LEN = 30


def _normalise_tags(metadata: dict[str, Any]) -> list[str]:
    """Extract a list of core-valid tag names from frontmatter.

    Silently drops non-string entries, invalid names (spaces, punctuation,
    empty after strip), over-length strings, and deduplicates case-
    insensitively keeping the first occurrence. Returns an empty list
    when the ``tags`` key is absent or not a list — an empty list
    clears ``File.tags`` per the β canonical rule (spec §D1).
    """
    raw = metadata.get("tags")
    if not isinstance(raw, list):
        return []
    seen: dict[str, str] = {}
    for item in raw:
        if not isinstance(item, str):
            continue
        name = item.strip()
        if not name or len(name) > _MAX_TAG_LEN:
            continue
        if not _TAG_RE.match(name):
            continue
        key = name.lower()
        if key not in seen:
            seen[key] = name
        if len(seen) >= _MAX_TAGS:
            break
    return list(seen.values())


def _extract_created(metadata: dict[str, Any]) -> datetime | None:
    """Read the ``created`` timestamp, falling back to legacy keys.

    Spec 2026-04-24 renamed webclip's ``clipped_at`` and distill's
    ``approved_at`` to a unified ``created``. Older ``.md`` files on
    disk still use the legacy names — read them as fallback so existing
    Vaults don't break. New writes always use ``created``.
    """
    for key in ("created", "approved_at", "clipped_at"):
        raw = metadata.get(key)
        if isinstance(raw, datetime):
            return raw if raw.tzinfo else raw.replace(tzinfo=UTC)
        if isinstance(raw, str):
            parsed = _parse_iso(raw)
            if parsed is not None:
                return parsed
    return None


def _apply_frontmatter(
    session: Session,
    note: NoteOrigin,
    metadata: dict[str, Any],
) -> None:
    """Rewrite origin fields and (vault_id, note_path) source rows in place."""
    origin = metadata.get("origin")
    note.origin = origin if isinstance(origin, str) else None

    # ``approved_at`` column stores the latest ``created`` value (see
    # models.py — the column name is kept for backward compat).
    created = _extract_created(metadata)
    if created is not None:
        note.approved_at = created

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
    client: InternalClient,
    note_info: tuple[int, str, str, datetime | None, datetime | None],
) -> tuple[bool, bool, bool, bool]:
    """Return ``(updated, errored, protected, tags_projected)``.

    - ``updated``: frontmatter was re-applied to ``note_origins``.
    - ``errored``: genuine failure worth investigating (network, 5xx,
      malformed response). Increments ``errors``.
    - ``protected``: core returned 403/404 from the gated content
      endpoint — a configuration signal, not a code bug. Increments
      ``protected_errors`` so it stays visible without drowning real
      issues. A 403 here typically means ``CORE_INTERNAL_SECRET`` is
      misaligned; 404 here means the row vanished between get_file and
      the content call (webhook racing the scanner).
    - ``tags_projected``: frontmatter ``tags:`` were successfully pushed
      to core ``File.tags``. Bumped independently of ``updated`` so
      migration debugging (spec §D8) can distinguish "fetched content
      but tags projection failed" from "fetched nothing".
    """
    vault_id, note_path, note_file_id, last_synced_at, tags_synced_at = note_info

    try:
        info = await client.get_file(note_file_id)
    except InternalAPIError as exc:
        if exc.status_code == 404:
            # The .md disappeared from core's active index. Purged/missing
            # webhooks already handle the corresponding relation cleanup;
            # leave this pass alone rather than racing them.
            return False, False, False, False
        logger.warning(
            "note scan: get_file failed vault=%s path=%s: %s",
            vault_id,
            note_path,
            exc,
        )
        return False, True, False, False

    updated_at = _parse_iso(info.get("updated_at"))
    if updated_at is None:
        # Core returned no timestamp — nothing we can compare. Skip.
        return False, False, False, False

    # Both timestamps are UTC by construction. SQLite strips tzinfo on
    # store, and core's DateTime column is tz-naive — so either side
    # can arrive tz-naive even when the other is tz-aware. Normalise
    # both before comparison to avoid TypeError.
    updated_at = _assume_utc(updated_at)
    metadata_stale = last_synced_at is None
    if last_synced_at is not None:
        baseline = _assume_utc(last_synced_at)
        metadata_stale = updated_at > baseline

    # tags_synced_at IS NULL ⇒ Phase 2 migration hasn't projected this
    # note yet. Force a content fetch even if metadata is current so
    # the first post-deploy scan syncs every existing row (spec §D8).
    tags_missing = tags_synced_at is None

    if not metadata_stale and not tags_missing:
        return False, False, False, False

    try:
        content = await client.get_file_text_content(note_file_id)
    except InternalAPIError as exc:
        if exc.status_code in (403, 404):
            logger.warning(
                "note scan: content denied vault=%s path=%s status=%d (check CORE_INTERNAL_SECRET)",
                vault_id,
                note_path,
                exc.status_code,
            )
            return False, False, True, False
        logger.warning(
            "note scan: content fetch failed vault=%s path=%s: %s",
            vault_id,
            note_path,
            exc,
        )
        return False, True, False, False

    parsed = parse_frontmatter(content)

    # Project tags before touching the DB so a projection failure
    # doesn't leave note_origins ahead of core. Best-effort: tag errors
    # are logged but don't block frontmatter sync — the scanner will
    # retry on the next pass via tags_synced_at still NULL.
    tags = _normalise_tags(parsed.metadata)
    tags_ok = False
    try:
        await client.sync_core_tags(note_file_id, tags)
        tags_ok = True
    except InternalAPIError as exc:
        logger.warning(
            "note scan: tags sync failed vault=%s path=%s file=%s status=%d: %s",
            vault_id,
            note_path,
            note_file_id,
            exc.status_code,
            exc.detail,
        )

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
            return False, False, False, tags_ok
        if metadata_stale:
            _apply_frontmatter(session, note, parsed.metadata)
        if tags_ok:
            note.tags_synced_at = datetime.now(UTC)
    return metadata_stale, False, False, tags_ok


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
                NoteOrigin.tags_synced_at,
            ).all()
        )
        notes = [(r[0], r[1], r[2], r[3], r[4]) for r in rows]

    updated = 0
    errors = 0
    protected_errors = 0
    tags_projected = 0
    for info in notes:
        did_update, errored, protected, tags_ok = await _reconcile_one(client, info)
        if did_update:
            updated += 1
        if errored:
            errors += 1
        if protected:
            protected_errors += 1
        if tags_ok:
            tags_projected += 1

    return ReconcileStats(
        scanned=len(notes),
        updated=updated,
        errors=errors,
        protected_errors=protected_errors,
        tags_projected=tags_projected,
    )


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
                "note scanner: scanned=%d updated=%d tags_projected=%d errors=%d protected_errors=%d",
                stats.scanned,
                stats.updated,
                stats.tags_projected,
                stats.errors,
                stats.protected_errors,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("note scanner iteration failed")
        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            raise
