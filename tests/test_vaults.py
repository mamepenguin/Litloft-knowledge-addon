"""Tests for /vaults CRUD (drive-scoped).

Contract:
- Every request must carry ``X-Lit-Drive`` (400 otherwise)
- Every write requires a valid lit_viewer cookie (401 otherwise)
- Every route is scoped to ``(viewer_id, drive)``
- Clients cannot supply viewer_id in body or query (it is never read from
  the request payload — only from the cookie)
- ``body.drive`` must match the ``X-Lit-Drive`` header (403 on mismatch)
- Vault creation validates that the target drive is accessible via the
  core's Internal API
- Active Vault state is per-(viewer_id, drive): switching drives does
  not reveal or change the other drive's active selection.
"""
from app.auth import nickname_to_viewer_id


def _hdr(
    nickname: str = "alice", drive: str | None = "test-drive"
) -> dict[str, str]:
    h: dict[str, str] = {"Cookie": f"lit_viewer={nickname}"}
    if drive is not None:
        h["X-Lit-Drive"] = drive
    return h


class TestListVaults:
    def test_empty_list(self, client, fake_internal):
        r = client.get("/vaults", headers=_hdr())
        assert r.status_code == 200
        assert r.json() == {"vaults": [], "active_vault_id": None}

    def test_401_without_cookie(self, client, fake_internal):
        r = client.get("/vaults", headers={"X-Lit-Drive": "test-drive"})
        assert r.status_code == 401

    def test_400_without_drive_header(self, client, fake_internal):
        r = client.get("/vaults", headers={"Cookie": "lit_viewer=alice"})
        assert r.status_code == 400


