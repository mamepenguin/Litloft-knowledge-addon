"""Extractor + sanitizer tests.

Goal: verify that unsafe constructs (scripts, iframes, event handlers,
javascript: URLs) never leak through the readability → bleach →
markdownify pipeline, and that basic article structure survives.
"""
from __future__ import annotations

import pytest

from app.services.extractor import extract_article, sanitize_pasted_html


_BASIC_PAGE = """
<!doctype html>
<html><head><title>Sample Post</title></head>
<body>
  <nav><a href="/">home</a></nav>
  <article>
    <h1>Hello world</h1>
    <p>This is <strong>real</strong> content with a <a href="https://ok.example/x">link</a>.</p>
    <p>Another paragraph for body weight.</p>
    <ul><li>one</li><li>two</li></ul>
  </article>
  <footer>©</footer>
</body></html>
"""


def test_extract_preserves_article():
    art = extract_article(_BASIC_PAGE, "https://ok.example/")
    assert art.title == "Sample Post"
    assert "Hello world" in art.markdown
    assert "real" in art.markdown
    # readability may drop short boilerplate lists — don't assert on items


def test_sanitize_strips_script():
    dirty = "<p>ok</p><script>alert(1)</script><p>fine</p>"
    out = sanitize_pasted_html(dirty)
    assert "script" not in out.lower()
    assert "ok" in out
    assert "fine" in out


def test_sanitize_strips_iframe_and_handlers():
    dirty = '<p onclick="x()">hi</p><iframe src="x"></iframe>'
    out = sanitize_pasted_html(dirty)
    assert "iframe" not in out.lower()
    assert "onclick" not in out.lower()


def test_sanitize_rejects_javascript_url():
    dirty = '<a href="javascript:alert(1)">bad</a>'
    out = sanitize_pasted_html(dirty)
    assert "javascript:" not in out.lower()


def test_sanitize_keeps_http_links():
    dirty = '<a href="https://example.com">ok</a>'
    out = sanitize_pasted_html(dirty)
    assert "https://example.com" in out


def test_extract_rejects_oversize(monkeypatch):
    # Post-extraction body would exceed the cap
    monkeypatch.setattr("app.services.extractor.CLIP_MAX_BODY_BYTES", 100)
    big = _BASIC_PAGE.replace(
        "Another paragraph for body weight.",
        "x" * 500,
    )
    with pytest.raises(ValueError, match="too large"):
        extract_article(big, "https://ok.example/")


# ---------------------------------------------------------------------------
# Zenn-specific extractor tests
# ---------------------------------------------------------------------------

import json as _json


def _make_zenn_page(body_html: str, title: str = "Test Article") -> str:
    """Wrap ``body_html`` in a minimal Zenn-style Next.js page."""
    payload = _json.dumps({
        "props": {
            "pageProps": {
                "article": {
                    "title": title,
                    "bodyHtml": body_html,
                }
            }
        }
    })
    return (
        "<!doctype html><html><head></head><body>"
        f'<script id="__NEXT_DATA__" type="application/json">{payload}</script>'
        "</body></html>"
    )


def test_zenn_headings_are_clean():
    # Zenn injects <a aria-hidden="true"> inside every heading; after
    # stripping it the ## marker and text should be on the same line.
    html = _make_zenn_page(
        '<h2 id="sec">'
        '<a class="header-anchor-link" aria-hidden="true"></a>'
        " セクション見出し"
        "</h2>"
        "<p>本文です。</p>" * 5
    )
    art = extract_article(html, "https://zenn.dev/user/articles/abc123")
    assert "## セクション見出し" in art.markdown
    # The blank-line-between-## pattern must NOT appear
    assert "##\n\n" not in art.markdown
    assert "##\n " not in art.markdown


def test_zenn_blockquotes_rendered():
    html = _make_zenn_page(
        "<blockquote><p>これは引用文です。</p></blockquote>"
        "<p>通常の段落が続きます。</p>" * 5
    )
    art = extract_article(html, "https://zenn.dev/user/articles/abc123")
    assert "> これは引用文です" in art.markdown


def test_zenn_mermaid_converted_to_fenced_block():
    from urllib.parse import quote
    diagram = "graph TD\n    A --> B"
    html = _make_zenn_page(
        '<p>図の説明。</p>'
        f'<span class="embed-block zenn-embedded zenn-embedded-mermaid">'
        f'<iframe src="x" data-content="{quote(diagram)}"></iframe>'
        f'</span>'
        "<p>後続の段落。</p>" * 5
    )
    art = extract_article(html, "https://zenn.dev/user/articles/abc123")
    assert "```mermaid" in art.markdown
    assert "graph TD" in art.markdown
    assert "A --> B" in art.markdown


def test_zenn_code_block_with_filename():
    # Shiki-rendered code with a filename label
    html = _make_zenn_page(
        '<div class="code-block-container">'
        '<div class="code-block-filename-container">'
        '<span class="code-block-filename">app.ts</span>'
        "</div>"
        '<pre class="shiki github-dark">'
        '<code class="code-line">'
        '<span class="line"><span style="color:#fff">const x = 1;</span></span>'
        "</code></pre>"
        "</div>"
        "<p>説明文が続きます。</p>" * 5
    )
    art = extract_article(html, "https://zenn.dev/user/articles/abc123")
    assert "typescript:app.ts" in art.markdown
    assert "const x = 1;" in art.markdown


def test_zenn_inline_code_no_extra_newlines():
    # Inline <code> within a paragraph must not split the paragraph.
    html = _make_zenn_page(
        "<p>関数<code>foo()</code>と<code>bar()</code>を呼び出します。</p>" * 5
    )
    art = extract_article(html, "https://zenn.dev/user/articles/abc123")
    assert "`foo()`と`bar()`" in art.markdown or (
        "`foo()`" in art.markdown and "`bar()`" in art.markdown
    )
    # Neither inline code should appear on its own paragraph line
    lines = art.markdown.splitlines()
    for line in lines:
        stripped = line.strip()
        assert stripped != "`foo()`"
        assert stripped != "`bar()`"


def test_zenn_fallback_on_missing_next_data():
    # Pages without __NEXT_DATA__ should fall through to trafilatura/readability.
    art = extract_article(_BASIC_PAGE, "https://zenn.dev/user/articles/abc123")
    assert "Hello world" in art.markdown


def test_non_zenn_url_skips_zenn_path():
    # Non-Zenn URLs must not attempt the Zenn extractor.
    art = extract_article(_BASIC_PAGE, "https://example.com/post/1")
    assert "Hello world" in art.markdown
