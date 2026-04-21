# HomeVault Knowledge Addon

Notes and web clips for HomeVault. Stores `.md` files on any drive using
the Obsidian Vault concept: each user configures one or more "root
folders" (Vaults) and the addon shows those like a personal notes app.

This is a HomeVault addon and does not run standalone. It depends on the
core HomeVault backend for file storage, access control, and drive
lookup via the Internal API.

## Quick start

1. Clone this repository into the HomeVault project's `addons/` dir:

   ```
   cd path/to/video_share/addons
   git clone <this-repo-url> knowledge
   ```

2. Merge `docker-compose.override.yml.example` snippet into your
   HomeVault `docker-compose.override.yml`.

3. Rebuild and restart:

   ```
   docker compose up -d --build
   ```

4. Open HomeVault. A "Knowledge" entry appears in the sidebar once the
   container is healthy.

## Configuration

Environment variables (defaults in parentheses):

| Variable | Purpose |
|---|---|
| `KNOWLEDGE_DATA_DIR` (`/knowledge-data`) | SQLite DB and temp storage |
| `HOMEVAULT_INTERNAL_URL` (`http://backend:8000`) | Core Internal API base |
| `KNOWLEDGE_USER_AGENT` (browser UA) | Override User-Agent for web clip fetch |
| `KNOWLEDGE_WEBHOOK_SECRET` | Shared secret for lifecycle webhooks (see below) |
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

## Status

Phase in progress:

- [x] P2 scaffolding (DB, auth, safepath, Internal API client, /health)
- [ ] P3 Vault CRUD + initial setup UI + file list
- [ ] P4 Editor with auto-save + ETag conflict detection
- [ ] P5 Web clip pipeline (SSRF-safe fetcher + async worker)
- [ ] P6 Slot components (sidebar link, file-detail edit button)
- [ ] P7 Vault-scoped full-text search

See `docs/superpowers/specs/2026-04-13-knowledge-addon.md` in the core
repo for the full design.
