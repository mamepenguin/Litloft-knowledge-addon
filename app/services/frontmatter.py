"""Parse and compose Markdown files with YAML frontmatter.

The format we accept and produce is the usual Jekyll/Hugo/Obsidian
convention::

    ---
    origin: detailed_summary
    source_file_ids:
      - "abc123"
    approved_at: "2026-04-21T12:00:00Z"
    ---

    # Title

    body…

The parser is deliberately small — PyYAML handles the frontmatter block
and everything after the closing ``---`` is treated as body. Missing
frontmatter is not an error; the resulting metadata is simply ``None``.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import yaml


@dataclass(frozen=True)
class ParsedMarkdown:
    metadata: dict[str, Any]
    body: str


_DELIM = "---"


def parse(content: str) -> ParsedMarkdown:
    """Split a ``.md`` string into frontmatter metadata and body.

    Returns ``ParsedMarkdown`` with ``metadata={}`` if the document has
    no frontmatter or the block is malformed (invalid YAML or an
    unclosed block). In the malformed case, the entire content is
    returned as ``body`` so downstream rendering still works.
    """
    # Allow an optional BOM / leading whitespace before the first delimiter.
    stripped = content.lstrip("\ufeff")
    if not stripped.startswith(_DELIM):
        return ParsedMarkdown(metadata={}, body=content)

    # The opening delimiter must be followed by a newline.
    after_open = stripped[len(_DELIM):]
    if not after_open.startswith("\n"):
        return ParsedMarkdown(metadata={}, body=content)

    rest = after_open[1:]
    # Look for the closing delimiter on its own line.
    lines = rest.split("\n")
    close_idx = None
    for i, line in enumerate(lines):
        if line.strip() == _DELIM:
            close_idx = i
            break
    if close_idx is None:
        # Unclosed block — treat as a plain document.
        return ParsedMarkdown(metadata={}, body=content)

    raw_yaml = "\n".join(lines[:close_idx])
    body = "\n".join(lines[close_idx + 1 :])
    # Strip a single leading newline from the body so `---\n\n# Title` looks clean.
    if body.startswith("\n"):
        body = body[1:]

    try:
        metadata = yaml.safe_load(raw_yaml) or {}
    except yaml.YAMLError:
        return ParsedMarkdown(metadata={}, body=content)

    if not isinstance(metadata, dict):
        return ParsedMarkdown(metadata={}, body=body)

    return ParsedMarkdown(metadata=metadata, body=body)


def compose(metadata: dict[str, Any], body: str) -> str:
    """Join a frontmatter dict and a body into a single Markdown string.

    Uses ``yaml.safe_dump`` with ``sort_keys=False`` so the caller
    controls ordering (important for humans scanning the frontmatter
    top-down).
    """
    if not metadata:
        return body
    dumped = yaml.safe_dump(
        metadata,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
    ).rstrip()
    return f"{_DELIM}\n{dumped}\n{_DELIM}\n\n{body}"


def strip(content: str) -> str:
    """Return the body of a Markdown document, discarding frontmatter.

    Convenience helper for renderers that want the body only.
    """
    return parse(content).body
