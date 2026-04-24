"""ORM models for the knowledge addon.

Five tables:
- ``user_vaults``        — one row per (viewer_id, drive, path). Labels
                           are user-facing; drive+path is the source of
                           truth for where notes live.
- ``user_vault_state``   — at most one row per (viewer_id, drive),
                           pointing to the currently-active Vault for
                           that drive. Composite PK enforces the
                           "exactly one active Vault per (user, drive)"
                           invariant. Cross-drive isolation means
                           switching drives never leaks the other
                           drive's active selection.
- ``clip_jobs``          — per-file webclip ingestion state. Used to
                           recover in-flight jobs after a restart and to
                           gate editing while a clip is fetching.
- ``note_origins``       — per-note metadata mirrored from frontmatter.
                           Populated by /distill and refreshed by the
                           frontmatter scanner. The ``.md`` file itself
                           is the source of truth; this table is a
                           queryable cache.
- ``note_origin_sources`` — many-to-many between notes and their source
                           File rows in core. Normalised so the reverse
                           lookup (``by_source_file``) is an index hit
                           even when a note lists multiple sources
                           (future multi-file summaries).
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class UserVault(Base):
    __tablename__ = "user_vaults"
    __table_args__ = (UniqueConstraint("viewer_id", "drive", "path", name="uq_vault_location"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    viewer_id: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    drive: Mapped[str] = mapped_column(String(128), nullable=False)
    path: Mapped[str] = mapped_column(String(4096), nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class UserVaultState(Base):
    __tablename__ = "user_vault_state"

    viewer_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    drive: Mapped[str] = mapped_column(String(128), primary_key=True)
    active_vault_id: Mapped[int] = mapped_column(
        ForeignKey("user_vaults.id", ondelete="CASCADE"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    active_vault: Mapped["UserVault"] = relationship("UserVault")


class ClipJob(Base):
    __tablename__ = "clip_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_id: Mapped[str] = mapped_column(String(12), nullable=False, unique=True)
    viewer_id: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(4096), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="fetching")
    # fetching | ready | failed
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lease_until: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    error: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class NoteOrigin(Base):
    """Mirror of a Vault ``.md`` note's frontmatter.

    ``(vault_id, note_path)`` is the PK so a rename or move invalidates
    the row naturally. The frontmatter scanner refreshes ``last_synced_at``
    whenever it reconciles the cache against file mtime.
    """

    __tablename__ = "note_origins"

    vault_id: Mapped[int] = mapped_column(
        ForeignKey("user_vaults.id", ondelete="CASCADE"),
        primary_key=True,
    )
    note_path: Mapped[str] = mapped_column(String(4096), primary_key=True)
    # Cached core ``File.id`` of this .md. ``file_id`` is stable across
    # path renames in core, so storing it avoids a per-lookup Internal
    # API hop. The scanner (Step C) refreshes this when the .md moves
    # between Vault subfolders and updates note_path alongside.
    note_file_id: Mapped[str] = mapped_column(String(12), nullable=False)
    origin: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    # Carries the frontmatter ``created`` value (spec 2026-04-24 renamed
    # the frontmatter key from ``approved_at`` to ``created``, but the DB
    # column is kept to avoid a second rebuild migration — note_scanner
    # writes the ``created`` value here).
    approved_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    health: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="healthy",
    )
    last_synced_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    sources: Mapped[list["NoteOriginSource"]] = relationship(
        "NoteOriginSource",
        cascade="all, delete-orphan",
        back_populates="origin_row",
    )


class NoteOriginSource(Base):
    """Each row links one note to one source file (core ``File.id``).

    Indexed on ``source_file_id`` for the reverse-lookup API. Current
    detailed_summary promotion writes exactly one row per distill, but
    future multi-file summaries can INSERT multiple rows per note.
    """

    __tablename__ = "note_origin_sources"
    __table_args__ = (
        ForeignKeyConstraint(
            ["vault_id", "note_path"],
            ["note_origins.vault_id", "note_origins.note_path"],
            ondelete="CASCADE",
        ),
    )

    vault_id: Mapped[int] = mapped_column(primary_key=True)
    note_path: Mapped[str] = mapped_column(String(4096), primary_key=True)
    source_file_id: Mapped[str] = mapped_column(
        String(12), primary_key=True, index=True
    )

    origin_row: Mapped["NoteOrigin"] = relationship(
        "NoteOrigin",
        back_populates="sources",
    )
