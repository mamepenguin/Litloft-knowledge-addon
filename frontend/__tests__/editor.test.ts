import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  createTextFile,
  getFileContent,
  putFileContent,
} from "../api";
import { applyEditorAction } from "../EditorToolbar";
import { applyIndent } from "../editorIndent";

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

  it("throws when ETag header is missing", async () => {
    mockFetch([{ ok: true, text: "abc" }]);
    await expect(getFileContent("f1")).rejects.toThrow(/ETag/);
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

  it("throws when server omits ETag header", async () => {
    mockFetch([{ ok: true, headers: {} }]);
    await expect(putFileContent("f1", "abc", "x")).rejects.toThrow(/ETag/);
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

  it("inline code wraps selection in single backticks", () => {
    const { text } = applyEditorAction("foo bar baz", 4, 7, {
      kind: "wrap",
      before: "`",
      after: "`",
    });
    expect(text).toBe("foo `bar` baz");
  });
});

describe("applyIndent", () => {
  it("inserts 2 spaces at caret when no selection", () => {
    const { text, selStart, selEnd } = applyIndent("abc", 1, 1, false);
    expect(text).toBe("a  bc");
    expect(selStart).toBe(3);
    expect(selEnd).toBe(3);
  });

  it("replaces single-line selection with 2 spaces", () => {
    const { text, selStart } = applyIndent("foo bar", 0, 3, false);
    expect(text).toBe("   bar");
    expect(selStart).toBe(2);
  });

  it("indents every line of a multi-line selection", () => {
    const { text, selStart, selEnd } = applyIndent(
      "one\ntwo\nthree",
      0,
      11,
      false,
    );
    expect(text).toBe("  one\n  two\n  three");
    expect(selStart).toBe(2);
    expect(selEnd).toBe(17);
  });

  it("does not include trailing line when selection ends on newline", () => {
    const { text } = applyIndent("one\ntwo\n", 0, 4, false);
    expect(text).toBe("  one\ntwo\n");
  });

  it("outdents current line when Shift+Tab with no selection", () => {
    const { text, selStart } = applyIndent("    foo", 6, 6, true);
    expect(text).toBe("  foo");
    expect(selStart).toBe(4);
  });

  it("outdents up to 2 leading spaces per line", () => {
    const { text } = applyIndent("    a\n b\n   c", 0, 13, true);
    expect(text).toBe("  a\nb\n c");
  });

  it("outdents a leading tab as one char", () => {
    const { text } = applyIndent("\tfoo", 0, 4, true);
    expect(text).toBe("foo");
  });

  it("outdent is a no-op when no leading indent exists", () => {
    const result = applyIndent("foo\nbar", 0, 7, true);
    expect(result.text).toBe("foo\nbar");
    expect(result.selStart).toBe(0);
    expect(result.selEnd).toBe(7);
  });

  it("caret inside leading spaces clamps to new line start on outdent", () => {
    const { text, selStart } = applyIndent("  foo", 1, 1, true);
    expect(text).toBe("foo");
    expect(selStart).toBe(0);
  });
});
