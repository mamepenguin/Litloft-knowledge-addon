"""HTML → Markdown pipeline for webclips.

Three stages, each independently verifiable:

1. ``readability-lxml`` identifies the main article and strips
   navigation / ads.
2. ``bleach.clean`` enforces a tag and attribute allowlist. Scripts,
   iframes, forms, event handlers, and ``javascript:``/``data:`` URLs
   get removed *before* any conversion.
3. ``markdownify`` converts the sanitized HTML to Markdown.

The order matters: sanitize *before* markdownify so that unsafe content
never reaches the Markdown serializer (which would otherwise emit raw
``<script>`` snippets when it sees them).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import bleach
from markdownify import markdownify
from readability import Document

from app.config import CLIP_MAX_BODY_BYTES


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


def extract_article(html: str, url: str | None = None) -> ExtractedArticle:
    """Run a raw HTML document through readability + bleach + markdownify.

    Raises ``ValueError`` if the body exceeds ``CLIP_MAX_BODY_BYTES``
    after extraction. Upstream network-level size limits already cap the
    raw HTML; this is the post-boilerplate-strip limit specified in the
    design doc.
    """
    doc = Document(html)
    title = (doc.short_title() or doc.title() or "").strip() or None
    summary_html = doc.summary(html_partial=True)

    safe_html = _sanitize_html(summary_html)
    md = markdownify(safe_html, heading_style="ATX", bullets="-").strip()

    if len(md.encode("utf-8")) > CLIP_MAX_BODY_BYTES:
        raise ValueError(
            f"Extracted body too large: {len(md.encode('utf-8'))} > {CLIP_MAX_BODY_BYTES}"
        )

    return ExtractedArticle(title=title, markdown=md)


def sanitize_pasted_html(html: str) -> str:
    """Entry point for the manual-paste fallback. Same bleach allowlist."""
    return _sanitize_html(html)
