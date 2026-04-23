"""Viewer identification for knowledge.

The knowledge addon does not run its own authentication — it trusts the
``lit_viewer`` cookie forwarded by the Generic Addon Proxy. A null or
empty cookie means the user hasn't set a profile yet and must be shown
the "please set a nickname" bootstrap UI before they can use Vaults.

Hash algorithm mirrors Litloft core's ``nickname_to_viewer_id`` so that
the same person gets the same viewer_id across core and addon — this is
what makes per-user Vault scoping join correctly with the core's
watch-history-style identifiers, should we ever cross-reference.
"""
import hashlib
import os

from fastapi import Cookie, Header, HTTPException

_WEBHOOK_SECRET = os.environ.get("KNOWLEDGE_WEBHOOK_SECRET", "")


def nickname_to_viewer_id(nickname: str) -> str:
    return hashlib.sha256(nickname.strip().encode("utf-8")).hexdigest()[:16]


def get_optional_viewer_id(
    lit_viewer: str | None = Cookie(default=None),
) -> str | None:
    if not lit_viewer or not lit_viewer.strip():
        return None
    trimmed = lit_viewer.strip()
    if len(trimmed) > 50:
        return None
    return nickname_to_viewer_id(trimmed)


def get_viewer_id(
    lit_viewer: str | None = Cookie(default=None),
) -> str:
    """Require a valid viewer_id; raise 401 otherwise."""
    vid = get_optional_viewer_id(lit_viewer)
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
