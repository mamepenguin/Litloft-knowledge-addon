"""Frontmatter + filename helper tests."""
from __future__ import annotations

import re

from app.sanitize import build_frontmatter, slugify_filename


def test_frontmatter_wraps_in_delimiters():
    out = build_frontmatter({"url": "https://a.example", "status": "ready"})
    assert out.startswith("---\n")
    assert out.rstrip().endswith("---")
    assert "url: https://a.example" in out
    assert "status: ready" in out


def test_frontmatter_drops_none():
    out = build_frontmatter({"url": "x", "title": None})
    assert "title" not in out
    assert "url: x" in out


def test_frontmatter_is_safe_yaml():
    # No !!python tags even when we hand it weird types
    out = build_frontmatter({"x": "plain", "nested": {"a": 1}})
    assert "!!python" not in out


def test_slugify_basic():
    assert slugify_filename("Hello World") == "hello-world.md"


def test_slugify_handles_unicode():
    out = slugify_filename("こんにちは world")
    assert out.endswith(".md")
    assert "/" not in out
    assert "\\" not in out


def test_slugify_fallback_for_empty():
    out = slugify_filename("")
    assert re.match(r"clip-\d{8}-\d{6}\.md", out)


def test_slugify_length_cap():
    out = slugify_filename("a" * 500)
    assert len(out) <= 125  # 120 + ".md" margin
