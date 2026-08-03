"""Viewer identification for knowledge.

The knowledge addon does not run its own authentication. It trusts the
host proxy's ``X-Lit-Viewer-Id`` header, which is computed from the
caller's profile nickname by core. The addon never reads the plaintext
nickname cookie directly.
"""
import os

from fastapi import Header, HTTPException

_WEBHOOK_SECRET = os.environ.get("KNOWLEDGE_WEBHOOK_SECRET", "")


def get_optional_viewer_id(
    x_lit_viewer_id: str | None = Header(default=None, alias="X-Lit-Viewer-Id"),
) -> str | None:
    if not x_lit_viewer_id or not x_lit_viewer_id.strip():
        return None
    viewer_id = x_lit_viewer_id.strip()
    if len(viewer_id) != 16:
        return None
    return viewer_id


def get_viewer_id(
    x_lit_viewer_id: str | None = Header(default=None, alias="X-Lit-Viewer-Id"),
) -> str:
    """Require a valid viewer_id; raise 401 otherwise."""
    vid = get_optional_viewer_id(x_lit_viewer_id)
    if vid is None:
        raise HTTPException(
            status_code=401,
            detail="Profile (nickname) not set — knowledge requires a profile",
        )
    return vid


async def verify_webhook_secret(
    x_webhook_secret: str = Header(default=""),
) -> None:
    """Gate webhook endpoints behind the shared-secret header.

    When ``KNOWLEDGE_WEBHOOK_SECRET`` is unset the gate is a no-op, which
    matches the intelligence addon's lenient default for development
    environments. In production deployments the core should set the same
    secret in its ``event-hooks.json`` listener entry so that only the
    core process can trigger these endpoints.
    """
    if _WEBHOOK_SECRET and x_webhook_secret != _WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid webhook secret")
