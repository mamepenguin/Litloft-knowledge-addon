"""Site-specific webclip extractors, tried before the generic pipeline.

Registration is a plain list. There is no dynamic loading, no manifest
and no entry-point scan: every extractor lives in this repository and is
written by the same people who maintain the dispatcher, so a mechanism
priced for third-party authors would be pure overhead. Adding a site is
one module here, one fixture and one test.

Order matters only in that the first match wins. Keep entries
disjoint by hostname.
"""
from __future__ import annotations

from app.services.extractors.base import SiteExtractor
from app.services.extractors.sites.zenn import ZennExtractor

REGISTRY: tuple[SiteExtractor, ...] = (
    ZennExtractor(),
)

__all__ = ["REGISTRY", "SiteExtractor"]
