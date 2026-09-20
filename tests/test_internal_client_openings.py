"""What `get_file_opening` asks the core for, and what it keeps."""
from __future__ import annotations

import httpx
import pytest

from app.internal_client import InternalClient


def transport_recording(requests: list[httpx.Request], body: bytes):
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(206, content=body)

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_asks_for_the_opening_and_keeps_no_more(monkeypatch):
    seen: list[httpx.Request] = []
    body = b"x" * 50_000

    class RecordingClient(httpx.AsyncClient):
        def __init__(self, *a, **kw):
            super().__init__(*a, **{**kw, "transport": transport_recording(seen, body)})

    monkeypatch.setattr(httpx, "AsyncClient", RecordingClient)

    text = await InternalClient().get_file_opening("f1", 100)

    # Without the range the addon reads whole files: a caller with a list
    # of ids turns that into hundreds of them.
    assert seen[0].headers["Range"] == "bytes=0-99"
    assert len(text) == 100
