"""Contract tests for the clip trust-tier declaration.

Two layers, per `.claude/rules/internal-api-policy.md`:

* **Layer 1 (wire shape)** — URL, method, secret header, and body, plus the
  error paths the caller actually branches on.
* **Layer 2 (validator parity)** — the tier values this addon can emit must
  be exactly the set core accepts, so a change on either side breaks a test
  rather than drifting into silent 422s at runtime.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app import internal_client
from app.internal_client import InternalAPIError, InternalClient


def _install_transport(monkeypatch, handler):
    orig_async_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return orig_async_client(*args, **kwargs)

    monkeypatch.setattr(internal_client.httpx, "AsyncClient", _factory)


# --- Layer 1: wire shape -------------------------------------------------

@pytest.mark.asyncio
async def test_declare_trust_tier_wire_shape(monkeypatch):
    monkeypatch.setattr(internal_client, "CORE_INTERNAL_SECRET", "topsecret")
    received: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        received["method"] = req.method
        received["url"] = str(req.url)
        received["secret"] = req.headers.get("X-Internal-Secret")
        received["content_type"] = req.headers.get("Content-Type")
        received["body"] = json.loads(req.read())
        return httpx.Response(204)

    _install_transport(monkeypatch, handler)
    await InternalClient().declare_trust_tier("abc123456789", "unverified")

    assert received["method"] == "PUT"
    assert received["url"].endswith(
        "/api/internal/files/abc123456789/trust-tier"
    )
    assert received["secret"] == "topsecret"
    assert received["content_type"] == "application/json"
    assert received["body"] == {"tier": "unverified"}


@pytest.mark.asyncio
async def test_declare_trust_tier_omits_secret_header_when_unset(monkeypatch):
    """Core answers 503 in that case; the client must not invent a header."""
    monkeypatch.setattr(internal_client, "CORE_INTERNAL_SECRET", "")
    received: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        received["has_secret"] = "X-Internal-Secret" in req.headers
        return httpx.Response(503, text="Internal write secret is not configured")

    _install_transport(monkeypatch, handler)
    with pytest.raises(InternalAPIError) as exc:
        await InternalClient().declare_trust_tier("abc123456789", "unverified")

    assert received["has_secret"] is False
    assert exc.value.status_code == 503


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [403, 404, 409, 422, 500])
async def test_declare_trust_tier_propagates_status(monkeypatch, status):
    """Every non-204 reaches the caller with its status intact.

    ``clips.py`` branches on 409 specifically, so the status cannot be
    flattened into a generic failure.
    """
    _install_transport(monkeypatch, lambda req: httpx.Response(status, text="x"))

    with pytest.raises(InternalAPIError) as exc:
        await InternalClient().declare_trust_tier("abc123456789", "unverified")
    assert exc.value.status_code == status


# --- Layer 2: validator parity -------------------------------------------

#: Mirror of core's ``app.models.TRUST_TIERS``. Core runs in another container
#: and cannot be imported here, so the vocabulary is pinned on both sides —
#: the same arrangement as the duplicated frontmatter parsers. Core has a
#: matching test (``test_trust_tier_vocabulary_is_pinned``) that fails if the
#: set there changes, which is the signal to update this literal too.
CORE_ACCEPTED_TIERS = {"verified", "unverified"}


def test_ingest_tier_constant_is_accepted_by_core():
    """Read the real constant the router sends, not a copy of it."""
    from app.routers.clips import CLIP_INGEST_TIER

    assert CLIP_INGEST_TIER in CORE_ACCEPTED_TIERS


@pytest.mark.asyncio
async def test_emitted_tier_comes_from_the_real_call_path(monkeypatch):
    """Capture what the placeholder path actually puts on the wire.

    Hard-coding the expected tier on both sides would let the pair agree with
    itself; this drives ``_create_placeholder`` and reads the emitted value
    back out of the request body.
    """
    from app.routers import clips as clips_router

    emitted: dict = {}

    class _CapturingClient:
        async def create_text_file(self, drive, path, content, **kwargs):
            return {"id": "abc123456789", "file_path": path}

        async def declare_trust_tier(self, file_id, tier):
            emitted["file_id"] = file_id
            emitted["tier"] = tier

    await clips_router._create_placeholder(
        _CapturingClient(), "test-drive", "https://example.com/a", title="A"
    )

    assert emitted["tier"] in CORE_ACCEPTED_TIERS
    assert emitted["tier"] == clips_router.CLIP_INGEST_TIER


@pytest.mark.parametrize(
    ("tier", "accepted"),
    [
        ("verified", True),
        ("unverified", True),
        ("Verified", False),
        ("unreviewed", False),   # a listing filter, never a stored tier
        ("", False),
        ("trusted", False),
    ],
)
def test_tier_vocabulary_pair_table(tier, accepted):
    assert (tier in CORE_ACCEPTED_TIERS) is accepted
