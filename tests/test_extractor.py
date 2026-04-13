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
