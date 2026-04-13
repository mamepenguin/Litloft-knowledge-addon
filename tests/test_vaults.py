"""Tests for /vaults CRUD.

Contract:
- Every write requires a valid hv_viewer cookie (401 otherwise)
- Every route is scoped to the caller's viewer_id
- Clients cannot supply viewer_id in body or query (it is never read from
  the request payload — only from the cookie)
- Vault creation validates that the target drive is accessible via the
  core's Internal API
- CASCADE DELETE clears user_vault_state when the active Vault is
  deleted (validated separately in test_database.py)
"""
from app.auth import nickname_to_viewer_id


def _ck(nickname: str = "alice") -> dict[str, str]:
    return {"Cookie": f"hv_viewer={nickname}"}


class TestListVaults:
    def test_empty_list(self, client, fake_internal):
        r = client.get("/vaults", headers=_ck())
        assert r.status_code == 200
        assert r.json() == {"vaults": [], "active_vault_id": None}

    def test_401_without_cookie(self, client, fake_internal):
        r = client.get("/vaults")
        assert r.status_code == 401


class TestCreateVault:
    def test_creates_first_vault_and_auto_activates(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers=_ck(),
            json={"label": "Personal", "drive": "test-drive", "path": "Notes"},
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["label"] == "Personal"
        assert data["drive"] == "test-drive"
        assert data["path"] == "Notes"
        assert data["is_active"] is True  # first vault auto-activates

    def test_second_vault_does_not_auto_activate(self, client, fake_internal):
        client.post(
            "/vaults",
            headers=_ck(),
            json={"label": "Personal", "drive": "test-drive", "path": "Notes"},
        )
        r = client.post(
            "/vaults",
            headers=_ck(),
            json={"label": "Work", "drive": "media", "path": "Work"},
        )
        assert r.status_code == 201
        assert r.json()["is_active"] is False

    def test_rejects_inaccessible_drive(self, client, fake_internal):
        fake_internal.accessible_drives_override = ["media"]
        r = client.post(
            "/vaults",
            headers=_ck(),
            json={"label": "Secret", "drive": "secret-drive", "path": ""},
        )
        assert r.status_code == 403

    def test_rejects_path_traversal(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers=_ck(),
            json={"label": "Bad", "drive": "test-drive", "path": "../etc"},
        )
        assert r.status_code == 400

    def test_rejects_absolute_path(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers=_ck(),
            json={"label": "Bad", "drive": "test-drive", "path": "/etc"},
        )
        assert r.status_code == 400

    def test_rejects_duplicate_location(self, client, fake_internal):
        payload = {"label": "A", "drive": "test-drive", "path": "Notes"}
        client.post("/vaults", headers=_ck(), json=payload)
        r = client.post("/vaults", headers=_ck(), json={**payload, "label": "B"})
        assert r.status_code == 409

    def test_same_location_allowed_for_different_users(self, client, fake_internal):
        payload = {"label": "A", "drive": "test-drive", "path": "Notes"}
        r1 = client.post("/vaults", headers=_ck("alice"), json=payload)
        r2 = client.post("/vaults", headers=_ck("bob"), json=payload)
        assert r1.status_code == 201
        assert r2.status_code == 201

    def test_401_without_cookie(self, client, fake_internal):
        r = client.post(
            "/vaults",
            json={"label": "x", "drive": "test-drive", "path": ""},
        )
        assert r.status_code == 401


class TestVaultsScopedToViewer:
    def test_other_users_vaults_invisible(self, client, fake_internal):
        client.post(
            "/vaults",
            headers=_ck("alice"),
            json={"label": "Alice", "drive": "test-drive", "path": "Notes"},
        )
        r = client.get("/vaults", headers=_ck("bob"))
        assert r.status_code == 200
        assert r.json() == {"vaults": [], "active_vault_id": None}

    def test_cannot_access_other_users_vault_by_id(self, client, fake_internal):
        r_create = client.post(
            "/vaults",
            headers=_ck("alice"),
            json={"label": "Alice", "drive": "test-drive", "path": "Notes"},
        )
        vault_id = r_create.json()["id"]

        for method, path in [
            ("put", f"/vaults/{vault_id}"),
            ("delete", f"/vaults/{vault_id}"),
            ("post", f"/vaults/{vault_id}/activate"),
        ]:
            kwargs = {"headers": _ck("bob")}
            if method == "put":
                kwargs["json"] = {"label": "hacked"}
            r = client.request(method, path, **kwargs)
            assert r.status_code == 404, (
                f"{method} {path} should hide other-user vaults as 404, "
                f"got {r.status_code}"
            )


class TestUpdateVault:
    def test_updates_label(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers=_ck(),
            json={"label": "Old", "drive": "test-drive", "path": "Notes"},
        )
        vault_id = r.json()["id"]
        r = client.put(
            f"/vaults/{vault_id}",
            headers=_ck(),
            json={"label": "New"},
        )
        assert r.status_code == 200
        assert r.json()["label"] == "New"


class TestDeleteVault:
    def test_deletes_and_clears_active_state(self, client, fake_internal):
        r = client.post(
            "/vaults",
            headers=_ck(),
            json={"label": "A", "drive": "test-drive", "path": "Notes"},
        )
        vault_id = r.json()["id"]
        r = client.delete(f"/vaults/{vault_id}", headers=_ck())
        assert r.status_code == 204

        r = client.get("/vaults", headers=_ck())
        assert r.json() == {"vaults": [], "active_vault_id": None}


class TestActivateVault:
    def test_switches_active_vault(self, client, fake_internal):
        v1 = client.post(
            "/vaults",
            headers=_ck(),
            json={"label": "A", "drive": "test-drive", "path": "Notes"},
        ).json()
        v2 = client.post(
            "/vaults",
            headers=_ck(),
            json={"label": "B", "drive": "media", "path": "Work"},
        ).json()

        # v1 auto-active after first create; activate v2
        r = client.post(f"/vaults/{v2['id']}/activate", headers=_ck())
        assert r.status_code == 200
        assert r.json()["is_active"] is True

        listing = client.get("/vaults", headers=_ck()).json()
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
        headers=_ck("alice"),
        json={
            "label": "X",
            "drive": "test-drive",
            "path": "Notes",
            "viewer_id": "attacker-owned-id",
        },
    )
    assert r.status_code == 201
    # Stored row must have alice's viewer_id, not the attacker-supplied one.
    from app.models import UserVault
    import app.database as database

    s = database.SessionLocal()
    try:
        v = s.query(UserVault).first()
        assert v.viewer_id == alice
    finally:
        s.close()
