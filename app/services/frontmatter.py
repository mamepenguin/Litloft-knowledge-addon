"""Parse and compose Markdown files with YAML frontmatter.

The format we accept and produce is the usual Jekyll/Hugo/Obsidian
convention::

    ---
    origin: detailed_summary
    source_file_ids:
      - "abc123"
    created: "2026-04-21T12:00:00Z"
    ---

    # Title

    body…

The parser is deliberately small — PyYAML handles the frontmatter block
and everything after the closing ``---`` is treated as body. Missing
frontmatter is not an error; the resulting metadata is simply ``None``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import yaml


_ID_RE = re.compile(r"^\d{12,17}$")


def _coerce_valid_id(value: Any) -> str | None:
    if isinstance(value, str):
        candidate = value
    elif isinstance(value, int) and not isinstance(value, bool):
        candidate = str(value)
    else:
        return None
    return candidate if _ID_RE.match(candidate) else None


def ensure_id(
    metadata: dict[str, Any],
    existing_id: str | None = None,
    now: datetime | None = None,
) -> tuple[dict[str, Any], str]:
    """Return ``(new_metadata, id_value)`` with a valid ``id:`` key.

    Behaviour-compatible with ``backend/app/services/frontmatter.ensure_id``
    (parallel implementation — separate containers cannot share code).
    Pure / immutable: ``metadata`` is never mutated; a new dict with
    ``id`` as the first key is returned.
    """
    preserved = _coerce_valid_id(metadata.get("id"))
    if preserved is not None:
        new_id = preserved
    elif (reused := _coerce_valid_id(existing_id)) is not None:
        new_id = reused
    else:
        moment = now if now is not None else datetime.now(timezone.utc)
        new_id = moment.strftime("%Y%m%d%H%M%S")

    rest = {k: v for k, v in metadata.items() if k != "id"}
    new_metadata = {"id": new_id, **rest}
    return new_metadata, new_id


@dataclass(frozen=True)
class ParsedMarkdown:
    metadata: dict[str, Any]
    body: str


_DELIM = "---"


def iso_z(dt: datetime) -> str:
    """Render a datetime as ISO 8601 with Z suffix, second precision.

    Our frontmatter convention (spec 2026-04-24): UTC, no sub-second
    noise, trailing ``Z`` instead of ``+00:00``. Naive datetimes are
    assumed to already be UTC; aware ones are converted.

    Example: ``datetime.now(UTC)`` → ``"2026-04-22T11:38:38Z"``.
    """
    if dt.tzinfo is None:
        aware = dt.replace(tzinfo=timezone.utc)
    else:
        aware = dt.astimezone(timezone.utc)
    return aware.replace(microsecond=0).isoformat().replace("+00:00", "Z")


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

    # Mirror the core parser's broad except (backend/app/services/frontmatter.py):
    # ``safe_load`` may surface ``RecursionError`` / ``MemoryError`` on
    # pathological input, which are not ``YAMLError`` subclasses. The parse
    # failure contract is "never crash the caller".
    try:
        metadata = yaml.safe_load(raw_yaml) or {}
    except Exception:
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
