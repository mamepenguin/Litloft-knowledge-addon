"""Contract tests for the arrival a web clip records when its file is created.

Two layers, per ``.claude/rules/internal-api-policy.md``:

* **Layer 1 (wire shape)** — the create that carries ``arrival``: URL, method,
  content type, credential, body, and the 422 the caller branches on.
* **Layer 2 (validator parity)** — the values the clip path emits must satisfy
  core's ``TextFileCreateRequest.arrival`` patterns, which cannot be imported
  from another container.
"""

from __future__ import annotations

import json
import re

import httpx
import pytest

from app import internal_client
from app.credentials import CallerCredential
from app.internal_client import InternalAPIError, InternalClient

WEB_CLIP_ARRIVAL = {
    "source": "web_clip",
    "i18n_key": "knowledge.inbox.sourceWebClip",
}


def _install_transport(monkeypatch, handler):
    orig_async_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return orig_async_client(*args, **kwargs)

    monkeypatch.setattr(internal_client.httpx, "AsyncClient", _factory)


# --- Layer 1: wire shape -------------------------------------------------


@pytest.mark.asyncio
async def test_create_text_file_wire_carries_arrival(monkeypatch):
    """SPEC-ADDON-059 I2: the create that lands a clip reports its arrival."""
    received: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        received["method"] = req.method
        received["url"] = str(req.url)
        received["content_type"] = req.headers.get("Content-Type", "")
        received["authorization"] = req.headers.get("Authorization")
        received["body"] = json.loads(req.read())
        return httpx.Response(201, json={"id": "abc123456789"})

    _install_transport(monkeypatch, handler)
    created = await InternalClient(
        credential=CallerCredential(bearer="caller-token")
    ).create_text_file(
        "test-drive", "clip.md", "# clip\n", arrival=WEB_CLIP_ARRIVAL
    )

    assert received["method"] == "POST"
    assert received["url"].endswith("/api/drives/test-drive/files")
    assert received["content_type"].startswith("application/json")
    assert received["authorization"] == "Bearer caller-token"
    assert received["body"] == {
        "path": "clip.md",
        "content": "# clip\n",
        "conflict_mode": "rename",
        "arrival": WEB_CLIP_ARRIVAL,
    }
    assert created["id"] == "abc123456789"


@pytest.mark.asyncio
async def test_create_text_file_omits_arrival_when_not_given(monkeypatch):
    """SPEC-ADDON-059 I1: a create with no arrival must not invent one."""
    received: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        received["body"] = json.loads(req.read())
        return httpx.Response(201, json={"id": "abc123456789"})

    _install_transport(monkeypatch, handler)
    await InternalClient().create_text_file("test-drive", "note.md", "# note\n")

    assert "arrival" not in received["body"]


@pytest.mark.asyncio
async def test_create_text_file_propagates_rejected_arrival(monkeypatch):
    """SPEC-ADDON-059 I2: core's 422 reaches the caller unchanged."""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"detail": "arrival.source"})

    _install_transport(monkeypatch, handler)
    with pytest.raises(InternalAPIError) as exc:
        await InternalClient().create_text_file(
            "test-drive", "clip.md", "# clip\n", arrival={"source": "Web Clip"}
        )

    assert exc.value.status_code == 422


# --- Layer 2: validator parity -------------------------------------------

#: Mirrors core's ``TextFileCreateRequest.arrival`` patterns in
#: ``backend/app/schemas.py``. Core runs in another container and cannot be
#: imported here, so the rule is pinned on both sides; core's own schema tests
#: fail when it changes, which is the signal to update these literals too.
CORE_ARRIVAL_SOURCE = re.compile(r"^[a-z][a-z0-9_.]{0,63}$")
CORE_ARRIVAL_I18N_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_.]{0,127}$")


class _ArrivalCapture:
    def __init__(self):
        self.arrival = None

    async def create_text_file(self, drive, path, content, **kwargs):
        self.arrival = kwargs.get("arrival")
        return {"id": "abc123456789", "file_path": path}

    async def declare_trust_tier(self, file_id, tier):
        pass


async def _emitted_arrival() -> dict:
    from app.routers import clips as clips_router

    capture = _ArrivalCapture()
    await clips_router._create_placeholder(
        capture, "test-drive", "https://example.com/article", title="Arrival"
    )
    return capture.arrival


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field", "expected", "core_pattern"),
    [
        ("source", "web_clip", CORE_ARRIVAL_SOURCE),
        ("i18n_key", "knowledge.inbox.sourceWebClip", CORE_ARRIVAL_I18N_KEY),
    ],
)
async def test_placeholder_arrival_matches_core_schema(
    field, expected, core_pattern
):
    """SPEC-ADDON-059 I2: the emitted arrival passes core's validator."""
    arrival = await _emitted_arrival()

    assert arrival is not None
    assert set(arrival) == {"source", "i18n_key"}
    assert arrival[field] == expected
    assert core_pattern.fullmatch(arrival[field])
