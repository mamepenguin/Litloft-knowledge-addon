"""Thin HTTP client over HomeVault core's Internal API.

Used by the knowledge addon to discover which drives the current user
can access (so we can validate Vault registrations) and to perform the
core-side file operations we don't duplicate ourselves
(``POST /api/drives/{drive}/files``, ``PUT /api/files/{id}/content``).

The caller's Cookie string is passed through as the authorization
context: the core already understands ``hv_token`` (drive unlocks) and
``hv_viewer`` (profile identity), and the Generic Addon Proxy forwards
both cookies transparently.
"""
import httpx

from app.config import CORE_INTERNAL_SECRET, HOMEVAULT_INTERNAL_URL


class InternalAPIError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"{status_code}: {detail}")


class InternalClient:
    def __init__(self, cookie_header: str | None = None):
        self._cookie = cookie_header or ""

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self._cookie:
            headers["Cookie"] = self._cookie
        return headers

    async def accessible_drives(self) -> list[str]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{HOMEVAULT_INTERNAL_URL}/api/internal/accessible-drives",
                headers=self._headers(),
            )
        if r.status_code != 200:
            raise InternalAPIError(r.status_code, r.text)
        return list(r.json().get("drives", []))

    async def create_text_file(
        self, drive: str, path: str, content: str
    ) -> dict:
        """Create a new text file in the given drive via core POST /files."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{HOMEVAULT_INTERNAL_URL}/api/drives/{drive}/files",
                headers={**self._headers(), "Content-Type": "application/json"},
                json={"path": path, "content": content},
            )
        if r.status_code not in (200, 201):
            raise InternalAPIError(r.status_code, r.text)
        return r.json()

    async def put_file_content(
        self, file_id: str, content: str, if_match: str
    ) -> str:
        """Write file content with optimistic concurrency. Returns new ETag."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.put(
                f"{HOMEVAULT_INTERNAL_URL}/api/files/{file_id}/content",
                headers={
                    **self._headers(),
                    "Content-Type": "text/plain; charset=utf-8",
                    "If-Match": if_match,
                },
                content=content.encode("utf-8"),
            )
        if r.status_code != 200:
            raise InternalAPIError(r.status_code, r.text)
        return r.headers.get("etag", "")

    async def get_file(self, file_id: str) -> dict:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{HOMEVAULT_INTERNAL_URL}/api/internal/files/{file_id}",
                headers=self._headers(),
            )
        if r.status_code != 200:
            raise InternalAPIError(r.status_code, r.text)
        return r.json()

    async def list_drive_files(
        self, drive: str, path: str, *, limit: int = 500
    ) -> list[dict]:
        """List files under ``drive/path`` via the core's paginated route.

        Returns the ``data`` array from the core response. The caller
        is responsible for filtering to text files — this just forwards
        the drive listing with access control intact.
        """
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(
                f"{HOMEVAULT_INTERNAL_URL}/api/drives/{drive}/files",
                headers=self._headers(),
                params={
                    "path": path,
                    "limit": limit,
                    "sort": "title",
                    "order": "asc",
                },
            )
        if r.status_code != 200:
            raise InternalAPIError(r.status_code, r.text)
        return list(r.json().get("data", []))

    async def get_file_content(self, file_id: str) -> str:
        """Fetch the raw text content of a file via the core stream route.

        Used by the webclip worker when it needs the current ETag basis
        for its If-Match PUT. Returns the decoded UTF-8 string.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(
                f"{HOMEVAULT_INTERNAL_URL}/api/files/{file_id}/stream",
                headers=self._headers(),
            )
        if r.status_code != 200:
            raise InternalAPIError(r.status_code, r.text)
        return r.text

    async def get_file_text_content(self, file_id: str) -> str:
        """Fetch a file's text content via the gated internal endpoint.

        Unlike ``get_file_content`` this path goes through
        ``/api/internal/files/{id}/content``, which is Docker-internal
        only and bypasses the ``hv_token`` drive-unlock check. The note
        scanner runs without any user cookie and must still be able to
        read ``.md`` files on password-protected drives — this is the
        escape hatch for that case.

        Auth: optional shared secret via ``X-Internal-Secret``. Matches
        the ``KNOWLEDGE_WEBHOOK_SECRET`` pattern in reverse direction;
        when unset on both sides the endpoint behaves like the other
        unsecret internal routes (relies on Docker network isolation).
        """
        headers: dict[str, str] = {}
        if CORE_INTERNAL_SECRET:
            headers["X-Internal-Secret"] = CORE_INTERNAL_SECRET
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(
                f"{HOMEVAULT_INTERNAL_URL}/api/internal/files/{file_id}/content",
                headers=headers,
            )
        if r.status_code != 200:
            raise InternalAPIError(r.status_code, r.text)
        return r.text

    async def create_file_relation(
        self,
        file_id_a: str,
        file_id_b: str,
        kind: str = "related",
        viewer_id: str | None = None,
    ) -> dict:
        """Register a relation between two files (same drive only).

        Uses POST /api/internal/file_relations. 409 is swallowed by the
        caller when the relation may already exist (re-promote scenario).
        """
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{HOMEVAULT_INTERNAL_URL}/api/internal/file_relations",
                headers={**self._headers(), "Content-Type": "application/json"},
                json={
                    "file_id_a": file_id_a,
                    "file_id_b": file_id_b,
                    "kind": kind,
                    "viewer_id": viewer_id,
                },
            )
        if r.status_code not in (201, 409):
            raise InternalAPIError(r.status_code, r.text)
        return r.json() if r.status_code == 201 else {}

    async def set_file_active_summary(
        self, file_id: str, summary_file_id: str
    ) -> dict:
        """UPSERT the active summary pointer for a file."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{HOMEVAULT_INTERNAL_URL}/api/internal/file_active_summary",
                headers={**self._headers(), "Content-Type": "application/json"},
                json={
                    "file_id": file_id,
                    "summary_file_id": summary_file_id,
                },
            )
        if r.status_code != 200:
            raise InternalAPIError(r.status_code, r.text)
        return r.json()

    async def fetch_bulk_state(self, file_ids: list[str]) -> dict:
        """Bulk-resolve lifecycle state (active / missing / trash) for
        each ``file_id``.

        Returns the full JSON envelope::

            {
              "statuses": [{"id", "drive", "state"}, ...],
              "not_found": [...]
            }

        ``not_found`` IDs have been physically purged. Called from the
        lifecycle webhook handlers to reconcile ``note_origins.health``.
        No cookie is needed — Internal API is service-to-service.
        """
        if not file_ids:
            return {"statuses": [], "not_found": []}
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{HOMEVAULT_INTERNAL_URL}/api/internal/files/bulk-state",
                headers={"Content-Type": "application/json"},
                json={"file_ids": file_ids},
            )
        if r.status_code != 200:
            raise InternalAPIError(r.status_code, r.text)
        return r.json()

    async def emit_addon_event(
        self,
        event: str,
        data: dict,
        drive: str | None = None,
    ) -> None:
        """Forward a WebSocket event to connected clients.

        The core ``/api/internal/addon-events`` endpoint relays the
        payload to its WS broadcaster. Failures are swallowed — the
        event is a UX refinement, not a correctness requirement.
        """
        payload: dict[str, object] = {"event": event, "data": data}
        if drive is not None:
            payload["drive"] = drive
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                await client.post(
                    f"{HOMEVAULT_INTERNAL_URL}/api/internal/addon-events",
                    headers={**self._headers(), "Content-Type": "application/json"},
                    json=payload,
                )
        except httpx.HTTPError:
            return
