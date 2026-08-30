"""Zenn (zenn.dev) — article shape.

Zenn is a Next.js app that embeds the fully-rendered article HTML in a
JSON blob inside ``<script id="__NEXT_DATA__">``. trafilatura and
readability operate on the whole page DOM and miss Zenn-specific
constructs (Shiki code blocks, mermaid iframes, aria-hidden anchors in
headings), so this path reads ``bodyHtml`` directly and converts it with
a customised markdownify pass.

Fidelity policy: Zenn authors write Markdown into an open frame, so the
source order is authorial and is preserved. Compare ``sites/cookien``,
where the site imposes a fixed record and reordering recovers a
structure the page flattened.
"""
from __future__ import annotations

import json
from typing import Optional
from urllib.parse import unquote

from markdownify import markdownify

from app.services.extractors.base import (
    ExtractedArticle,
    enforce_size_ceiling,
    host_matches,
)

_HOSTNAMES = frozenset({"zenn.dev"})

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


def _preprocess_body(body_html: str) -> str:
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


def _code_lang_cb(el) -> str:
    """markdownify ``code_language_callback`` for Zenn code blocks.

    Reads ``data-filename`` set by ``_preprocess_body`` and infers the
    language from the filename extension so the fenced block renders as
    ``\\`\\`\\`typescript:order.type.ts`` in Zenn's style.
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


class ZennExtractor:
    """Reads ``bodyHtml`` out of ``__NEXT_DATA__``.

    Returns ``None`` on any parse failure so the dispatcher falls through
    to the generic pipeline. An oversize body raises out of
    ``enforce_size_ceiling`` into the dispatcher's catch-all, which has
    the same net effect (generic runs, and raises in turn on the same
    page). That is the pre-refactor behaviour, kept deliberately.
    """

    def matches(self, url: str | None) -> bool:
        return host_matches(url, _HOSTNAMES)

    def extract(self, html: str, url: str) -> Optional[ExtractedArticle]:
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
            clean_html = _preprocess_body(body_html)
        except Exception:
            clean_html = body_html

        md = markdownify(
            clean_html,
            heading_style="ATX",
            bullets="-",
            code_language_callback=_code_lang_cb,
        ).strip()

        if not md:
            return None

        enforce_size_ceiling(md)
        return ExtractedArticle(title=title, markdown=md)
