"""Contract tests for InternalClient → core's Internal API.

Per hako 70vp3pXn2iod7ehhxcYF5 (global): external-addon callers of
Internal API must have at least one contract test pinning the
request/response shape. monkeypatch replaces ``httpx.AsyncClient`` with
a fake backed by ``httpx.MockTransport`` so the real URL, headers,
and JSON body the client sends can be asserted.
"""

from __future__ import annotations

import httpx
import pytest

from app import internal_client
from app.internal_client import InternalAPIError, InternalClient


def _install_transport(monkeypatch, handler):
    """Replace httpx.AsyncClient() with one backed by a MockTransport.

    InternalClient constructs ``AsyncClient`` inline for each call
    (``async with httpx.AsyncClient(timeout=...) as client``), so we
    intercept the constructor rather than the instance.
    """
    orig_async_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return orig_async_client(*args, **kwargs)

    monkeypatch.setattr(internal_client.httpx, "AsyncClient", _factory)


@pytest.mark.asyncio
async def test_sync_core_tags_posts_expected_payload(monkeypatch):
    received: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        received["url"] = str(req.url)
        received["method"] = req.method
        received["content_type"] = req.headers.get("content-type", "")
        import json

        received["body"] = json.loads(req.content)
        return httpx.Response(204)

    _install_transport(monkeypatch, handler)
    client = InternalClient()
    await client.sync_core_tags("abc123456789", ["cooking", "japanese"])

    assert received["method"] == "POST"
    assert received["url"].endswith("/api/internal/files/abc123456789/tags")
    assert received["content_type"].startswith("application/json")
    assert received["body"] == {"tags": ["cooking", "japanese"]}


@pytest.mark.asyncio
async def test_sync_core_tags_sends_secret_header_when_configured(monkeypatch):
    monkeypatch.setattr(internal_client, "CORE_INTERNAL_SECRET", "topsecret")
    received_headers: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        received_headers.update(dict(req.headers))
        return httpx.Response(204)

    _install_transport(monkeypatch, handler)
    await InternalClient().sync_core_tags("abc123456789", [])

    assert received_headers.get("x-internal-secret") == "topsecret"


@pytest.mark.asyncio
async def test_sync_core_tags_omits_secret_when_unset(monkeypatch):
    monkeypatch.setattr(internal_client, "CORE_INTERNAL_SECRET", "")
    received_headers: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        received_headers.update(dict(req.headers))
        return httpx.Response(204)

    _install_transport(monkeypatch, handler)
    await InternalClient().sync_core_tags("abc123456789", [])

    assert "x-internal-secret" not in {k.lower() for k in received_headers}


@pytest.mark.asyncio
async def test_sync_core_tags_raises_on_non_204(monkeypatch):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"detail": "bad tag"})

    _install_transport(monkeypatch, handler)
    with pytest.raises(InternalAPIError) as exc:
        await InternalClient().sync_core_tags("abc123456789", ["bad name"])
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_sync_core_tags_empty_list_sends_empty_array(monkeypatch):
    """Empty tag list is a legitimate clear-all instruction, not a skip.

    Verifies the JSON body serialises ``tags: []`` rather than omitting
    the key — this is the β canonical "no tags here" signal (spec §D2).
    """
    received: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        import json

        received["body"] = json.loads(req.content)
        return httpx.Response(204)

    _install_transport(monkeypatch, handler)
    await InternalClient().sync_core_tags("abc123456789", [])
    assert received["body"] == {"tags": []}


@pytest.mark.asyncio
async def test_emit_addon_event_sends_secret_header_when_configured(monkeypatch):
    """Regression test: emit_addon_event silently dropped the secret
    header, so ``POST /api/internal/addon-events`` 403'd whenever
    ``CORE_INTERNAL_SECRET`` was set, and the failure was swallowed by
    the bare ``except httpx.HTTPError`` — the clip.ready WS event never
    reached the frontend even though the fetch had already succeeded.
    """
    monkeypatch.setattr(internal_client, "CORE_INTERNAL_SECRET", "topsecret")
    received: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        received["url"] = str(req.url)
        received["headers"] = dict(req.headers)
        return httpx.Response(204)

    _install_transport(monkeypatch, handler)
    await InternalClient().emit_addon_event(
        "knowledge.clip.ready", {"file_id": "abc"}, drive="mydrive"
    )

    assert received["url"].endswith("/api/internal/addon-events")
    assert received["headers"].get("x-internal-secret") == "topsecret"


@pytest.mark.asyncio
async def test_emit_addon_event_omits_secret_when_unset(monkeypatch):
    monkeypatch.setattr(internal_client, "CORE_INTERNAL_SECRET", "")
    received_headers: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        received_headers.update(dict(req.headers))
        return httpx.Response(204)

    _install_transport(monkeypatch, handler)
    await InternalClient().emit_addon_event("knowledge.clip.ready", {})

    assert "x-internal-secret" not in {k.lower() for k in received_headers}


def test_validator_parity_with_core():
    """Pin the shared validator semantics between the scanner's
    ``_normalise_tags`` and core's ``TagUpdate`` schema.

    Both sides reject tags with spaces or punctuation and accept CJK
    word chars + ASCII + hyphen + underscore. If either side drifts,
    scanner sync will start 422-ing or silently accept names core
    rejects. The fix is to keep this table in sync with core's
    ``backend/app/schemas.py::TagUpdate.validate_tags``.
    """
    from app.services.note_scanner import _normalise_tags

    samples = [
        # (input_yaml_value, expected_in_output)
        ("plain", True),
        ("with_underscore", True),
        ("with-hyphen", True),
        ("日本語", True),
        ("mixed123", True),
        ("has space", False),
        ("has.dot", False),
        ("has!bang", False),
        ("", False),
        ("x" * 31, False),  # over length cap
        ("x" * 30, True),  # at cap
    ]
    for value, expected in samples:
        result = _normalise_tags({"tags": [value]})
        got = bool(result)
        assert got == expected, f"{value!r} expected {expected} got {got}"
