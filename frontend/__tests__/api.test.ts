import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFolder,
  getFileVersion,
  getFileVersionDiff,
  listFileVersions,
  listKnowledgeFiles,
  listKnowledgeFolders,
  putFileContent,
  renameFile,
} from "../api";

type MockFetch = ReturnType<typeof vi.fn>;

function mockFetch(
  responses: Array<{
    ok: boolean;
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  }>,
) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return {
      ok: next.ok,
      status: next.status ?? (next.ok ? 200 : 400),
      headers: new Headers(next.headers ?? {}),
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

  it("listKnowledgeFiles encodes drive and builds query string", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { data: [], meta: { total: 0, page: 1, limit: 100 } } },
    ]);
    await listKnowledgeFiles("my drive", "notes/sub");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url.startsWith("/api/drives/my%20drive/files?")).toBe(true);
    expect(url).toContain("path=notes%2Fsub");
    expect(url).toContain("sort=title");
    expect(url).toContain("order=asc");
  });

  it("listKnowledgeFolders encodes drive and path", async () => {
    const fetchMock = mockFetch([{ ok: true, body: [] }]);
    await listKnowledgeFolders("d r", "a/b");
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
    const out = await createFolder("drive", "notes", "sub");
    expect(out.name).toBe("sub");
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/drives/drive/folders");
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

  it("putFileContent sends the explicit version header only when requested", async () => {
    const fetchMock = mockFetch([
      {
        ok: true,
        headers: {
          etag: '"v2"',
          "x-litloft-version-action": "promoted",
        },
      },
      { ok: true, headers: { etag: '"v3"' } },
    ]);

    await expect(
      putFileContent("f 1", "pinned", "v1", "explicit"),
    ).resolves.toEqual({ etag: "v2", versionAction: "promoted" });
    await expect(putFileContent("f 1", "autosaved", "v2")).resolves.toEqual({
      etag: "v3",
      versionAction: null,
    });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/files/f%201/content");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "Content-Type": "text/plain; charset=utf-8",
      "If-Match": '"v1"',
      "X-Litloft-Save-Kind": "explicit",
    });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      "Content-Type": "text/plain; charset=utf-8",
      "If-Match": '"v2"',
    });
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty(
      "X-Litloft-Save-Kind",
    );
  });

  it("reads the paginated version list, body, and predecessor diff", async () => {
    const fetchMock = mockFetch([
      {
        ok: true,
        body: { versions: [], total: 0, limit: 25, offset: 50 },
      },
      { ok: true, body: { id: 7, content: "old body", etag: "old-etag" } },
      {
        ok: true,
        body: {
          id: 7,
          lines: [
            { kind: "del", text: "old\n" },
            { kind: "add", text: "new\n" },
          ],
          lines_added: 1,
          lines_removed: 1,
        },
      },
    ]);

    await expect(
      listFileVersions("f/1", { limit: 25, offset: 50 }),
    ).resolves.toMatchObject({ total: 0, limit: 25, offset: 50 });
    await expect(getFileVersion("f/1", 7)).resolves.toMatchObject({
      content: "old body",
    });
    await expect(getFileVersionDiff("f/1", 7)).resolves.toMatchObject({
      lines_added: 1,
      lines_removed: 1,
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/files/f%2F1/versions?limit=25&offset=50",
      "/api/files/f%2F1/versions/7",
      "/api/files/f%2F1/versions/7/diff",
    ]);
  });
});
