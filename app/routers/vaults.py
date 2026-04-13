"""Vault CRUD endpoints.

All routes are scoped to the caller's viewer_id. The core's Generic Addon
Proxy injects no server-side identity beyond forwarding the client's
cookies, so viewer_id here comes from ``hv_viewer`` via
``get_viewer_id``. Clients cannot override it — the dependency ignores
any viewer_id query / body fields.

Drive accessibility is validated on create via the HomeVault Internal
API so that users cannot register a Vault on a drive they cannot see.
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException
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


def _active_id_for(db: Session, viewer_id: str) -> int | None:
    state = db.query(UserVaultState).filter_by(viewer_id=viewer_id).first()
    return state.active_vault_id if state else None


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


@router.get("", response_model=VaultListResponse)
async def list_vaults(
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
):
    vaults = (
        db.query(UserVault)
        .filter(UserVault.viewer_id == viewer_id)
        .order_by(UserVault.created_at.asc())
        .all()
    )
    active_id = _active_id_for(db, viewer_id)
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
):
    # Structural path validation
    validate_relative_path(body.path)

    # Drive must be visible to the caller (per viewer's token/unlocks)
    await _validate_drive_access(cookie, body.drive)

    vault = UserVault(
        viewer_id=viewer_id,
        label=body.label.strip(),
        drive=body.drive,
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

    # Auto-activate when this is the user's first Vault
    state = db.query(UserVaultState).filter_by(viewer_id=viewer_id).first()
    if state is None:
        db.add(UserVaultState(viewer_id=viewer_id, active_vault_id=vault.id))
        db.commit()

    return _vault_to_out(vault, _active_id_for(db, viewer_id))


@router.put("/{vault_id}", response_model=VaultOut)
async def update_vault(
    vault_id: int,
    body: VaultUpdate,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
):
    vault = _get_owned_vault_or_404(db, vault_id, viewer_id)
    vault.label = body.label.strip()
    db.commit()
    db.refresh(vault)
    return _vault_to_out(vault, _active_id_for(db, viewer_id))


@router.delete("/{vault_id}", status_code=204)
async def delete_vault(
    vault_id: int,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
):
    vault = _get_owned_vault_or_404(db, vault_id, viewer_id)
    db.delete(vault)  # CASCADE clears user_vault_state if this was active
    db.commit()
    return None


@router.post("/{vault_id}/activate", response_model=VaultOut)
async def activate_vault(
    vault_id: int,
    db: Annotated[Session, Depends(get_db)],
    viewer_id: Annotated[str, Depends(get_viewer_id)],
):
    vault = _get_owned_vault_or_404(db, vault_id, viewer_id)

    state = db.query(UserVaultState).filter_by(viewer_id=viewer_id).first()
    if state is None:
        db.add(UserVaultState(viewer_id=viewer_id, active_vault_id=vault.id))
    else:
        state.active_vault_id = vault.id
    db.commit()
    return _vault_to_out(vault, vault.id)


def _get_owned_vault_or_404(
    db: Session, vault_id: int, viewer_id: str
) -> UserVault:
    vault = (
        db.query(UserVault)
        .filter(UserVault.id == vault_id, UserVault.viewer_id == viewer_id)
        .first()
    )
    if vault is None:
        raise HTTPException(status_code=404, detail="Vault not found")
    return vault
