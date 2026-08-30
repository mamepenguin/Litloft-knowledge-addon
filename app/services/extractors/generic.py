"""Site-agnostic extraction: trafilatura, then readability-lxml.

Two passes because the libraries fumble on different pages and the
failures are not symmetric — keeping both maximises the hit rate without
paying for a headless browser.

The ``bleach.clean`` allowlist guards the readability path *before*
``markdownify`` sees the HTML; otherwise the Markdown serializer would
emit raw ``<script>`` snippets when it encounters them.
Sanitization-then-convert is a non-negotiable order there. trafilatura
filters scripts and styles internally and emits Markdown directly, so
its output does not go through bleach.

``sanitize_html`` also backs the manual-paste fallback, which is why it
lives beside the allowlist that defines it rather than in ``base``.
"""
from __future__ import annotations

from typing import Optional

import bleach
import trafilatura
from markdownify import markdownify
from readability import Document

from app.services.extractors.base import ExtractedArticle, enforce_size_ceiling

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


def sanitize_html(html: str) -> str:
    return bleach.clean(
        html,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        protocols=_ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
    )


def extract_with_trafilatura(html: str) -> Optional[ExtractedArticle]:
    """Primary path: multilingual extractor → Markdown.

    ``enforce_size_ceiling`` propagates so a genuinely oversized page
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

    enforce_size_ceiling(md)

    title: Optional[str] = None
    meta = trafilatura.extract_metadata(html)
    if meta is not None:
        title_raw = (meta.title or "").strip()
        title = title_raw or None

    return ExtractedArticle(title=title, markdown=md.strip())


def extract_with_readability(html: str) -> Optional[ExtractedArticle]:
    """Fallback path: readability-lxml → bleach allowlist → markdownify.

    Returns ``None`` on library errors so the caller can decide between
    "try the other extractor" and "give up". A successful call may still
    return a short / empty markdown — the caller checks length. Oversize
    raises so both passes agree on that error surface.
    """
    try:
        doc = Document(html)
        title = (doc.short_title() or doc.title() or "").strip() or None
        summary_html = doc.summary(html_partial=True)
    except Exception:
        return None

    safe_html = sanitize_html(summary_html)
    md = markdownify(safe_html, heading_style="ATX", bullets="-").strip()

    enforce_size_ceiling(md)

    return ExtractedArticle(title=title, markdown=md)
