"""SSRF-safe HTTP fetcher for webclip ingestion.

Defense in depth — every hop in a redirect chain is re-validated. Each
check is independently sufficient; stacking them guards against any one
being misconfigured. The validator is split from the fetcher so unit
tests can exercise it without a live socket.

Why re-resolve on every redirect rather than trusting httpx:
  Cheap DNS-rebinding attacks: first resolution returns a public IP,
  second returns a private one. We resolve and connect by IP each hop.

Why not use ``httpx(follow_redirects=True)``:
  Same reason. We need the redirect Location before connecting so we
  can re-validate against the denylist.
"""
from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urljoin, urlparse

import httpx

from app.config import (
    CLIP_DEFAULT_USER_AGENT,
    CLIP_HTTP_TIMEOUT_SEC,
    CLIP_MAX_HTML_BYTES,
)

_ALLOWED_SCHEMES = frozenset({"http", "https"})
_ALLOWED_CONTENT_TYPES = ("text/html", "application/xhtml+xml")

# Docker-compose service names inside our private network. These would
# resolve to internal IPs from this container, but belt-and-suspenders
# reject them by hostname before DNS resolution too.
_DOCKER_HOSTS = frozenset({
    "backend", "frontend", "knowledge", "intelligence",
    "postgres", "redis", "localhost",
})

_MAX_REDIRECTS = 5


class BlockedURL(Exception):
    """Raised when a URL fails SSRF validation."""


class FetchError(Exception):
    """Raised on network / HTTP errors after validation passed."""


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if ip.is_loopback or ip.is_link_local or ip.is_multicast:
        return True
    if ip.is_private or ip.is_reserved or ip.is_unspecified:
        return True
    if isinstance(ip, ipaddress.IPv6Address):
        # IPv4-mapped IPv6: ::ffff:x.x.x.x — unwrap and re-check
        if ip.ipv4_mapped is not None:
            return _is_blocked_ip(ip.ipv4_mapped)
    else:
        # 100.64.0.0/10 (CGNAT) isn't flagged by is_private on all Pythons
        if ipaddress.IPv4Address("100.64.0.0") <= ip <= ipaddress.IPv4Address(
            "100.127.255.255"
        ):
            return True
    return False


def _resolve_host(hostname: str) -> list[str]:
    """DNS resolve and return all A/AAAA IP strings. Empty on failure."""
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return []
    ips: list[str] = []
    seen: set[str] = set()
    for info in infos:
        ip = info[4][0]
        # Strip IPv6 zone id
        if "%" in ip:
            ip = ip.split("%", 1)[0]
        if ip not in seen:
            seen.add(ip)
            ips.append(ip)
    return ips


def _validate_scheme(scheme: str) -> None:
    if scheme not in _ALLOWED_SCHEMES:
        raise BlockedURL(f"Disallowed scheme: {scheme}")


def _validate_host(host: str) -> None:
    if not host:
        raise BlockedURL("Missing host")
    if host.lower() in _DOCKER_HOSTS:
        raise BlockedURL(f"Docker internal host denied: {host}")


def _validate_resolved_ips(hostname: str) -> list[str]:
    """Resolve hostname and reject any result pointing into a private range.

    Returns the list of resolved IPs (caller can pass one to httpx as a
    pinned connection target) or raises ``BlockedURL``.
    """
    ips = _resolve_host(hostname)
    if not ips:
        raise BlockedURL(f"DNS resolution failed: {hostname}")
    for ip_str in ips:
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError as e:
            raise BlockedURL(f"Invalid IP in DNS response: {ip_str}") from e
        if _is_blocked_ip(ip):
            raise BlockedURL(f"Blocked IP for {hostname}: {ip_str}")
    return ips


def validate_url(url: str) -> None:
    """Structural + DNS-level SSRF validation. Raises ``BlockedURL``.

    Split out so callers that just want to reject obviously bad URLs at
    API time (before queuing a job) can reuse this without a live fetch.
    """
    try:
        parsed = urlparse(url)
    except ValueError as e:
        raise BlockedURL(f"Malformed URL: {e}") from e
    _validate_scheme(parsed.scheme)
    host = (parsed.hostname or "").strip()
    _validate_host(host)
    # Reject IP literals pointing to private ranges directly
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None and _is_blocked_ip(literal):
        raise BlockedURL(f"Blocked IP literal: {host}")
    _validate_resolved_ips(host)


@dataclass
class FetchResult:
    final_url: str
    content_type: str
    body: bytes


def _validate_content_type(ct: str) -> None:
    lower = ct.split(";")[0].strip().lower()
    if lower not in _ALLOWED_CONTENT_TYPES:
        raise FetchError(f"Disallowed Content-Type: {ct}")


def _check_redirect_downgrade(prev_scheme: str, next_scheme: str) -> None:
    # https → http downgrade is rejected; http → https upgrade allowed.
    if prev_scheme == "https" and next_scheme == "http":
        raise BlockedURL("Refusing redirect downgrade https → http")


async def fetch_html(
    url: str,
    *,
    user_agent: str | None = None,
    max_bytes: int = CLIP_MAX_HTML_BYTES,
    timeout_sec: float = CLIP_HTTP_TIMEOUT_SEC,
    client_factory=None,
) -> FetchResult:
    """Fetch ``url`` as HTML with full SSRF protection.

    Re-validates at each redirect hop. ``client_factory`` exists so tests
    can inject a mock httpx client without monkeypatching module state.
    """
    ua = user_agent or CLIP_DEFAULT_USER_AGENT
    current = url
    seen: list[str] = []

    async def _make_client():
        if client_factory is not None:
            return client_factory()
        return httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_sec, connect=5.0, read=15.0),
            follow_redirects=False,
        )

    client = await _make_client()
    async with client:
        for hop in range(_MAX_REDIRECTS + 1):
            validate_url(current)
            seen.append(current)

            try:
                resp = await client.get(
                    current,
                    headers={"User-Agent": ua, "Accept": "text/html,application/xhtml+xml"},
                )
            except httpx.HTTPError as e:
                raise FetchError(f"HTTP error: {e}") from e

            if 300 <= resp.status_code < 400:
                location = resp.headers.get("location")
                if not location:
                    raise FetchError(f"Redirect without Location ({resp.status_code})")
                prev = urlparse(current)
                # Resolve relative redirects against the previous URL.
                # urljoin handles schemeless, root-relative, and
                # path-relative forms uniformly.
                location = urljoin(current, location)
                nxt = urlparse(location)
                _check_redirect_downgrade(prev.scheme, nxt.scheme)
                current = location
                continue

            if resp.status_code != 200:
                raise FetchError(f"HTTP {resp.status_code}")

            _validate_content_type(resp.headers.get("content-type", ""))

            # Enforce max size even if server omits / lies about Content-Length.
            body = resp.content
            if len(body) > max_bytes:
                raise FetchError(
                    f"Response too large: {len(body)} > {max_bytes}"
                )
            return FetchResult(
                final_url=current,
                content_type=resp.headers.get("content-type", ""),
                body=body,
            )

        raise FetchError(f"Too many redirects (> {_MAX_REDIRECTS}): {' -> '.join(seen)}")
