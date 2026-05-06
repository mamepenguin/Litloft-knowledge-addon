"""Lifecycle webhook handlers for note_origins.health reconciliation.

The core process fires ``files.missing``, ``files.recovered``, and
``files.purged`` events via ``event-hooks.json``. We subscribe to them
and keep ``NoteOrigin.health`` in sync with the state of each note's
source files:

* ``healthy``   — every source is ``active``
* ``degraded``  — at least one source is ``missing`` or ``trash``
* ``orphaned``  — every remaining source has been purged (note has no
                  source files left)

Cross-DB note: ``note_origin_sources.source_file_id`` references a row
in the core ``files`` table but lives in knowledge's own SQLite, so the
core's ``ON DELETE CASCADE`` does not fire here. The purge handler
deletes matching rows explicitly so the rollup reflects reality.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import session_scope
from app.internal_client import InternalAPIError, InternalClient
from app.models import ClipJob, FileActiveSummary, NoteOrigin, NoteOriginSource

logger = logging.getLogger(__name__)


HEALTH_HEALTHY = "healthy"
HEALTH_DEGRADED = "degraded"
HEALTH_ORPHANED = "orphaned"


@dataclass
class _NoteKey:
    vault_id: int
    note_path: str

    def as_tuple(self) -> tuple[int, str]:
        return (self.vault_id, self.note_path)


def _load_affected_notes(
    session: Session, source_file_ids: list[str]
) -> list[_NoteKey]:
    """Return every (vault_id, note_path) that references any of the IDs."""
    if not source_file_ids:
        return []
    rows = session.execute(
        select(NoteOriginSource.vault_id, NoteOriginSource.note_path)
        .where(NoteOriginSource.source_file_id.in_(source_file_ids))
        .distinct()
    ).all()
    return [_NoteKey(vault_id=r[0], note_path=r[1]) for r in rows]


def _sources_for_notes(
    session: Session, notes: list[_NoteKey]
) -> dict[tuple[int, str], list[str]]:
    if not notes:
        return {}
    keys = [n.as_tuple() for n in notes]
    from sqlalchemy import tuple_ as sql_tuple

    rows = session.execute(
        select(
            NoteOriginSource.vault_id,
            NoteOriginSource.note_path,
            NoteOriginSource.source_file_id,
        ).where(
            sql_tuple(
                NoteOriginSource.vault_id, NoteOriginSource.note_path
            ).in_(keys)
        )
    ).all()
    by_note: dict[tuple[int, str], list[str]] = {}
    for vid, path, fid in rows:
        by_note.setdefault((vid, path), []).append(fid)
    return by_note


def _classify_health(states: list[str]) -> str:
    """Pick the health value given a note's remaining source states.

    ``states`` contains one entry per remaining source file. Missing
    entries (purged) should be omitted before calling this — they are
    represented by absence, not by a state value. An empty list means
    the note has no surviving sources and is ``orphaned``.
    """
    if not states:
        return HEALTH_ORPHANED
    if any(s in ("missing", "trash") for s in states):
        return HEALTH_DEGRADED
    return HEALTH_HEALTHY


def _update_health(
    session: Session,
    notes_with_target: list[tuple[_NoteKey, str]],
) -> int:
    """Apply a batch of (note, new_health) updates. Returns rows touched."""
    if not notes_with_target:
        return 0
    now = datetime.now(UTC)
    touched = 0
    for note, target in notes_with_target:
        result = (
            session.query(NoteOrigin)
            .filter(
                NoteOrigin.vault_id == note.vault_id,
                NoteOrigin.note_path == note.note_path,
            )
            .update(
                {NoteOrigin.health: target, NoteOrigin.last_synced_at: now},
                synchronize_session=False,
            )
        )
        touched += int(result or 0)
    return touched


async def _resolve_source_states(
    client: InternalClient, source_ids: list[str]
) -> dict[str, str]:
    """Call core's bulk-state API and flatten the response.

    Returned dict maps ``file_id → state``. IDs in ``not_found`` are
    treated as purged and **omitted** from the dict so callers use the
    "missing entry = no longer a source" convention.
    """
    if not source_ids:
        return {}
    try:
        envelope = await client.fetch_bulk_state(source_ids)
    except InternalAPIError as exc:
        logger.warning("bulk-state lookup failed: %s", exc)
        return {}
    return {row["id"]: row["state"] for row in envelope.get("statuses", [])}


async def handle_files_missing(file_ids: list[str]) -> int:
    """Mark every note touching any of these files as degraded.

    We don't bother re-reading the other sources: once a single source
    is missing the note is degraded regardless, so the cheap path is to
    set degraded unconditionally.
    """
    if not file_ids:
        return 0
    with session_scope() as session:
        notes = _load_affected_notes(session, file_ids)
        if not notes:
            return 0
        return _update_health(
            session, [(note, HEALTH_DEGRADED) for note in notes]
        )


async def handle_files_recovered(file_ids: list[str]) -> int:
    """Re-roll up health for each affected note.

    A note that had one source missing returns to healthy only when all
    its sources are active again, so we have to ask the core.
    """
    if not file_ids:
        return 0
    with session_scope() as session:
        notes = _load_affected_notes(session, file_ids)
        if not notes:
            return 0
        sources_by_note = _sources_for_notes(session, notes)
        all_sources = sorted(
            {sid for ids in sources_by_note.values() for sid in ids}
        )

    client = InternalClient()
    state_by_id = await _resolve_source_states(client, all_sources)

    with session_scope() as session:
        # Reload in the new session — session_scope scopes commits, and
        # we want fresh rows in case anything moved since the lookup.
        sources_by_note = _sources_for_notes(session, notes)
        updates: list[tuple[_NoteKey, str]] = []
        for note in notes:
            source_ids = sources_by_note.get(note.as_tuple(), [])
            states = [
                state_by_id[sid] for sid in source_ids if sid in state_by_id
            ]
            updates.append((note, _classify_health(states)))
        return _update_health(session, updates)


async def handle_files_purged(file_ids: list[str]) -> int:
    """Delete the links for purged files and re-roll up health.

    Purge is terminal — the ``note_origin_sources`` rows for these
    ``source_file_id``s must go away (core cascade does not reach us).
    After deletion each affected note is either orphaned (no sources
    left) or re-evaluated against whatever remains.

    The same purge also clears any ``FileActiveSummary`` pointer that
    references one of these file_ids on either side (target or summary
    note). The pointer is cross-DB so core's ON DELETE CASCADE doesn't
    reach us — same reason as ``note_origin_sources``.
    """
    if not file_ids:
        return 0
    with session_scope() as session:
        notes = _load_affected_notes(session, file_ids)

        session.query(NoteOriginSource).filter(
            NoteOriginSource.source_file_id.in_(file_ids)
        ).delete(synchronize_session=False)

        # Drop active-summary pointers that name any purged file on
        # either side. The pointer is meaningless once either end is
        # gone; we don't try to be smart about partial states.
        session.query(FileActiveSummary).filter(
            (FileActiveSummary.target_file_id.in_(file_ids))
            | (FileActiveSummary.summary_note_id.in_(file_ids))
        ).delete(synchronize_session=False)

        # Drop clip jobs whose file has been purged. ClipJob lives in
        # knowledge's own SQLite so core's ON DELETE CASCADE doesn't
        # reach here; purge is the only point where the job must go.
        session.query(ClipJob).filter(
            ClipJob.file_id.in_(file_ids)
        ).delete(synchronize_session=False)

        if not notes:
            return 0

        sources_by_note = _sources_for_notes(session, notes)
        remaining_sources = sorted(
            {sid for ids in sources_by_note.values() for sid in ids}
        )

    client = InternalClient()
    state_by_id = await _resolve_source_states(client, remaining_sources)

    with session_scope() as session:
        sources_by_note = _sources_for_notes(session, notes)
        updates: list[tuple[_NoteKey, str]] = []
        for note in notes:
            source_ids = sources_by_note.get(note.as_tuple(), [])
            states = [
                state_by_id[sid] for sid in source_ids if sid in state_by_id
            ]
            updates.append((note, _classify_health(states)))
        return _update_health(session, updates)
