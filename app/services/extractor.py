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

import json
from dataclasses import dataclass
from typing import Optional
from urllib.parse import unquote, urlparse

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

# Common filename extension → fenced-code language identifier
_EXT_TO_LANG: dict[str, str] = {
    "ts": "typescript", "tsx": "tsx", "js": "javascript", "jsx": "jsx",
    "py": "python", "rb": "ruby", "go": "go", "rs": "rust",
    "java": "java", "cs": "csharp", "cpp": "cpp", "c": "c",
    "kt": "kotlin", "swift": "swift", "sh": "bash", "bash": "bash",
    "yaml": "yaml", "yml": "yaml", "json": "json", "html": "html",
    "css": "css", "scss": "scss", "sql": "sql", "toml": "toml",
    "xml": "xml", "php": "php", "vue": "vue", "svelte": "svelte",
    "dart": "dart", "ex": "elixir", "exs": "elixir",
}


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


# ---------------------------------------------------------------------------
# Zenn-specific extractor
# ---------------------------------------------------------------------------

def _is_zenn_url(url: str | None) -> bool:
    if not url:
        return False
    try:
        host = urlparse(url).hostname or ""
        return host == "zenn.dev" or host.endswith(".zenn.dev")
    except Exception:
        return False


def _remove_lxml_element_keep_tail(el) -> None:
    """Remove an lxml element and preserve its trailing text (tail)."""
    parent = el.getparent()
    if parent is None:
        return
    tail = el.tail or ""
    prev = el.getprevious()
    if prev is None:
        parent.text = (parent.text or "") + tail
    else:
        prev.tail = (prev.tail or "") + tail
    parent.remove(el)


def _shiki_to_plain(pre_el) -> str:
    """Extract plain text from a Shiki-rendered ``<pre>`` element."""
    code = pre_el.find(".//code")
    if code is None:
        return ""
    lines = code.xpath('.//span[contains(@class,"line")]')
    if lines:
        return "\n".join(line.text_content() for line in lines).rstrip("\n")
    return code.text_content()


def _preprocess_zenn_body(body_html: str) -> str:
    """Transform Zenn ``bodyHtml`` into clean HTML suitable for markdownify.

    Handles three Zenn-specific patterns that generic extractors miss:
    - ``<a aria-hidden>`` inside headings (causes blank H2/H3 lines)
    - Mermaid content embedded in iframe ``data-content`` attributes
    - Shiki-rendered code blocks (colored ``<span>`` tokens) with optional
      filename labels in a sibling ``<div class="code-block-filename-container">``
    """
    from lxml import etree
    from lxml import html as lhtml

    doc = lhtml.fromstring(f"<div>{body_html}</div>")

    # Strip aria-hidden anchor links from headings. Zenn injects
    # <a class="header-anchor-link" aria-hidden="true"></a> before every
    # heading text; trafilatura renders this as an empty ## line followed
    # by the text on the next line. _remove_lxml_element_keep_tail re-attaches
    # the tail text (the actual heading text) to the parent element.
    for anchor in doc.xpath(
        ".//*[self::h1 or self::h2 or self::h3"
        " or self::h4 or self::h5 or self::h6]"
        "//a[@aria-hidden]"
    ):
        _remove_lxml_element_keep_tail(anchor)

    # Convert Zenn-embedded Mermaid diagrams to fenced code blocks.
    # Zenn renders mermaid as:
    #   <span class="zenn-embedded-mermaid">
    #     <iframe data-content="URL-encoded mermaid source" ...>
    #   </span>
    for span in doc.xpath('.//span[contains(@class,"zenn-embedded-mermaid")]'):
        iframe = span.find(".//iframe")
        if iframe is not None:
            data_content = iframe.get("data-content", "")
            if data_content:
                mermaid_src = unquote(data_content)
                new_pre = etree.Element("pre")
                new_code = etree.SubElement(new_pre, "code")
                new_code.set("class", "language-mermaid")
                new_code.text = mermaid_src
                new_pre.tail = span.tail or ""
                parent = span.getparent()
                if parent is not None:
                    idx = list(parent).index(span)
                    parent.remove(span)
                    parent.insert(idx, new_pre)

    # Fix Shiki code blocks: strip color spans → plain text, and promote
    # the filename label from its sibling div into a data-filename attribute
    # on <pre> for the markdownify code_language_callback to pick up.
    # Zenn structure:
    #   <div class="code-block-container">
    #     [<div class="code-block-filename-container">
    #        <span class="code-block-filename">order.ts</span>
    #     </div>]
    #     <pre class="shiki ..."><code>
    #       <span class="line"><span style="color:...">token</span>...
    #     </code></pre>
    #   </div>
    for container in doc.xpath('.//div[contains(@class,"code-block-container")]'):
        fname_spans = container.xpath(
            './/span[contains(@class,"code-block-filename")]'
        )
        filename = fname_spans[0].text_content().strip() if fname_spans else None

        pre = container.find(".//pre")
        if pre is None:
            continue

        plain = _shiki_to_plain(pre)

        new_pre = etree.Element("pre")
        if filename:
            new_pre.set("data-filename", filename)
        new_code = etree.SubElement(new_pre, "code")
        new_code.text = plain
        new_pre.tail = container.tail or ""

        parent = container.getparent()
        if parent is not None:
            idx = list(parent).index(container)
            parent.remove(container)
            parent.insert(idx, new_pre)

    # Re-serialise inner HTML without the synthetic wrapper <div>.
    parts: list[str] = []
    if doc.text:
        parts.append(doc.text)
    for child in doc:
        parts.append(etree.tostring(child, encoding="unicode", method="html"))
        if child.tail:
            parts.append(child.tail)
    return "".join(parts)


