"""Vault CRUD endpoints — drive-scoped.

Every request carries drive context via the ``X-Lit-Drive`` header, set
by the core addon_proxy when the request arrives through
``/drive/{drive}/addons/knowledge/...``. We treat the header as the
authoritative drive: Vault listing, activation, and mutations are
filtered to that drive.

viewer_id still comes from the ``lit_viewer`` cookie. Active-vault state
is keyed by ``(viewer_id, drive)`` so each drive remembers its own
active Vault independently.

Drive accessibility on create is validated via the Litloft Internal
API (defense in depth — the proxy already enforces drive access before
forwarding, but we re-check for requests that bypass the proxy in
tests / internal callers).
"""
import logging
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_viewer_id
from app.database import get_db
from app.internal_client import InternalAPIError, InternalClient
from app.models import UserVault, UserVaultState
from app.schemas import VaultCreate, VaultListResponse, VaultOut, VaultUpdate
from app.services.safepath import validate_relative_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vaults", tags=["vaults"])


def _vault_to_out(v: UserVault, active_id: int | None) -> VaultOut:
    return VaultOut(
        id=v.id,
        label=v.label,
        drive=v.drive,
        path=v.path,
        is_active=(v.id == active_id),
        created_at=v.created_at,
    )


def _active_id_for(db: Session, viewer_id: str, drive: str) -> int | None:
    state = (
        db.query(UserVaultState)
        .filter_by(viewer_id=viewer_id, drive=drive)
        .first()
    )
    return state.active_vault_id if state else None


def _require_drive(drive: str | None) -> str:
    """Reject requests that arrived without the drive context header.

    The header value is percent-encoded by the frontend so non-ASCII
    drive names round-trip through HTTP (header values must be
    ISO-8859-1). Decode here once so all downstream code sees the
    canonical drive name.
    """
    if not drive:
        raise HTTPException(
            status_code=400, detail="Drive context required"
        )
    return unquote(drive)


async def _validate_drive_access(cookie: str | None, drive: str) -> None:
    client = InternalClient(cookie_header=cookie)
    try:
        drives = await client.accessible_drives()
    except InternalAPIError as e:
        logger.warning("Internal API error during drive check: %s", e)
        raise HTTPException(status_code=502, detail="Upstream auth check failed")
    if drive not in drives:
        raise HTTPException(
            status_code=403, detail=f"Drive '{drive}' not accessible"
        )


def _get_owned_vault_in_drive_or_404(
    db: Session, vault_id: int, viewer_id: str, drive: str
) -> UserVault:
    vault = (
        db.query(UserVault)
        .filter(
            UserVault.id == vault_id,
            UserVault.viewer_id == viewer_id,
            UserVault.drive == drive,
        )
        .first()
    )
    if vault is None:
        raise HTTPException(status_code=404, detail="Vault not found")
    return vault


@router.get("", response_model=VaultListResponse)
async def list_vaults(
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
):
    drive = _require_drive(x_hv_drive)
    vaults = (
        db.query(UserVault)
        .filter(UserVault.viewer_id == viewer_id, UserVault.drive == drive)
        .order_by(UserVault.created_at.asc())
        .all()
    )
    active_id = _active_id_for(db, viewer_id, drive)
    return VaultListResponse(
        vaults=[_vault_to_out(v, active_id) for v in vaults],
        active_vault_id=active_id,
    )


@router.post("", response_model=VaultOut, status_code=201)
async def create_vault(
    body: VaultCreate,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    cookie: Annotated[str | None, Header(alias="Cookie")] = None,
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
):
    drive = _require_drive(x_hv_drive)

    # The body.drive must match the header-supplied drive context. We
    # refuse rather than silently overwriting so a buggy client surfaces
    # the mismatch.
    if body.drive != drive:
        raise HTTPException(
            status_code=403,
            detail="Vault drive does not match request drive context",
        )

    validate_relative_path(body.path)
    await _validate_drive_access(cookie, drive)

    vault = UserVault(
        viewer_id=viewer_id,
        label=body.label.strip(),
        drive=drive,
        path=body.path.strip(),
    )
    db.add(vault)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A Vault at this location already exists",
        )
    db.refresh(vault)

    # Auto-activate when this is the user's first Vault in this drive
    state = (
        db.query(UserVaultState)
        .filter_by(viewer_id=viewer_id, drive=drive)
        .first()
    )
    if state is None:
        db.add(
            UserVaultState(
                viewer_id=viewer_id,
                drive=drive,
                active_vault_id=vault.id,
            )
        )
        db.commit()

    return _vault_to_out(vault, _active_id_for(db, viewer_id, drive))


@router.put("/{vault_id}", response_model=VaultOut)
async def update_vault(
    vault_id: int,
    body: VaultUpdate,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
):
    drive = _require_drive(x_hv_drive)
    vault = _get_owned_vault_in_drive_or_404(db, vault_id, viewer_id, drive)
    vault.label = body.label.strip()
    db.commit()
    db.refresh(vault)
    return _vault_to_out(vault, _active_id_for(db, viewer_id, drive))


@router.delete("/{vault_id}", status_code=204)
async def delete_vault(
    vault_id: int,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
):
    drive = _require_drive(x_hv_drive)
    vault = _get_owned_vault_in_drive_or_404(db, vault_id, viewer_id, drive)
    db.delete(vault)  # CASCADE clears user_vault_state if this was active
    db.commit()
    return None


@router.post("/{vault_id}/activate", response_model=VaultOut)
async def activate_vault(
    vault_id: int,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
    x_hv_drive: Annotated[str | None, Header(alias="X-Lit-Drive")] = None,
):
    drive = _require_drive(x_hv_drive)
    vault = _get_owned_vault_in_drive_or_404(db, vault_id, viewer_id, drive)

    state = (
        db.query(UserVaultState)
        .filter_by(viewer_id=viewer_id, drive=drive)
        .first()
    )
    if state is None:
        db.add(
            UserVaultState(
                viewer_id=viewer_id,
                drive=drive,
                active_vault_id=vault.id,
            )
        )
    else:
        state.active_vault_id = vault.id
    db.commit()
    return _vault_to_out(vault, vault.id)
