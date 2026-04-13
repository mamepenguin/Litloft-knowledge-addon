"""Plain-text substring search helpers.

Kept separate from the router so the scanning logic can be unit-tested
without FastAPI plumbing.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_SNIPPET_RADIUS = 60   # characters of context on each side of the match
_MAX_SNIPPET_LEN = 200


@dataclass
class Snippet:
    text: str


def strip_frontmatter(content: str) -> str:
    """Remove a leading YAML frontmatter block if present.

    Matches ``---\\n...\\n---\\n`` at the very start of the file. A file
    without frontmatter is returned unchanged. We deliberately do NOT
    parse YAML — the cost is high for a search loop, and any string
    inside ``---`` blocks belongs to metadata we don't index per spec.
    """
    if not content.startswith("---"):
        return content
    # Find the closing fence on a line by itself
    m = re.search(r"^---\s*$", content[3:], flags=re.MULTILINE)
    if m is None:
        return content
    end = 3 + m.end()
    # Skip the trailing newline after closing fence
    if end < len(content) and content[end] == "\n":
        end += 1
    return content[end:]


def _compact_whitespace(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def find_snippet(body: str, query: str) -> Snippet | None:
    """Return a single best-effort snippet surrounding the first match.

    Case-insensitive substring match. Returns ``None`` if the query
    does not appear in ``body``.
    """
    if not query:
        return None
    lower = body.lower()
    q = query.lower()
    idx = lower.find(q)
    if idx == -1:
        return None

    start = max(0, idx - _SNIPPET_RADIUS)
    end = min(len(body), idx + len(query) + _SNIPPET_RADIUS)
    raw = body[start:end]
    compact = _compact_whitespace(raw)
    if len(compact) > _MAX_SNIPPET_LEN:
        compact = compact[: _MAX_SNIPPET_LEN - 1] + "…"
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(body) else ""
    return Snippet(text=f"{prefix}{compact}{suffix}")


def matches(body: str, query: str) -> bool:
    return bool(query) and query.lower() in body.lower()
