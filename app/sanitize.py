"""Frontmatter + filename helpers.

- ``build_frontmatter``: YAML-safe dump of clip metadata. We use
  ``safe_dump`` to avoid object tags and always prefix with ``---`` so
  the resulting string can be concatenated straight into a ``.md`` file.
- ``slugify_filename``: produces a path-safe ``.md`` filename from a
  page title or URL. Falls back to a timestamp if the input reduces to
  the empty string (e.g., title is pure emoji).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import yaml
from slugify import slugify


_MAX_FILENAME_LEN = 120  # conservative — leaves room for .md + numeric suffix


def build_frontmatter(data: dict[str, Any]) -> str:
    """Render a dict as a ``---``-delimited YAML frontmatter block.

    Values that are ``None`` are dropped to keep the block compact.
    """
    clean = {k: v for k, v in data.items() if v is not None}
    body = yaml.safe_dump(clean, allow_unicode=True, sort_keys=False).strip()
    return f"---\n{body}\n---\n"


def slugify_filename(title: str | None, fallback_hint: str = "clip") -> str:
    """Return a safe ``.md`` filename from a page title.

    Never returns a path — only a single component. Guaranteed to pass
    ``safepath.validate_filename`` for the core side.
    """
    raw = (title or "").strip()
    slug = slugify(raw, max_length=_MAX_FILENAME_LEN, word_boundary=True) if raw else ""
    if not slug:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        slug = f"{fallback_hint}-{ts}"
    return f"{slug}.md"
