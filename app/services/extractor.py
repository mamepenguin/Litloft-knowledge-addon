"""HTML → Markdown for webclips: the dispatcher and the public surface.

Extraction is a priority list. Site-specific extractors from
``app.services.extractors`` run first; whichever one claims the URL and
returns a usable body wins. Otherwise the generic two-pass pipeline
(trafilatura, then readability-lxml) runs. The pipeline shape and the
reasoning for each part live in ``extractors/base.py`` and
``extractors/generic.py``.

``extract_article`` never raises on empty output — it returns whatever is
best available, possibly empty. The worker classifies an empty result as
a permanent failure and surfaces the paste-HTML fallback UI instead of
writing a content-less ``.md``. An oversize body is different: that
raises, because "too big" is a distinct failure from "found nothing".
"""
from __future__ import annotations

import logging

from app.services.extractors import REGISTRY
from app.services.extractors.base import (
    MIN_BODY_BYTES,
    ExtractedArticle,
    body_bytes,
)
from app.services.extractors.generic import (
    extract_with_readability,
    extract_with_trafilatura,
    sanitize_html,
)
from app.services.extractors.preprocess import preprocess_html

logger = logging.getLogger(__name__)

__all__ = ["ExtractedArticle", "extract_article", "sanitize_pasted_html"]


def extract_article(html: str, url: str | None = None) -> ExtractedArticle:
    """Extract an article body via site-specific or generic extractors.

    Title preference: whichever generic pass produced the longer body
    wins its own title too. If only one returned anything, its title is
    used. If neither did, the result is ``title=None`` with empty
    markdown.
    """
    for extractor in REGISTRY:
        if not extractor.matches(url):
            continue
        try:
            article = extractor.extract(html, url or "")
        except Exception:
            # A site's DOM can change without notice. Degrading to the
            # generic pipeline is always better than failing the clip,
            # but log it: a site path that quietly stops matching looks
            # exactly like a site that got worse at being extracted.
            logger.warning(
                "site extractor %s failed, falling back to generic: url=%s",
                type(extractor).__name__,
                url,
                exc_info=True,
            )
            article = None
        if article is not None and body_bytes(article.markdown) >= MIN_BODY_BYTES:
            return article

    # Generic repairs run here rather than at the top of the function, so
    # site extractors see the document exactly as fetched. See
    # ``extractors/preprocess.py`` for why the ordering is load-bearing.
    # One pass, shared by both generic extractors.
    generic_html = preprocess_html(html)

    primary = extract_with_trafilatura(generic_html)
    if primary is not None and body_bytes(primary.markdown) >= MIN_BODY_BYTES:
        return primary

    fallback = extract_with_readability(generic_html)
    if fallback is not None and body_bytes(fallback.markdown) >= MIN_BODY_BYTES:
        return fallback

    # Both came up short. Return the best of what we have so the worker
    # can classify by length — if everything was None, hand back an empty
    # article for the same downstream treatment.
    candidates = [a for a in (primary, fallback) if a is not None]
    if not candidates:
        return ExtractedArticle(title=None, markdown="")
    return max(candidates, key=lambda a: body_bytes(a.markdown))


def sanitize_pasted_html(html: str) -> str:
    """Entry point for the manual-paste fallback. Same bleach allowlist."""
    return sanitize_html(html)
