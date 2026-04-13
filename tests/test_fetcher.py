"""Unit tests for SSRF-safe fetcher.

We lean on patching ``socket.getaddrinfo`` to control DNS without real
networking. httpx-level behaviour (redirect handling, status codes,
size enforcement) is exercised with ``httpx.MockTransport``.
"""
from __future__ import annotations

import httpx
import pytest

from app.services import fetcher
from app.services.fetcher import (
    BlockedURL,
    FetchError,
    _is_blocked_ip,
    fetch_html,
    validate_url,
)
import ipaddress


def _stub_dns(monkeypatch, mapping):
    def fake(host, _port=None, *args, **kwargs):
        ip = mapping.get(host)
        if ip is None:
            raise __import__("socket").gaierror(f"no such host: {host}")
        # getaddrinfo format: (family, type, proto, canonname, sockaddr)
        return [(0, 0, 0, "", (ip, 0))]
    import socket
    monkeypatch.setattr(socket, "getaddrinfo", fake)


def test_scheme_allowlist(monkeypatch):
    _stub_dns(monkeypatch, {"example.com": "93.184.216.34"})
    with pytest.raises(BlockedURL):
        validate_url("ftp://example.com/")
    with pytest.raises(BlockedURL):
        validate_url("file:///etc/passwd")
    with pytest.raises(BlockedURL):
        validate_url("javascript:alert(1)")


def test_docker_host_denylist(monkeypatch):
    _stub_dns(monkeypatch, {"backend": "172.20.0.2"})
    with pytest.raises(BlockedURL, match="Docker"):
        validate_url("http://backend:8000/")


@pytest.mark.parametrize("ip,blocked", [
    ("127.0.0.1", True),
    ("10.1.2.3", True),
    ("192.168.1.1", True),
    ("172.16.0.5", True),
    ("169.254.169.254", True),   # AWS metadata
    ("100.64.1.1", True),         # CGNAT
    ("::1", True),
    ("fe80::1", True),
    ("fc00::1", True),
    ("::ffff:10.0.0.1", True),    # IPv4-mapped private
    ("93.184.216.34", False),     # example.com
    ("2606:2800:220:1:248:1893:25c8:1946", False),  # public v6
])
def test_is_blocked_ip(ip, blocked):
    assert _is_blocked_ip(ipaddress.ip_address(ip)) is blocked


def test_rejects_private_ip_literal(monkeypatch):
    with pytest.raises(BlockedURL):
        validate_url("http://127.0.0.1/")
    with pytest.raises(BlockedURL):
        validate_url("http://10.0.0.1/")


def test_rejects_private_resolution(monkeypatch):
    _stub_dns(monkeypatch, {"evil.local": "10.0.0.5"})
    with pytest.raises(BlockedURL, match="Blocked IP"):
        validate_url("http://evil.local/")


def test_dns_failure_blocks(monkeypatch):
    _stub_dns(monkeypatch, {})
    with pytest.raises(BlockedURL, match="DNS"):
        validate_url("http://nope.invalid/")


@pytest.mark.asyncio
async def test_fetch_rejects_bad_content_type(monkeypatch):
    _stub_dns(monkeypatch, {"ok.example": "93.184.216.34"})

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"{}", headers={"content-type": "application/json"})

    transport = httpx.MockTransport(handler)

    def factory():
        return httpx.AsyncClient(transport=transport, follow_redirects=False)

    with pytest.raises(FetchError, match="Content-Type"):
        await fetch_html("http://ok.example/", client_factory=factory)


@pytest.mark.asyncio
async def test_fetch_rejects_oversize(monkeypatch):
    _stub_dns(monkeypatch, {"ok.example": "93.184.216.34"})
    big = b"<html>" + b"a" * 1024 + b"</html>"

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=big, headers={"content-type": "text/html"})

    transport = httpx.MockTransport(handler)

    def factory():
        return httpx.AsyncClient(transport=transport, follow_redirects=False)

    with pytest.raises(FetchError, match="too large"):
        await fetch_html("http://ok.example/", max_bytes=100, client_factory=factory)


@pytest.mark.asyncio
async def test_fetch_follows_redirect_up_to_limit(monkeypatch):
    _stub_dns(monkeypatch, {"ok.example": "93.184.216.34", "dest.example": "93.184.216.35"})
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if req.url.host == "ok.example":
            return httpx.Response(302, headers={"location": "http://dest.example/"})
        return httpx.Response(200, content=b"<html><body>hi</body></html>",
                              headers={"content-type": "text/html"})

    transport = httpx.MockTransport(handler)

    def factory():
        return httpx.AsyncClient(transport=transport, follow_redirects=False)

    result = await fetch_html("http://ok.example/", client_factory=factory)
    assert result.final_url == "http://dest.example/"
    assert b"hi" in result.body
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_fetch_rejects_downgrade_redirect(monkeypatch):
    _stub_dns(monkeypatch, {"ok.example": "93.184.216.34", "dest.example": "93.184.216.35"})

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://dest.example/"})

    transport = httpx.MockTransport(handler)

    def factory():
        return httpx.AsyncClient(transport=transport, follow_redirects=False)

    with pytest.raises(BlockedURL, match="downgrade"):
        await fetch_html("https://ok.example/", client_factory=factory)


@pytest.mark.asyncio
async def test_fetch_rejects_redirect_to_private(monkeypatch):
    _stub_dns(monkeypatch, {"ok.example": "93.184.216.34", "evil.local": "10.0.0.5"})

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://evil.local/"})

    transport = httpx.MockTransport(handler)

    def factory():
        return httpx.AsyncClient(transport=transport, follow_redirects=False)

    with pytest.raises(BlockedURL, match="Blocked IP"):
        await fetch_html("http://ok.example/", client_factory=factory)