class TestCreateVault:
    def test_creates_first_vault_and_auto_activates(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers=_hdr(),
            json={"label": "Personal", "drive": "test-drive", "path": "Notes"},
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["label"] == "Personal"
        assert data["drive"] == "test-drive"
        assert data["path"] == "Notes"
        assert data["is_active"] is True

    def test_body_drive_must_match_header(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers=_hdr(drive="test-drive"),
            json={"label": "Mismatch", "drive": "media", "path": "x"},
        )
        assert r.status_code == 403

    def test_second_vault_in_same_drive_does_not_auto_activate(
        self, client, fake_internal
    ):
        client.post(
            "/vaults",
            headers=_hdr(),
            json={"label": "Personal", "drive": "test-drive", "path": "Notes"},
        )
        r = client.post(
            "/vaults",
            headers=_hdr(),
            json={"label": "Work", "drive": "test-drive", "path": "Work"},
        )
        assert r.status_code == 201
        assert r.json()["is_active"] is False

    def test_first_vault_in_each_drive_auto_activates_independently(
        self, client, fake_internal
    ):
        """Switching drives does not prevent auto-activation of the first
        Vault in the new drive."""
        r1 = client.post(
            "/vaults",
            headers=_hdr(drive="test-drive"),
            json={"label": "A", "drive": "test-drive", "path": "Notes"},
        )
        r2 = client.post(
            "/vaults",
            headers=_hdr(drive="media"),
            json={"label": "B", "drive": "media", "path": "Media"},
        )
        assert r1.json()["is_active"] is True
        assert r2.json()["is_active"] is True

    def test_rejects_inaccessible_drive(self, client, fake_internal):
        fake_internal.accessible_drives_override = ["media"]
        r = client.post(
            "/vaults",
            headers=_hdr(drive="secret-drive"),
            json={"label": "Secret", "drive": "secret-drive", "path": ""},
        )
        assert r.status_code == 403

    def test_rejects_path_traversal(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers=_hdr(),
            json={"label": "Bad", "drive": "test-drive", "path": "../etc"},
        )
        assert r.status_code == 400

    def test_rejects_absolute_path(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers=_hdr(),
            json={"label": "Bad", "drive": "test-drive", "path": "/etc"},
        )
        assert r.status_code == 400

    def test_rejects_duplicate_location(self, client, fake_internal):
        payload = {"label": "A", "drive": "test-drive", "path": "Notes"}
        client.post("/vaults", headers=_hdr(), json=payload)
        r = client.post("/vaults", headers=_hdr(), json={**payload, "label": "B"})
        assert r.status_code == 409

    def test_same_location_allowed_for_different_users(
        self, client, fake_internal
    ):
        payload = {"label": "A", "drive": "test-drive", "path": "Notes"}
        r1 = client.post("/vaults", headers=_hdr("alice"), json=payload)
        r2 = client.post("/vaults", headers=_hdr("bob"), json=payload)
        assert r1.status_code == 201
        assert r2.status_code == 201

    def test_401_without_cookie(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers={"X-Lit-Drive": "test-drive"},
            json={"label": "x", "drive": "test-drive", "path": ""},
        )
        assert r.status_code == 401


class TestVaultsScopedToViewer:
    def test_other_users_vaults_invisible(self, client, fake_internal):
        client.post(
            "/vaults",
            headers=_hdr("alice"),
            json={"label": "Alice", "drive": "test-drive", "path": "Notes"},
        )
        r = client.get("/vaults", headers=_hdr("bob"))
        assert r.status_code == 200
        assert r.json() == {"vaults": [], "active_vault_id": None}

    def test_cannot_access_other_users_vault_by_id(self, client, fake_internal):
        r_create = client.post(
            "/vaults",
            headers=_hdr("alice"),
            json={"label": "Alice", "drive": "test-drive", "path": "Notes"},
        )
        vault_id = r_create.json()["id"]

        for method, path in [
            ("put", f"/vaults/{vault_id}"),
            ("delete", f"/vaults/{vault_id}"),
            ("post", f"/vaults/{vault_id}/activate"),
        ]:
            kwargs = {"headers": _hdr("bob")}
            if method == "put":
                kwargs["json"] = {"label": "hacked"}
            r = client.request(method, path, **kwargs)
            assert r.status_code == 404


class TestDriveIsolation:
    def test_vault_created_in_one_drive_not_visible_under_another(
        self, client, fake_internal
    ):
        client.post(
            "/vaults",
            headers=_hdr(drive="test-drive"),
            json={"label": "Work", "drive": "test-drive", "path": "Notes"},
        )
        r = client.get("/vaults", headers=_hdr(drive="media"))
        assert r.status_code == 200
        assert r.json() == {"vaults": [], "active_vault_id": None}

    def test_cannot_mutate_vault_via_wrong_drive_context(
        self, client, fake_internal
    ):
        r_create = client.post(
            "/vaults",
            headers=_hdr(drive="test-drive"),
            json={"label": "Work", "drive": "test-drive", "path": "Notes"},
        )
        vault_id = r_create.json()["id"]
        r = client.put(
            f"/vaults/{vault_id}",
            headers=_hdr(drive="media"),
            json={"label": "hacked"},
        )
        assert r.status_code == 404

    def test_active_vault_independent_per_drive(self, client, fake_internal):
        a = client.post(
            "/vaults",
            headers=_hdr(drive="test-drive"),
            json={"label": "A", "drive": "test-drive", "path": "A"},
        ).json()
        b = client.post(
            "/vaults",
            headers=_hdr(drive="media"),
            json={"label": "B", "drive": "media", "path": "B"},
        ).json()
        # Each drive returns its own active selection
        r1 = client.get("/vaults", headers=_hdr(drive="test-drive")).json()
        r2 = client.get("/vaults", headers=_hdr(drive="media")).json()
        assert r1["active_vault_id"] == a["id"]
        assert r2["active_vault_id"] == b["id"]


class TestUpdateVault:
    def test_updates_label(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers=_hdr(),
            json={"label": "Old", "drive": "test-drive", "path": "Notes"},
        )
        vault_id = r.json()["id"]
        r = client.put(
            f"/vaults/{vault_id}",
            headers=_hdr(),
            json={"label": "New"},
        )
        assert r.status_code == 200
        assert r.json()["label"] == "New"


class TestDeleteVault:
    def test_deletes_and_clears_active_state(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers=_hdr(),
            json={"label": "A", "drive": "test-drive", "path": "Notes"},
        )
        vault_id = r.json()["id"]
        r = client.delete(f"/vaults/{vault_id}", headers=_hdr())
        assert r.status_code == 204

        r = client.get("/vaults", headers=_hdr())
        assert r.json() == {"vaults": [], "active_vault_id": None}


class TestActivateVault:
    def test_switches_active_vault(self, client, fake_internal):
        v1 = client.post(
            "/vaults",
            headers=_hdr(),
            json={"label": "A", "drive": "test-drive", "path": "Notes"},
        ).json()
        v2 = client.post(
            "/vaults",
            headers=_hdr(),
            json={"label": "B", "drive": "test-drive", "path": "Work"},
        ).json()

        r = client.post(f"/vaults/{v2['id']}/activate", headers=_hdr())
        assert r.status_code == 200
        assert r.json()["is_active"] is True

        listing = client.get("/vaults", headers=_hdr()).json()
        assert listing["active_vault_id"] == v2["id"]
        ids_active = {v["id"]: v["is_active"] for v in listing["vaults"]}
        assert ids_active[v1["id"]] is False
        assert ids_active[v2["id"]] is True


def test_viewer_id_cannot_be_supplied_in_body(client, fake_internal):
    """Defense in depth: the body should never carry viewer_id. If a
    client sends one, it must not affect the record — the server always
    uses the cookie-derived id."""
    alice = nickname_to_viewer_id("alice")
    r = client.post(
        "/vaults",
        headers=_hdr("alice"),
        json={
            "label": "X",
            "drive": "test-drive",
            "path": "Notes",
            "viewer_id": "attacker-owned-id",
        },
    )
    assert r.status_code == 201
    from app.models import UserVault
    import app.database as database

    s = database.SessionLocal()
    try:
        v = s.query(UserVault).first()
        assert v.viewer_id == alice
    finally:
        s.close()
