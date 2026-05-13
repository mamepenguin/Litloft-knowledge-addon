# Litloft Knowledge Addon

Notes and web clips for Litloft. Stores `.md` files at the drive root
(or any subfolder) and exposes them as a personal notes app. The drive
is the only scope — there is no separate "Vault" abstraction.

This is a Litloft addon and does not run standalone. It depends on the
core Litloft backend for file storage, access control, and drive
lookup via the Internal API.

## Quick start

1. Clone this repository into the Litloft project's `addons/` dir:

   ```
   cd path/to/video_share/addons
   git clone <this-repo-url> knowledge
   ```

2. Merge `docker-compose.override.yml.example` snippet into your
   Litloft `docker-compose.override.yml`.

3. Rebuild and restart:

   ```
   docker compose up -d --build
   ```

4. Open Litloft. A "Knowledge" entry appears in the sidebar once the
   container is healthy.

## Configuration

Environment variables (defaults in parentheses):

| Variable | Purpose |
|---|---|
| `KNOWLEDGE_DATA_DIR` (`/knowledge-data`) | SQLite DB and temp storage |
| `HOMEVAULT_INTERNAL_URL` (`http://backend:8000`) | Core Internal API base |
| `KNOWLEDGE_USER_AGENT` (browser UA) | Override User-Agent for web clip fetch |
| `KNOWLEDGE_WEBHOOK_SECRET` | Shared secret for lifecycle webhooks (see below) |
| `CORE_INTERNAL_SECRET` | Shared secret for content reads from core (see below) |
| `NOTE_SCANNER_INTERVAL_SECONDS` (`3600`) | Frontmatter reconcile scan cadence |

### Lifecycle webhook secret

The `files.missing` / `files.recovered` / `files.purged` webhooks mutate
`note_origin_sources` (the purge handler deletes rows). Without a shared
secret, any process on the Docker network could forge events and drop
data. Generate a secret and point both sides at it:

```
openssl rand -hex 32 > /dev/null  # example: copy into .env
```

Then in the core repo's `.env`:

```
KNOWLEDGE_WEBHOOK_SECRET=<generated-hex>
```

The `docker-compose.override.yml.example` snippet injects
`KNOWLEDGE_WEBHOOK_SECRET` into both the backend and knowledge
containers. In the core's `event-hooks.json`, each knowledge listener
needs `"secret_env": "KNOWLEDGE_WEBHOOK_SECRET"` so the core attaches
`X-Webhook-Secret` when dispatching.

### Core internal content secret

The note scanner periodically re-parses frontmatter of `.md` files to
keep `note_origins` in sync with external edits (a user
opening the note in Obsidian and changing `source_file_ids` etc.). It
runs without a user cookie, so it cannot use the cookie-gated
`/api/files/{id}/stream` route — ``.md`` on password-protected drives
would always 403.

`GET /api/internal/files/{id}/content` is the escape hatch: a
Docker-internal, text-only, size-capped endpoint that skips drive
unlock checks. Because it reads file contents unconditionally, it is
gated by `CORE_INTERNAL_SECRET` (shared between core and the knowledge
addon). Set the same generated secret on both sides:

```
CORE_INTERNAL_SECRET=<generated-hex>
```

If left unset, the gate no-ops (matching the dev-friendly default of
`KNOWLEDGE_WEBHOOK_SECRET`). Protected-drive scans still work while
unset; the secret is the production defence in depth so a misrouted
``/api/internal/*`` path cannot exfiltrate text files. 403/404 from
this endpoint are reported in the scanner's `protected_errors`
counter, separate from generic `errors`.

See `docs/superpowers/specs/2026-04-13-knowledge-addon.md` in the core
repo for the original design (the Vault abstraction described there has
since been removed; drive root is now the implicit scope).
