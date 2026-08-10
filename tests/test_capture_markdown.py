from __future__ import annotations

from app.schemas import SourceCaptureItem, SourceCaptureLocator
from app.services.capture_markdown import (
    append_captures,
    build_capture_note,
    render_capture,
)
from app.services.frontmatter import parse


def _capture(**overrides) -> SourceCaptureItem:
    values = {
        "source_file_id": "abc123def456",
        "filename": "Lecture.mp4",
        "file_type": "video",
        "kind": "transcript",
        "locator": {"seconds": 125, "end_seconds": 132},
        "quote": "A source-backed statement.",
        "note": "Verify this later.",
    }
    values.update(overrides)
    return SourceCaptureItem.model_validate(values)


def test_render_capture_keeps_timestamp_quote_and_note() -> None:
    rendered = render_capture(_capture())

    assert "[Lecture.mp4](loft://abc123def456?t=125)" in rendered
    assert "02:05" in rendered
    assert "> A source-backed statement." in rendered
    assert "Verify this later." in rendered


def test_build_capture_note_adds_frontmatter_and_deduplicates_sources() -> None:
    content = build_capture_note(
        "Research notes",
        [_capture(), _capture(note="Second observation")],
    )
    parsed = parse(content)

    assert parsed.metadata["origin"] == "source_capture"
    assert parsed.metadata["source_file_ids"] == ["abc123def456"]
    assert "# Research notes" in parsed.body
    assert "## Captures" in parsed.body


def test_append_preserves_frontmatter_and_merges_source_ids() -> None:
    existing = (
        "---\n"
        "title: Existing\n"
        "tags:\n"
        "- research\n"
        "source_file_ids:\n"
        "- old000000001\n"
        "---\n\n"
        "# Existing\n\nBody.\n"
    )

    updated = append_captures(existing, [_capture()])
    parsed = parse(updated)

    assert parsed.metadata["title"] == "Existing"
    assert parsed.metadata["tags"] == ["research"]
    assert parsed.metadata["source_file_ids"] == [
        "old000000001",
        "abc123def456",
    ]
    assert parsed.body.startswith("# Existing\n\nBody.")
    assert parsed.body.count("## Captures") == 1


def test_append_uses_existing_captures_section_before_next_h2() -> None:
    existing = "# Note\n\n## Captures\n\nOld capture.\n\n## Analysis\n\nKeep me.\n"

    updated = append_captures(existing, [_capture()])

    assert updated.count("## Captures") == 1
    assert updated.index("Lecture.mp4") < updated.index("## Analysis")


def test_page_locator_uses_page_query() -> None:
    capture = _capture(
        file_type="document",
        locator=SourceCaptureLocator(page=7, label="page 7"),
    )
    assert "loft://abc123def456?page=7" in render_capture(capture)


def test_document_selection_keeps_markdown_heading_without_url_fragment() -> None:
    capture = _capture(
        filename="Guide.md",
        file_type="document",
        kind="document_selection",
        locator=SourceCaptureLocator(label="Installation"),
        quote="Run the installer.",
    )

    rendered = render_capture(capture)
    assert "[Guide.md](loft://abc123def456) - Installation" in rendered
    assert "> Run the installer." in rendered


def test_pdf_page_fallback_needs_no_quote() -> None:
    capture = _capture(
        filename="Scan.pdf",
        file_type="document",
        kind="pdf_page",
        locator=SourceCaptureLocator(page=4),
        quote=None,
        note=None,
    )

    rendered = render_capture(capture)
    assert rendered == "- [Scan.pdf](loft://abc123def456?page=4) - page 4"