def _zenn_code_lang_cb(el) -> str:
    """markdownify ``code_language_callback`` for Zenn code blocks.

    Reads ``data-filename`` set by ``_preprocess_zenn_body`` and infers
    the language from the filename extension so the fenced block renders
    as ``\\`\\`\\`typescript:order.type.ts`` in Zenn's style.
    """
    filename = el.get("data-filename") or ""

    code = el.find("code")
    lang = ""
    if code is not None:
        classes = code.get("class") or []
        for c in classes:
            if c.startswith("language-"):
                lang = c[9:]
                break

    if not lang and filename:
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        lang = _EXT_TO_LANG.get(ext, "")

    if filename:
        return f"{lang}:{filename}" if lang else filename
    return lang


def _extract_zenn(html: str, url: str) -> Optional[ExtractedArticle]:
    """Zenn-specific fast path: reads ``bodyHtml`` from ``__NEXT_DATA__``.

    Zenn is a Next.js app that embeds the fully-rendered article HTML in
    a JSON blob inside ``<script id="__NEXT_DATA__">``. Trafilatura and
    readability operate on the whole page DOM and miss Zenn-specific
    constructs (Shiki code blocks, mermaid iframes, aria-hidden anchors
    in headings). This path extracts the clean ``bodyHtml`` directly and
    converts it with a customised markdownify pass.

    Returns ``None`` on any parse failure so ``extract_article`` can fall
    through to the generic trafilatura / readability pipeline.
    """
    nd_pos = html.find("__NEXT_DATA__")
    if nd_pos < 0:
        return None
    brace = html.find("{", nd_pos)
    script_end = html.find("</script>", brace)
    if brace < 0 or script_end < 0:
        return None

    try:
        data = json.loads(html[brace:script_end])
        page_article = data["props"]["pageProps"]["article"]
        body_html: str = page_article.get("bodyHtml", "")
        title: Optional[str] = (page_article.get("title") or "").strip() or None
    except (json.JSONDecodeError, KeyError, TypeError):
        return None

    if not body_html:
        return None

    try:
        clean_html = _preprocess_zenn_body(body_html)
    except Exception:
        clean_html = body_html

    md = markdownify(
        clean_html,
        heading_style="ATX",
        bullets="-",
        code_language_callback=_zenn_code_lang_cb,
    ).strip()

    if not md:
        return None

    _enforce_size_ceiling(md)
    return ExtractedArticle(title=title, markdown=md)


# ---------------------------------------------------------------------------
# Generic extractors
# ---------------------------------------------------------------------------

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
    """Extract article body via site-specific or generic extractors.

    Tries extractors in priority order:
    1. Zenn-specific (reads ``__NEXT_DATA__`` bodyHtml for zenn.dev)
    2. trafilatura (generic multilingual)
    3. readability-lxml + markdownify (generic fallback)

    Never raises on empty output — returns an ``ExtractedArticle`` whose
    ``markdown`` may be empty if all passes fail. The worker inspects
    ``markdown`` length and fails the job permanently when it's below
    ``_MIN_BODY_BYTES`` so the user sees the paste-HTML retry UI
    instead of a frontmatter-only ``.md``.

    Title preference: whichever pass produced the longer body wins its
    own title too. If only one pass returned anything, we use its
    title. If neither did, the returned article has ``title=None`` and
    empty markdown.
    """
    # Fast path for Zenn — their DOM structure defeats generic extractors.
    if url and _is_zenn_url(url):
        try:
            zenn = _extract_zenn(html, url)
        except Exception:
            zenn = None
        if zenn is not None and _body_bytes(zenn.markdown) >= _MIN_BODY_BYTES:
            return zenn

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
