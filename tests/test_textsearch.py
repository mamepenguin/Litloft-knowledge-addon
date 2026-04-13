"""Substring-search helpers unit tests."""
from __future__ import annotations

from app.services.textsearch import find_snippet, matches, strip_frontmatter


def test_strip_frontmatter_basic():
    doc = "---\ntitle: T\nstatus: ready\n---\nHello world"
    assert strip_frontmatter(doc) == "Hello world"


def test_strip_frontmatter_without_fence_returns_input():
    doc = "No frontmatter here"
    assert strip_frontmatter(doc) == doc


def test_strip_frontmatter_open_without_close_returns_input():
    doc = "---\ntitle: T\nHello"
    # No closing --- on its own line — we keep the whole document
    assert strip_frontmatter(doc).startswith("---")


def test_matches_case_insensitive():
    assert matches("Hello World", "hello")
    assert matches("Hello World", "WORLD")
    assert not matches("Hello World", "xyzzy")


def test_matches_empty_query():
    assert not matches("Hello", "")


def test_find_snippet_returns_surrounding_context():
    body = "alpha beta gamma delta epsilon zeta eta theta"
    s = find_snippet(body, "delta")
    assert s is not None
    assert "delta" in s.text


def test_find_snippet_adds_ellipsis_for_long_body():
    body = "a " * 100 + "needle" + " b" * 100
    s = find_snippet(body, "needle")
    assert s is not None
    assert s.text.startswith("…")
    assert s.text.endswith("…")


def test_find_snippet_none_when_absent():
    assert find_snippet("nothing here", "absent") is None


def test_find_snippet_empty_query_is_none():
    assert find_snippet("nothing here", "") is None
