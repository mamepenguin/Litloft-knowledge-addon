"""Shared contract for webclip extractors.

Every extraction path — the generic two-pass pipeline and each
site-specific module — returns an ``ExtractedArticle`` and agrees on what
"too small" and "too large" mean, so the dispatcher in
``app.services.extractor`` can compare their results on equal terms.

The site contract is deliberately narrow:

``matches(url)``
    Cheap host test. No parsing, no network.
``extract(html, url)``
    An article, or ``None`` when this extractor cannot handle the page.
    **It must not raise.** Site DOMs change without notice, and a site
    path that starts throwing has to degrade into the generic pipeline
    rather than take webclip down with it. The dispatcher wraps calls in
    a catch-all as a second layer, but extractors should return ``None``
    on their own.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol
from urllib.parse import urlparse

import app.config as config

# Below this size an extraction is considered effectively empty and the
# caller moves on to the next path. 100 bytes clears roughly 30 CJK
# characters or 100 Latin ones — enough to exclude "just a title
# heading" pages while still accepting very short news flashes.
MIN_BODY_BYTES = 100


@dataclass
class ExtractedArticle:
    title: Optional[str]
    markdown: str


class SiteExtractor(Protocol):
    """A site-specific extraction path. See the module docstring."""

    def matches(self, url: str | None) -> bool: ...

    def extract(self, html: str, url: str) -> Optional[ExtractedArticle]: ...


def body_bytes(md: str) -> int:
    return len(md.strip().encode("utf-8"))


def enforce_size_ceiling(md: str) -> None:
    """Raise if ``md`` exceeds the per-clip body cap.

    Upstream ``fetcher`` already bounds the raw HTML; this guards the
    post-extraction size so a huge single-page article (rare) can't blow
    past the design-doc limit.

    ``config`` is read as a module attribute rather than imported by
    value so tests can patch ``app.config.CLIP_MAX_BODY_BYTES`` without
    depending on which module the check happens to live in.
    """
    size = len(md.encode("utf-8"))
    if size > config.CLIP_MAX_BODY_BYTES:
        raise ValueError(
            f"Extracted body too large: {size} > {config.CLIP_MAX_BODY_BYTES}"
        )


def host_matches(url: str | None, hostnames: frozenset[str]) -> bool:
    """True when ``url``'s host is one of ``hostnames`` or a subdomain.

    Exception-safe: an unparseable URL is simply not a match, so a
    malformed input skips site paths instead of failing the clip.
    """
    if not url:
        return False
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return False
    return any(host == name or host.endswith(f".{name}") for name in hostnames)
