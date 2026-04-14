import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateVault,
  createFolder,
  createVault,
  deleteVault,
  listVaultFiles,
  listVaultFolders,
  listVaults,
  renameFile,
  updateVault,
} from "../api";

type MockFetch = ReturnType<typeof vi.fn>;

function mockFetch(responses: Array<{ ok: boolean; status?: number; body?: unknown }>) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return {
      ok: next.ok,
      status: next.status ?? (next.ok ? 200 : 400),
      json: async () => next.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as MockFetch;
}

describe("knowledge/api", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listVaults hits /api/addons/knowledge/vaults", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { vaults: [], active_vault_id: null } },
    ]);
    const res = await listVaults("test-drive");
    expect(res.vaults).toEqual([]);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/addons/knowledge/vaults");
    expect(call[1].credentials).toBe("include");
    expect(call[1].headers["X-HV-Drive"]).toBe("test-drive");
  });

  it("createVault POSTs JSON body", async () => {
    const fetchMock = mockFetch([
      {
        ok: true,
        body: {
          id: 1,
          label: "L",
          drive: "D",
          path: "P",
          is_active: true,
          created_at: "2026-04-13T00:00:00Z",
        },
      },
    ]);
    const v = await createVault("D", { label: "L", drive: "D", path: "P" });
    expect(v.id).toBe(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/addons/knowledge/vaults");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ label: "L", drive: "D", path: "P" });
    expect(call[1].headers["Content-Type"]).toBe("application/json");
    expect(call[1].headers["X-HV-Drive"]).toBe("D");
  });

  it("updateVault sends PUT with label", async () => {
    const fetchMock = mockFetch([
      {
        ok: true,
        body: {
          id: 7,
          label: "new",
          drive: "d",
          path: "",
          is_active: false,
          created_at: "",
        },
      },
    ]);
    await updateVault("d", 7, "new");
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/addons/knowledge/vaults/7");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body)).toEqual({ label: "new" });
  });

  it("deleteVault handles 204 without parsing body", async () => {
    const fetchMock = mockFetch([{ ok: true, status: 204 }]);
    await expect(deleteVault("d", 3)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });

  it("activateVault POSTs to /activate", async () => {
    const fetchMock = mockFetch([
      {
        ok: true,
        body: {
          id: 2,
          label: "x",
          drive: "d",
          path: "",
          is_active: true,
          created_at: "",
        },
      },
    ]);
    const v = await activateVault("d", 2);
    expect(v.is_active).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/addons/knowledge/vaults/2/activate",
    );
  });

  it("throws with server detail on error", async () => {
    mockFetch([{ ok: false, status: 409, body: { detail: "dup" } }]);
    await expect(createVault("d", { label: "l", drive: "d" })).rejects.toThrow("dup");
  });

  it("listVaultFiles encodes drive and builds query string", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { data: [], meta: { total: 0, page: 1, limit: 100 } } },
    ]);
    await listVaultFiles("my drive", "notes/sub");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url.startsWith("/api/drives/my%20drive/files?")).toBe(true);
    expect(url).toContain("path=notes%2Fsub");
    expect(url).toContain("sort=title");
    expect(url).toContain("order=asc");
  });

  it("listVaultFolders encodes drive and path", async () => {
    const fetchMock = mockFetch([{ ok: true, body: [] }]);
    await listVaultFolders("d r", "a/b");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url.startsWith("/api/drives/d%20r/folders?")).toBe(true);
    expect(url).toContain("path=a%2Fb");
  });

  it("createFolder POSTs name and path", async () => {
    const fetchMock = mockFetch([
      {
        ok: true,
        body: { name: "sub", path: "notes/sub", file_count: 0, thumbnail_file_id: null },
      },
    ]);
    const out = await createFolder("vault", "notes", "sub");
    expect(out.name).toBe("sub");
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/drives/vault/folders");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ path: "notes", name: "sub" });
  });

  it("createFolder surfaces server detail on error", async () => {
    mockFetch([{ ok: false, status: 409, body: { detail: "exists" } }]);
    await expect(createFolder("v", "", "dup")).rejects.toThrow("exists");
  });

  it("renameFile PUTs new_filename to rename endpoint", async () => {
    const fetchMock = mockFetch([
      {
        ok: true,
        body: {
          id: "abc",
          filename: "new.md",
          title: "new",
          drive: "d",
          folder_path: "",
          file_type: "document",
          mime_type: "text/markdown",
          thumbnail_url: "",
          file_size: 0,
          created_at: "",
          updated_at: "",
        },
      },
    ]);
    const out = await renameFile("abc", "new.md");
    expect(out.filename).toBe("new.md");
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/files/abc/rename");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body)).toEqual({ new_filename: "new.md" });
  });

  it("renameFile throws with server detail on error", async () => {
    mockFetch([{ ok: false, status: 400, body: { detail: "forbidden char" } }]);
    await expect(renameFile("id", "bad/name.md")).rejects.toThrow("forbidden char");
  });
});
