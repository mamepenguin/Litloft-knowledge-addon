"""ORM models for the knowledge addon.

Three tables:
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
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, func
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
