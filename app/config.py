"""Addon-wide configuration loaded from environment.

Kept minimal — knowledge has no user-facing config YAML today. Any future
tunables (e.g., UA override, webclip size limits) should land here rather
than being scattered across modules.
"""
import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("KNOWLEDGE_DATA_DIR", "/knowledge-data"))
DB_PATH = DATA_DIR / "knowledge.db"

HOMEVAULT_INTERNAL_URL = os.environ.get("HOMEVAULT_INTERNAL_URL", "http://backend:8000")

# Shared secret for calling core's gated internal endpoints (symmetric
# counterpart of ``KNOWLEDGE_WEBHOOK_SECRET``, which gates core→addon
# webhooks). Leave empty in dev to disable the gate; set the same value
# on both core and addon in production so the Docker network boundary
# isn't the only layer of defence on content-reading endpoints.
CORE_INTERNAL_SECRET = os.environ.get("CORE_INTERNAL_SECRET", "")

# Webclip fetcher settings
CLIP_DEFAULT_USER_AGENT = os.environ.get(
    "KNOWLEDGE_USER_AGENT",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
)
CLIP_HTTP_TIMEOUT_SEC = 20.0
CLIP_MAX_HTML_BYTES = 5 * 1024 * 1024
CLIP_MAX_BODY_BYTES = 500 * 1024
