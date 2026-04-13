import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  computeTextEtag,
  createTextFile,
  getFileContent,
  putFileContent,
} from "../api";
import { applyEditorAction } from "../EditorToolbar";

type MockFetch = ReturnType<typeof vi.fn>;

function mockFetch(
  responses: Array<{
    ok: boolean;
    status?: number;
    body?: unknown;
    text?: string;
    headers?: Record<string, string>;
  }>,
) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch call");
    const h = new Map(
      Object.entries(next.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      ok: next.ok,
      status: next.status ?? (next.ok ? 200 : 400),
      json: async () => next.body,
      text: async () => next.text ?? "",
      headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as MockFetch;
}

describe("computeTextEtag", () => {
  it("matches SHA-256 hex of UTF-8 bytes (empty string)", async () => {
    const etag = await computeTextEtag("");
    expect(etag).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches known SHA-256 for 'abc'", async () => {
    const etag = await computeTextEtag("abc");
    expect(etag).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("getFileContent", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.restoreAllMocks());

  it("uses ETag header when present", async () => {
    mockFetch([
      { ok: true, text: "hello", headers: { etag: '"abc123"' } },
    ]);
    const res = await getFileContent("f1");
    expect(res.content).toBe("hello");
    expect(res.etag).toBe("abc123");
  });

  it("falls back to client-side SHA-256 if no ETag header", async () => {
    mockFetch([{ ok: true, text: "abc" }]);
    const res = await getFileContent("f1");
    expect(res.etag).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("strips weak-etag prefix and quotes", async () => {
    mockFetch([{ ok: true, text: "x", headers: { etag: 'W/"hash"' } }]);
    const res = await getFileContent("f1");
    expect(res.etag).toBe("hash");
  });
});

describe("putFileContent", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.restoreAllMocks());

  it("sends If-Match header with quoted etag", async () => {
    const fetchMock = mockFetch([
      { ok: true, headers: { etag: '"new"' } },
    ]);
    const newEtag = await putFileContent("f1", "hi", "old");
    expect(newEtag).toBe("new");
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/files/f1/content");
    expect(call[1].method).toBe("PUT");
    expect(call[1].headers["If-Match"]).toBe('"old"');
    expect(call[1].body).toBe("hi");
  });

  it("throws ConflictError on 412", async () => {
    mockFetch([{ ok: false, status: 412, body: { detail: "mismatch" } }]);
    await expect(putFileContent("f1", "", "x")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("computes etag locally when server omits ETag header", async () => {
    mockFetch([{ ok: true, headers: {} }]);
    const newEtag = await putFileContent("f1", "abc", "x");
    expect(newEtag).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("createTextFile", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.restoreAllMocks());

  it("posts path + content as JSON", async () => {
    const fetchMock = mockFetch([
      {
        ok: true,
        body: {
          id: "new-id",
          filename: "a.md",
          title: "",
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
    const f = await createTextFile("d", { path: "Notes/a.md" });
    expect(f.id).toBe("new-id");
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/drives/d/files");
    expect(JSON.parse(call[1].body)).toEqual({
      content: "",
      path: "Notes/a.md",
    });
  });
});

describe("applyEditorAction", () => {
  it("prefix inserts at line start", () => {
    const { text, selStart } = applyEditorAction(
      "first\nsecond\n",
      8,
      8,
      { kind: "prefix", text: "# " },
    );
    expect(text).toBe("first\n# second\n");
    expect(selStart).toBe(10);
  });

  it("wrap surrounds selection", () => {
    const { text } = applyEditorAction("hello world", 6, 11, {
      kind: "wrap",
      before: "**",
      after: "**",
    });
    expect(text).toBe("hello **world**");
  });

  it("link inserts [selected](url) with url selected", () => {
    const { text, selStart, selEnd } = applyEditorAction(
      "see foo here",
      4,
      7,
      { kind: "link" },
    );
    expect(text).toBe("see [foo](url) here");
    expect(text.slice(selStart, selEnd)).toBe("url");
  });

  it("codeblock wraps in triple backticks", () => {
    const { text } = applyEditorAction("x", 0, 1, { kind: "codeblock" });
    expect(text).toContain("```");
    expect(text).toContain("x");
  });
});
