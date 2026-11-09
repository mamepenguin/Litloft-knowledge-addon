"""Declare Ask notes that core has never accepted as unverified.

A note saved while core was unreachable, or saved before the save route
declared anything, keeps ``trust_declared_at`` NULL. One pass at startup
declares each of those rows once. A row core still rejects keeps its NULL and
is retried at the next start; that is deliberate for a note in the trash or
purged, which answers 404 every time.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import httpx

from app.database import session_scope
from app.internal_client import InternalAPIError, InternalClient
from app.models import NoteOrigin

logger = logging.getLogger(__name__)

#: The tier an Ask answer lands with, declared by the save route and the
#: startup pass. The model wrote the answer, so it must not ground a later
#: Ask answer until the viewer vouches for it.
ASK_INGEST_TIER = "unverified"


def _mark_declared(drive: str, note_path: str) -> None:
    with session_scope() as session:
        session.query(NoteOrigin).filter(
            NoteOrigin.drive == drive,
            NoteOrigin.note_path == note_path,
            NoteOrigin.trust_declared_at.is_(None),
        ).update(
            {NoteOrigin.trust_declared_at: datetime.now(UTC)},
            synchronize_session=False,
        )


async def declare_pending_ask_notes(client: InternalClient | None = None) -> None:
    """Declare every undeclared ``ask_answer`` note, one call each.

    Uses the no-credential client the scanner uses: the declaration
    authenticates with ``CORE_INTERNAL_SECRET``, not a viewer's cookie.
    """
    client = client or InternalClient()

    with session_scope() as session:
        rows = [
            (row.drive, row.note_path, row.note_file_id)
            for row in session.query(
                NoteOrigin.drive, NoteOrigin.note_path, NoteOrigin.note_file_id
            ).filter(
                NoteOrigin.origin == "ask_answer",
                NoteOrigin.trust_declared_at.is_(None),
            )
        ]

    declared = 0
    failed = 0
    for drive, note_path, note_file_id in rows:
        try:
            await client.declare_trust_tier(note_file_id, ASK_INGEST_TIER)
        except InternalAPIError as exc:
            if exc.status_code != 409:
                failed += 1
                if exc.status_code == 404:
                    logger.debug(
                        "trust declaration skipped file_id=%s status=404",
                        note_file_id,
                    )
                else:
                    logger.warning(
                        "trust declaration failed file_id=%s status=%d",
                        note_file_id,
                        exc.status_code,
                    )
                continue
        except httpx.HTTPError as exc:
            failed += 1
            logger.warning(
                "trust declaration failed file_id=%s error=%s",
                note_file_id,
                type(exc).__name__,
            )
            continue

        _mark_declared(drive, note_path)
        declared += 1

    logger.info("trust declaration: declared=%d failed=%d", declared, failed)
