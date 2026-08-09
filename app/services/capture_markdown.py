from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from app.schemas import SourceCaptureItem, SourceCaptureLocator
from app.services.frontmatter import compose, iso_z, parse


_CAPTURES_HEADING_RE = re.compile(r"^## Captures\s*$", re.MULTILINE)
_NEXT_H2_RE = re.compile(r"^## (?!#).+$", re.MULTILINE)


def _format_time(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _locator(capture: SourceCaptureItem) -> tuple[str, str]:
    locator: SourceCaptureLocator | None = capture.locator
    if locator is None:
        return "", ""
    if locator.seconds is not None:
        seconds = int(locator.seconds)
        return f"?t={seconds}", locator.label or _format_time(locator.seconds)
    if locator.page is not None:
        return f"?page={locator.page}", locator.label or f"page {locator.page}"
    return "", locator.label or ""


def _escape_link_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")


def _indented_lines(prefix: str, value: str) -> list[str]:
    return [f"{prefix}{line}" if line else prefix.rstrip() for line in value.splitlines()]


def render_capture(capture: SourceCaptureItem) -> str:
    query, label = _locator(capture)
    suffix = f" - {label}" if label else ""
    lines = [
        f"- [{_escape_link_label(capture.filename)}]"
        f"(loft://{capture.source_file_id}{query}){suffix}"
    ]
    quote = (capture.quote or "").strip()
    if quote:
        lines.extend(_indented_lines("  > ", quote))
    note = (capture.note or "").strip()
    if note:
        lines.append("")
        lines.extend(_indented_lines("  ", note))
    return "\n".join(lines)


def _source_ids(captures: list[SourceCaptureItem]) -> list[str]:
    return list(dict.fromkeys(item.source_file_id for item in captures))


def _capture_block(captures: list[SourceCaptureItem]) -> str:
    return "\n\n".join(render_capture(item) for item in captures)


def build_capture_note(title: str, captures: list[SourceCaptureItem]) -> str:
    metadata: dict[str, Any] = {
        "origin": "source_capture",
        "source_file_ids": _source_ids(captures),
        "created": iso_z(datetime.now(timezone.utc)),
    }
    body = f"# {title.strip()}\n\n## Captures\n\n{_capture_block(captures)}\n"
    return compose(metadata, body)


def _merge_source_ids(
    metadata: dict[str, Any], captures: list[SourceCaptureItem]
) -> dict[str, Any]:
    raw = metadata.get("source_file_ids")
    existing = [value for value in raw if isinstance(value, str)] if isinstance(raw, list) else []
    return {
        **metadata,
        "source_file_ids": list(dict.fromkeys([*existing, *_source_ids(captures)])),
    }


def _append_block_to_body(body: str, block: str) -> str:
    heading = _CAPTURES_HEADING_RE.search(body)
    if heading is None:
        prefix = body.rstrip()
        return f"{prefix}\n\n## Captures\n\n{block}\n" if prefix else f"## Captures\n\n{block}\n"

    next_heading = _NEXT_H2_RE.search(body, heading.end())
    insert_at = next_heading.start() if next_heading else len(body)
    before = body[:insert_at].rstrip()
    after = body[insert_at:].lstrip()
    updated = f"{before}\n\n{block}\n"
    if after:
        updated += f"\n{after}"
    return updated


def append_captures(content: str, captures: list[SourceCaptureItem]) -> str:
    parsed = parse(content)
    metadata = _merge_source_ids(dict(parsed.metadata), captures)
    body = _append_block_to_body(parsed.body, _capture_block(captures))
    return compose(metadata, body)
