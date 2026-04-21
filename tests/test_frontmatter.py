"""Tests for the frontmatter parse/compose helpers."""
from __future__ import annotations

from app.services.frontmatter import compose, parse, strip


class TestParse:
    def test_document_without_frontmatter(self):
        result = parse("# Hello\n\nbody\n")
        assert result.metadata == {}
        assert result.body == "# Hello\n\nbody\n"

    def test_basic_frontmatter(self):
        text = (
            "---\n"
            "origin: detailed_summary\n"
            "approved_at: '2026-04-21T12:00:00Z'\n"
            "---\n"
            "\n"
            "# Title\n"
            "\n"
            "body\n"
        )
        result = parse(text)
        assert result.metadata == {
            "origin": "detailed_summary",
            "approved_at": "2026-04-21T12:00:00Z",
        }
        assert result.body == "# Title\n\nbody\n"

    def test_source_file_ids_list(self):
        text = (
            "---\n"
            "source_file_ids:\n"
            "  - abc123\n"
            "  - def456\n"
            "---\n"
            "body\n"
        )
        result = parse(text)
        assert result.metadata == {"source_file_ids": ["abc123", "def456"]}

    def test_unclosed_block_falls_back_to_body(self):
        text = "---\norigin: detailed_summary\n# title\nbody\n"
        result = parse(text)
        assert result.metadata == {}
        # Malformed: the entire content survives as body so nothing is lost.
        assert result.body == text

    def test_invalid_yaml_is_swallowed(self):
        text = "---\n: : : not-valid\n---\nbody\n"
        result = parse(text)
        assert result.metadata == {}

    def test_leading_bom_tolerated(self):
        text = "\ufeff---\norigin: manual\n---\nbody\n"
        result = parse(text)
        assert result.metadata == {"origin": "manual"}
        assert result.body == "body\n"

    def test_array_scalar_metadata_falls_back(self):
        """A YAML block that parses to a list (not a dict) yields empty metadata."""
        text = "---\n- a\n- b\n---\nbody\n"
        result = parse(text)
        assert result.metadata == {}
        assert result.body == "body\n"


class TestCompose:
    def test_roundtrip(self):
        metadata = {
            "origin": "detailed_summary",
            "source_file_ids": ["abc123"],
        }
        body = "# Title\n\nbody\n"
        composed = compose(metadata, body)
        parsed = parse(composed)
        assert parsed.metadata == metadata
        assert parsed.body == body

    def test_empty_metadata_returns_body_only(self):
        assert compose({}, "body") == "body"

    def test_preserves_key_order(self):
        metadata = {
            "origin": "detailed_summary",
            "source_file_ids": ["x"],
            "approved_at": "2026-04-21T00:00:00Z",
        }
        composed = compose(metadata, "")
        # Order matters for readability — origin first, approved_at last.
        origin_idx = composed.find("origin:")
        sources_idx = composed.find("source_file_ids:")
        approved_idx = composed.find("approved_at:")
        assert origin_idx < sources_idx < approved_idx


class TestStrip:
    def test_strip_returns_body(self):
        text = "---\norigin: x\n---\n\nbody\n"
        assert strip(text) == "body\n"
