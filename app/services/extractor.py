"""HTML → Markdown pipeline for webclips.

Two-pass extraction with a shared sanitizer:

1. **Primary: trafilatura**. Multilingual content extractor with better
   recall on CJK / SPA-ish pages than readability alone. It filters
   scripts/styles/forms internally and can emit Markdown directly, so
   its output doesn't go through our bleach step.
2. **Fallback: readability-lxml → bleach → markdownify**. Kept as a
   second pass for pages where trafilatura returns too little. Cases
   where one library fumbles while the other succeeds are not
   symmetric — keeping both maximises the hit rate without paying the
   cost of a headless browser.

The ``bleach.clean`` allowlist still guards the readability path
*before* ``markdownify`` sees the HTML — otherwise the Markdown
serializer would emit raw ``<script>`` snippets when it encounters
them. Sanitization-then-convert is a non-negotiable order there.

The caller decides what to do when both passes fail. ``extract_article``
returns whatever is best available (possibly empty) rather than raising,
so the worker can classify an empty result as a permanent failure and
surface the paste-HTML fallback UI instead of writing a content-less
``.md``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import bleach
import trafilatura
from markdownify import markdownify
from readability import Document

from app.config import CLIP_MAX_BODY_BYTES

# Below this size we consider the extraction effectively empty and let
# the worker fail the job. 100 bytes clears roughly 30 CJK characters or
# 100 Latin characters — enough to exclude "just a title heading" pages
# while still accepting very short news flashes.
_MIN_BODY_BYTES = 100


_ALLOWED_TAGS = frozenset({
    "a", "abbr", "acronym", "b", "blockquote", "br", "cite", "code",
    "dd", "del", "dfn", "div", "dl", "dt", "em", "figcaption", "figure",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "i", "img", "ins", "kbd", "li", "mark",
    "ol", "p", "pre", "q", "s", "samp", "small", "span", "strong", "sub",
    "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u",
    "ul", "var",
})

_ALLOWED_ATTRS = {
    "*": ["title"],
    "a": ["href", "title", "rel"],
    "img": ["src", "alt", "title"],
    "th": ["scope"],
}

_ALLOWED_PROTOCOLS = frozenset({"http", "https", "mailto"})


@dataclass
class ExtractedArticle:
    title: Optional[str]
    markdown: str


def _sanitize_html(html: str) -> str:
    return bleach.clean(
        html,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        protocols=_ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
    )


def _body_bytes(md: str) -> int:
    return len(md.strip().encode("utf-8"))


def _enforce_size_ceiling(md: str) -> None:
    """Raise if ``md`` exceeds the per-clip body cap.

    Upstream ``fetcher`` already bounds the raw HTML; this guards the
    post-extraction size so a huge single-page article (rare) can't
    blow past the design-doc limit.
    """
    if len(md.encode("utf-8")) > CLIP_MAX_BODY_BYTES:
        raise ValueError(
            f"Extracted body too large: {len(md.encode('utf-8'))} > {CLIP_MAX_BODY_BYTES}"
        )


def _extract_with_trafilatura(html: str) -> Optional[ExtractedArticle]:
    """Primary path: multilingual extractor → Markdown.

    trafilatura emits Markdown directly and filters unsafe tags
    internally, so the output skips the bleach+markdownify stack.
    ``_enforce_size_ceiling`` propagates so a genuinely oversized page
    reaches the worker as a ValueError instead of silently fading into
    the readability fallback (oversize is a distinct failure mode from
    "couldn't extract anything").
    Returns ``None`` when nothing was recovered; caller falls back.
    """
    md = trafilatura.extract(
        html,
        output_format="markdown",
        include_links=True,
        include_images=True,
        include_comments=False,
        include_tables=True,
        favor_recall=True,
    )
    if not md:
        return None

    _enforce_size_ceiling(md)

    title: Optional[str] = None
    meta = trafilatura.extract_metadata(html)
    if meta is not None:
        title_raw = (meta.title or "").strip()
        title = title_raw or None

    return ExtractedArticle(title=title, markdown=md.strip())


def _extract_with_readability(html: str) -> Optional[ExtractedArticle]:
    """Fallback path: readability-lxml → bleach allowlist → markdownify.

    Returns ``None`` on library errors so the caller can decide between
    "try the other extractor" and "give up". A successful call may
    still return a short / empty markdown — the caller checks length.
    Oversize raises so both passes agree on that error surface.
    """
    try:
        doc = Document(html)
        title = (doc.short_title() or doc.title() or "").strip() or None
        summary_html = doc.summary(html_partial=True)
    except Exception:
        return None

    safe_html = _sanitize_html(summary_html)
    md = markdownify(safe_html, heading_style="ATX", bullets="-").strip()

    _enforce_size_ceiling(md)

    return ExtractedArticle(title=title, markdown=md)


def extract_article(html: str, url: str | None = None) -> ExtractedArticle:
    """Extract article body via trafilatura then readability.

    Never raises on empty output — returns an ``ExtractedArticle`` whose
    ``markdown`` may be empty if both passes fail. The worker inspects
    ``markdown`` length and fails the job permanently when it's below
    ``_MIN_BODY_BYTES`` so the user sees the paste-HTML retry UI
    instead of a frontmatter-only ``.md``.

    Title preference: whichever pass produced the longer body wins its
    own title too. If only one pass returned anything, we use its
    title. If neither did, the returned article has ``title=None`` and
    empty markdown.
    """
    primary = _extract_with_trafilatura(html)
    if primary is not None and _body_bytes(primary.markdown) >= _MIN_BODY_BYTES:
        return primary

    fallback = _extract_with_readability(html)
    if fallback is not None and _body_bytes(fallback.markdown) >= _MIN_BODY_BYTES:
        return fallback

    # Both came up short. Return the best of what we have so the worker
    # can classify by length — if everything was None, hand back an
    # empty article for the same downstream treatment.
    candidates = [a for a in (primary, fallback) if a is not None]
    if not candidates:
        return ExtractedArticle(title=None, markdown="")
    return max(candidates, key=lambda a: _body_bytes(a.markdown))


def sanitize_pasted_html(html: str) -> str:
    """Entry point for the manual-paste fallback. Same bleach allowlist."""
    return _sanitize_html(html)
