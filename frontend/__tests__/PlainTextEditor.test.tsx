import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { ShortcutsProvider } from "@/components/ShortcutsProvider";
import { dirtyRegistry } from "@/lib/dirtyRegistry";
import { markdownContentRegistry } from "@/lib/markdownContentRegistry";
import {
  MarkdownChromeProvider,
  type MarkdownSaveState,
  type MarkdownViewMode,
} from "@/lib/markdownChromeContext";
import { clearSourceCaptures, getSourceCaptures } from "@/lib/sourceCapture";
import { _resetPolicyCache } from "@/hooks/usePolicy";
import { editorContent, setEditorContent } from "./editorTestDriver";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(globalThis.__editParam__ ?? ""),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => <div data-testid="md-preview" />,
}));

declare global {
  // eslint-disable-next-line no-var
  var __editParam__: string | undefined;
}

// jsdom lays nothing out and has no Range.getClientRects, which CodeMirror's
// measure calls when the editor scrolls its selection into view.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const KnowledgeEditSection = (await import("../KnowledgeEditSection")).default;

const NOT_UTF8 =
  "This file can't be edited here: it is not UTF-8 text.";
const MIXED_ENDINGS =
  "This file can't be edited here: its line endings are mixed.";
const BOM = [0xef, 0xbb, 0xbf];

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

async function bodyBytes(body: unknown): Promise<number[]> {
  if (typeof body === "string") return Array.from(enc(body));
  if (body instanceof Uint8Array) return Array.from(body);
  if (body instanceof ArrayBuffer) return Array.from(new Uint8Array(body));
  if (body instanceof Blob) {
    return Array.from(new Uint8Array(await body.arrayBuffer()));
  }
  throw new Error(`unexpected PUT body type: ${typeof body}`);
}

interface StreamSpec {
  bytes?: Uint8Array;
  etag?: string | null;
  status?: number;
}

interface PutRecord {
  body: number[];
  headers: Record<string, string>;
}

interface Server {
  urls: string[];
  puts: PutRecord[];
}

function installServer(options: {
  streams: StreamSpec[];
  putResponses?: Array<{ status: number; etag?: string }>;
  versions?: Array<{ id: number; content: string }>;
}): Server {
  const server: Server = { urls: [], puts: [] };
  const streams = [...options.streams];
  const putResponses = [...(options.putResponses ?? [])];
  let putCount = 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      server.urls.push(url);
      if (url.endsWith("/api/files/f1/stream")) {
        const next = streams.length > 1 ? streams.shift()! : streams[0];
        const status = next.status ?? 200;
        const headers: Record<string, string> = {};
        if (next.etag !== null) headers.etag = `"${next.etag ?? "e0"}"`;
        // A jsdom Blob reaches Node's Response as the string "[object Blob]".
        return new Response(status === 200 ? ((next.bytes ?? enc("")) as unknown as BodyInit) : "x", {
          status,
          headers,
        });
      }
      if (url.endsWith("/api/files/f1/content") && init?.method === "PUT") {
        server.puts.push({
          body: await bodyBytes(init.body),
          headers: { ...(init.headers as Record<string, string>) },
        });
        putCount += 1;
        const planned = putResponses.shift();
        if (planned && planned.status !== 200) {
          return new Response("{}", {
            status: planned.status,
            headers: planned.etag ? { etag: `"${planned.etag}"` } : {},
          });
        }
        return new Response("{}", {
          status: 200,
          headers: { etag: `"${planned?.etag ?? `after-${putCount}`}"` },
        });
      }
      if (/\/api\/files\/f1\/versions\?/.test(url)) {
        const versions = options.versions ?? [];
        return json({
          versions: versions.map((v) => ({
            id: v.id,
            created_at: "2026-08-20T12:00:00Z",
            nickname: null,
            kind: "auto",
            size_bytes: v.content.length,
            lines_added: 1,
            lines_removed: 0,
          })),
          total: versions.length,
          limit: 50,
          offset: 0,
        });
      }
      const diff = url.match(/\/api\/files\/f1\/versions\/(\d+)\/diff$/);
      if (diff) {
        return json({
          id: Number(diff[1]),
          lines: [{ kind: "add", text: "x" }],
          lines_added: 1,
          lines_removed: 0,
        });
      }
      const version = url.match(/\/api\/files\/f1\/versions\/(\d+)$/);
      if (version) {
        const found = (options.versions ?? []).find(
          (v) => v.id === Number(version[1]),
        );
        return json({ id: found?.id, content: found?.content, etag: "ignored" });
      }
      if (/\/api\/files\/f1$/.test(url)) {
        return json({
          id: "f1",
          mime_type: "text/plain",
          filename: "note.txt",
          folder_path: "",
        });
      }
      if (url.includes("/addon-policies")) {
        return json({
          addons: { knowledge: { default: true, features: { editor: true } } },
        });
      }
      return json({ detail: "not found" }, 404);
    }),
  );
  return server;
}

const published: MarkdownSaveState[] = [];

function Chrome({
  children,
  seen,
}: {
  children: ReactNode;
  seen: MarkdownViewMode[];
}) {
  const [viewMode, setViewMode] = useState<MarkdownViewMode>("edit");
  seen.push(viewMode);
  return (
    <MarkdownChromeProvider
      value={{
        viewMode,
        setViewMode,
        publishSaveState: (state) => {
          published.push(state);
        },
        isMobile: false,
      }}
    >
      <div data-testid="view-mode">{viewMode}</div>
      <button type="button" onClick={() => setViewMode("preview")}>
        switch-to-read
      </button>
      <button type="button" onClick={() => setViewMode("edit")}>
        switch-to-edit
      </button>
      {children}
    </MarkdownChromeProvider>
  );
}

function openTxt(props: { highlight?: string } = {}) {
  const seen: MarkdownViewMode[] = [];
  const view = render(
    <ShortcutsProvider>
      <Chrome seen={seen}>
        <KnowledgeEditSection
          fileId="f1"
          drive="d"
          {...{ plainTextDocument: true }}
          {...props}
        />
      </Chrome>
    </ShortcutsProvider>,
  );
  return { ...view, seen };
}

const findEditor = () => screen.findByLabelText("Text editor");
const toRead = () => fireEvent.click(screen.getByText("switch-to-read"));
const toEdit = () => fireEvent.click(screen.getByText("switch-to-edit"));

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function pressMod(
  target: Element | Document,
  key: string,
  extra: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: !isMac,
    metaKey: isMac,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

// The shortcut context is pushed only after the content has loaded; opening
// the cheat sheet once proves it is there before a test presses a key.
async function shortcutsReady(label: string) {
  fireEvent.keyDown(document, { key: "?" });
  await screen.findByText(label);
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByText(label)).toBeNull());
}

async function autosave() {
  await act(async () => {
    vi.advanceTimersByTime(2100);
  });
}

function openMenu(name: string): HTMLElement {
  fireEvent.click(
    screen.getByRole("button", { name: "More formatting and versions" }),
  );
  return screen.getByRole("menuitem", { name });
}

beforeEach(() => {
  published.length = 0;
  vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
  globalThis.__editParam__ = "";
  dirtyRegistry.reset();
  markdownContentRegistry.reset();
  clearSourceCaptures("d");
  _resetPolicyCache();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  dirtyRegistry.reset();
  markdownContentRegistry.reset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  _resetPolicyCache();
  globalThis.__editParam__ = "";
});

describe("SPEC-ADDON-037 loading and the file's form", () => {
  it("shows the text without the BOM and with CRLF folded to LF", async () => {
    installServer({ streams: [{ bytes: enc("﻿one\r\ntwo\r\n") }] });
    openTxt();
    const editor = await findEditor();
    expect(editorContent(editor)).toBe("one\ntwo\n");
  });

  it("loads the body from /stream as bytes and sends no request but core's", async () => {
    const server = installServer({
      streams: [{ bytes: enc("hello"), etag: "v1" }],
    });
    openTxt();
    const editor = await findEditor();
    setEditorContent(editor, "hello world");
    await autosave();
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.urls.some((u) => u.endsWith("/api/files/f1/stream"))).toBe(
      true,
    );
    expect(
      server.urls.filter(
        (u) => u.includes("/api/addons/") || u.includes("resync-tags"),
      ),
    ).toEqual([]);
  });

  it("labels the edit area as a text editor, not a Markdown editor", async () => {
    installServer({ streams: [{ bytes: enc("hello") }] });
    openTxt();
    await findEditor();
    expect(screen.queryByLabelText("Markdown editor")).toBeNull();
  });

  it.each([
    ["empty", "", "x"],
    ["no line break", "one", "one\ntwo"],
  ])("opens a %s file as editable", async (_label, initial, typed) => {
    const server = installServer({ streams: [{ bytes: enc(initial) }] });
    openTxt();
    const editor = await findEditor();
    setEditorContent(editor, typed);
    await autosave();
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0].body).toEqual(Array.from(enc(typed)));
  });
});

describe("SPEC-ADDON-037 every write keeps the file's form (I1)", () => {
  const forms: Array<[string, string, string, string]> = [
    ["LF", "one\ntwo\n", "one\ntwo\nthree", "one\ntwo\nthree"],
    ["CRLF", "one\r\n二\r\n", "one\n二\nthree", "one\r\n二\r\nthree"],
    ["BOM and LF", "﻿one\ntwo", "one\ntwo\nthree", "﻿one\ntwo\nthree"],
    [
      "BOM and CRLF",
      "﻿one\r\ntwo",
      "one\ntwo\nthree",
      "﻿one\r\ntwo\r\nthree",
    ],
    ["BOM and no line break", "﻿one", "one\ntwo", "﻿one\ntwo"],
  ];

  it.each(forms)("autosave of a %s file", async (_l, initial, typed, written) => {
    const server = installServer({
      streams: [{ bytes: enc(initial), etag: "v1" }],
    });
    openTxt();
    const editor = await findEditor();
    setEditorContent(editor, typed);
    await autosave();
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0].body).toEqual(Array.from(enc(written)));
    expect(server.puts[0].headers["If-Match"]).toBe('"v1"');
    const body = server.puts[0].body;
    const bomCount = body.slice(0, 3).join() === BOM.join() ? 1 : 0;
    expect(bomCount).toBe(initial.startsWith("﻿") ? 1 : 0);
  });

  it("explicit save with the keyboard re-encodes the buffer and keeps a version", async () => {
    const server = installServer({
      streams: [{ bytes: enc("﻿one\r\ntwo"), etag: "v1" }],
    });
    openTxt();
    const editor = await findEditor();
    await shortcutsReady("Keep this version");
    setEditorContent(editor, "one\ntwo\nthree");
    const event = pressMod(editor, "s");
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0].body).toEqual(
      Array.from(enc("﻿one\r\ntwo\r\nthree")),
    );
    expect(server.puts[0].headers["X-Litloft-Save-Kind"]).toBe("explicit");
  });

  it("the save on unmount re-encodes the buffer", async () => {
    const server = installServer({
      streams: [{ bytes: enc("a\r\nb"), etag: "v1" }],
    });
    const { unmount } = openTxt();
    const editor = await findEditor();
    setEditorContent(editor, "a\nb\nc");
    unmount();
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(server.puts[0].body).toEqual(Array.from(enc("a\r\nb\r\nc")));
  });

  it("Overwrite writes the buffer in the form the file has now", async () => {
    const server = installServer({
      streams: [
        { bytes: enc("one\ntwo"), etag: "v1" },
        { bytes: enc("﻿new\r\ndisk"), etag: "v2" },
      ],
      putResponses: [{ status: 412, etag: "v2" }, { status: 200, etag: "v3" }],
    });
    openTxt();
    const editor = await findEditor();
    setEditorContent(editor, "mine\ntext");
    await autosave();
    fireEvent.click(
      await screen.findByRole("button", { name: /Overwrite with my changes/ }),
    );
    await waitFor(() => expect(server.puts).toHaveLength(2));
    expect(server.puts[1].body).toEqual(
      Array.from(enc("﻿mine\r\ntext")),
    );
    expect(server.puts[1].headers["If-Match"]).toBe('"v2"');
  });
});

describe("SPEC-ADDON-037 a file the editor cannot write back unchanged (I2)", () => {
  const notEditable: Array<[string, Uint8Array, string]> = [
    ["invalid UTF-8", new Uint8Array([0x61, 0xff, 0xfe, 0x62]), NOT_UTF8],
    ["mixed CRLF and LF", enc("a\r\nb\nc"), MIXED_ENDINGS],
    ["bare CR", enc("a\rb\rc"), MIXED_ENDINGS],
    ["CRLF and bare CR", enc("a\r\nb\rc"), MIXED_ENDINGS],
  ];

  it.each(notEditable)(
    "%s: Edit shows the notice and no editor, and nothing is ever written",
    async (_label, bytes, notice) => {
      const server = installServer({ streams: [{ bytes, etag: "v1" }] });
      const { unmount } = openTxt();
      expect(await screen.findByText(notice)).toBeInTheDocument();
      expect(screen.queryByLabelText("Text editor")).toBeNull();
      await shortcutsReady("Cycle view mode");
      pressMod(document, "s");
      await autosave();
      unmount();
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(server.puts).toEqual([]);
    },
  );

  it("offers no toolbar, no version-history entry and no panel", async () => {
    installServer({ streams: [{ bytes: new Uint8Array([0xff]), etag: "v1" }] });
    openTxt();
    await screen.findByText(NOT_UTF8);
    expect(
      screen.queryByRole("button", { name: "More formatting and versions" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open version history" }),
    ).toBeNull();
  });

  it("Read shows the text decoded with replacement characters", async () => {
    installServer({
      streams: [{ bytes: new Uint8Array([0x61, 0xff, 0x62]), etag: "v1" }],
    });
    openTxt();
    await screen.findByText(NOT_UTF8);
    toRead();
    await waitFor(() =>
      expect(document.querySelector("pre")?.textContent).toBe("a�b"),
    );
  });

  it("switches Read and Edit by the shortcut too, and Edit still shows the notice", async () => {
    installServer({ streams: [{ bytes: new Uint8Array([0xff]), etag: "v1" }] });
    openTxt();
    await screen.findByText(NOT_UTF8);
    await shortcutsReady("Cycle view mode");
    pressMod(document, "\\", { shiftKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("view-mode")).toHaveTextContent("preview"),
    );
    pressMod(document, "\\", { shiftKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("view-mode")).toHaveTextContent("edit"),
    );
    expect(screen.getByText(NOT_UTF8)).toBeInTheDocument();
  });

  it("Reload that finds the file no longer editable discards the text and shows the notice", async () => {
    const server = installServer({
      streams: [
        { bytes: enc("one"), etag: "v1" },
        { bytes: new Uint8Array([0xff, 0xfe]), etag: "v2" },
      ],
      putResponses: [{ status: 412, etag: "v2" }],
    });
    openTxt();
    const editor = await findEditor();
    setEditorContent(editor, "mine");
    await autosave();
    fireEvent.click(
      await screen.findByRole("button", { name: /Reload from server/ }),
    );
    expect(await screen.findByText(NOT_UTF8)).toBeInTheDocument();
    await autosave();
    expect(server.puts).toHaveLength(1);
  });

  it("Overwrite that finds the file not editable writes nothing and holds the viewer's text read-only", async () => {
    const server = installServer({
      streams: [
        { bytes: enc("one"), etag: "v1" },
        { bytes: enc("a\r\nb\nc"), etag: "v2" },
      ],
      putResponses: [{ status: 412, etag: "v2" }],
    });
    const { unmount } = openTxt();
    const editor = await findEditor();
    setEditorContent(editor, "my precious text");
    await autosave();
    fireEvent.click(
      await screen.findByRole("button", { name: /Overwrite with my changes/ }),
    );
    expect(await screen.findByText(MIXED_ENDINGS)).toBeInTheDocument();
    expect(document.body.textContent).toContain("my precious text");
    expect(
      screen.queryByRole("button", { name: "More formatting and versions" }),
    ).toBeNull();
    const heldEditor = document.querySelector(".cm-content");
    expect(heldEditor?.getAttribute("contenteditable")).not.toBe("true");
    await shortcutsReady("Cycle view mode");
    pressMod(document, "s");
    await autosave();
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(server.puts).toHaveLength(1);
  });

  it("held: Read shows the retained text and Edit shows it again", async () => {
    installServer({
      streams: [
        { bytes: enc("one"), etag: "v1" },
        { bytes: enc("a\rb"), etag: "v2" },
      ],
      putResponses: [{ status: 412, etag: "v2" }],
    });
    openTxt();
    const editor = await findEditor();
    setEditorContent(editor, "kept words");
    await autosave();
    fireEvent.click(
      await screen.findByRole("button", { name: /Overwrite with my changes/ }),
    );
    await screen.findByText(MIXED_ENDINGS);
    toRead();
    await waitFor(() =>
      expect(document.querySelector("pre")?.textContent).toContain(
        "kept words",
      ),
    );
    toEdit();
    expect(await screen.findByText(MIXED_ENDINGS)).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-037 failure cases that keep the buffer", () => {
  it.each([[413], [404], [415]])(
    "a save answered %i leaves the buffer in the editor",
    async (status) => {
      const server = installServer({
        streams: [{ bytes: enc("one"), etag: "v1" }],
        putResponses: [{ status }],
      });
      openTxt();
      const editor = await findEditor();
      setEditorContent(editor, "one two");
      await autosave();
      await waitFor(() => expect(server.puts).toHaveLength(1));
      expect(editorContent(editor)).toBe("one two");
    },
  );

  it("a failed Reload closes the conflict dialog, shows the save-error state and keeps the buffer", async () => {
    const server = installServer({
      streams: [{ bytes: enc("one"), etag: "v1" }, { status: 500 }],
      putResponses: [{ status: 412, etag: "v2" }],
    });
    openTxt();
    const editor = await findEditor();
    setEditorContent(editor, "mine");
    await autosave();
    fireEvent.click(
      await screen.findByRole("button", { name: /Reload from server/ }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Reload from server/ }),
      ).toBeNull(),
    );
    expect(published.at(-1)?.status).toBe("error");
    expect(editorContent(editor)).toBe("mine");
    expect(server.puts).toHaveLength(1);
  });

  it("a failed Overwrite probe writes nothing and keeps the buffer", async () => {
    const server = installServer({
      streams: [{ bytes: enc("one"), etag: "v1" }, { status: 500 }],
      putResponses: [{ status: 412, etag: "v2" }],
    });
    openTxt();
    const editor = await findEditor();
    setEditorContent(editor, "mine");
    await autosave();
    fireEvent.click(
      await screen.findByRole("button", { name: /Overwrite with my changes/ }),
    );
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await autosave();
    expect(server.puts).toHaveLength(1);
    expect(editorContent(editor)).toBe("mine");
  });

  it("a stream that answers without an ETag is a load error and nothing is editable", async () => {
    const server = installServer({
      streams: [{ bytes: enc("one"), etag: null }],
    });
    openTxt();
    expect(await screen.findByText(/Failed to load/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Text editor")).toBeNull();
    expect(server.puts).toEqual([]);
  });

  it("a stream that answers 404 is a load error", async () => {
    installServer({ streams: [{ status: 404 }] });
    openTxt();
    expect(await screen.findByText(/Failed to load/)).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-037 what the plain-text editor leaves out (I4, I10)", () => {
  it("draws only the … menu on the toolbar", async () => {
    installServer({ streams: [{ bytes: enc("hello") }] });
    openTxt();
    await findEditor();
    expect(
      screen.getByRole("button", { name: "More formatting and versions" }),
    ).toBeInTheDocument();
    for (const name of [
      "Heading 1",
      "Bold",
      "Italic",
      "Link",
      "Code block",
      "Insert file link",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(openMenu("Keep this version")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Version history" }),
    ).toBeInTheDocument();
  });

  it("lists no formatting entries in the shortcut help", async () => {
    installServer({ streams: [{ bytes: enc("hello") }] });
    openTxt();
    await findEditor();
    fireEvent.keyDown(document, { key: "?" });
    await screen.findByText("Keep this version");
    expect(screen.getByText("Cycle view mode")).toBeInTheDocument();
    for (const label of ["Bold", "Italic", "Insert link", "Inline code", "Code block"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it.each([
    ["b", {}],
    ["i", {}],
    ["k", {}],
    ["e", {}],
    ["k", { shiftKey: true }],
  ])("Ctrl/Cmd+%s %j is left alone", async (key, extra) => {
    installServer({ streams: [{ bytes: enc("abc") }] });
    openTxt();
    const editor = await findEditor();
    await shortcutsReady("Keep this version");
    const content = editor.closest(".cm-editor")?.querySelector(".cm-content");
    const view = (await import("./editorTestDriver")).getEditorView(editor);
    act(() => view.dispatch({ selection: { anchor: 0, head: 3 } }));
    const event = pressMod(content ?? editor, key, extra);
    expect(editorContent(editor)).toBe("abc");
    expect(event.defaultPrevented).toBe(false);
  });

  it("Enter inserts a line break and carries no indentation or list marker", async () => {
    installServer({ streams: [{ bytes: enc("    - item") }] });
    openTxt();
    const editor = await findEditor();
    const driver = await import("./editorTestDriver");
    const view = driver.getEditorView(editor);
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    fireEvent.keyDown(view.contentDOM, { key: "Enter", keyCode: 13 });
    expect(editorContent(editor)).toBe("    - item\n");
  });

  it("Tab inserts a tab character", async () => {
    installServer({ streams: [{ bytes: enc("ab") }] });
    openTxt();
    const editor = await findEditor();
    const driver = await import("./editorTestDriver");
    const view = driver.getEditorView(editor);
    act(() => view.dispatch({ selection: { anchor: 1 } }));
    fireEvent.keyDown(view.contentDOM, { key: "Tab", keyCode: 9 });
    expect(editorContent(editor)).toBe("a\tb");
  });

  it("Escape then Tab does not insert a tab", async () => {
    installServer({ streams: [{ bytes: enc("ab") }] });
    openTxt();
    const editor = await findEditor();
    const driver = await import("./editorTestDriver");
    const view = driver.getEditorView(editor);
    act(() => view.dispatch({ selection: { anchor: 1 } }));
    fireEvent.keyDown(view.contentDOM, { key: "Escape", keyCode: 27 });
    fireEvent.keyDown(view.contentDOM, { key: "Tab", keyCode: 9 });
    expect(editorContent(editor)).toBe("ab");
  });

  it("pasting or dropping an image inserts nothing and uploads nothing", async () => {
    const server = installServer({ streams: [{ bytes: enc("body") }] });
    openTxt();
    const editor = await findEditor();
    const file = new File(["data"], "pic.png", { type: "image/png" });
    fireEvent.paste(editor, {
      clipboardData: { items: [{ type: "image/png", getAsFile: () => file }] },
    });
    fireEvent.drop(editor, { dataTransfer: { files: [file] } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(editorContent(editor)).toBe("body");
    expect(server.urls.filter((u) => u.includes("upload"))).toEqual([]);
  });

  it("types no Markdown styling: a Markdown-looking line gets no decoration classes", async () => {
    installServer({ streams: [{ bytes: enc("# not a heading\n**not bold**") }] });
    openTxt();
    const editor = await findEditor();
    const root = editor.closest(".cm-editor")!;
    expect(root.querySelector("[class*='cm-md'], [class*='heading']")).toBeNull();
  });
});

describe("SPEC-CORE-020 the Read view and the two-way switch (I5, I6)", () => {
  it("never enters Split on the shortcut and does not render Markdown preview", async () => {
    installServer({ streams: [{ bytes: enc("hello") }] });
    const { seen } = openTxt();
    await findEditor();
    await shortcutsReady("Keep this version");
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      pressMod(document, "\\", { shiftKey: true });
      await act(async () => {
        vi.advanceTimersByTime(10);
      });
      order.push(screen.getByTestId("view-mode").textContent ?? "");
    }
    expect(order).toEqual(["preview", "edit", "preview", "edit"]);
    expect(seen).not.toContain("split");
    expect(screen.queryByTestId("md-preview")).toBeNull();
  });

  it("Read shows the editor's current buffer, one line element per line", async () => {
    installServer({ streams: [{ bytes: enc("saved text") }] });
    openTxt();
    const editor = await findEditor();
    setEditorContent(editor, "first\nsecond\nthird");
    toRead();
    await waitFor(() => {
      const pre = document.querySelector("pre");
      expect(pre?.querySelectorAll(".code-line")).toHaveLength(3);
      expect(pre?.textContent).toBe("first\nsecond\nthird");
    });
    expect(screen.queryByTestId("md-preview")).toBeNull();
  });

  it("Read of a file above the decoration limits shows the text with the too-large notice", async () => {
    installServer({ streams: [{ bytes: enc("x\n".repeat(6000)) }] });
    openTxt();
    await findEditor();
    toRead();
    await waitFor(() => expect(document.querySelector("pre")).not.toBeNull());
    expect(document.querySelector(".code-line")).toBeNull();
    expect(screen.getByText(/line numbers/i)).toBeInTheDocument();
  });

  it("Read highlights the search term, also when the page opened in Edit", async () => {
    globalThis.__editParam__ = "edit=1";
    installServer({ streams: [{ bytes: enc("alpha\nbeta\ngamma") }] });
    openTxt({ highlight: "beta" });
    await findEditor();
    toRead();
    await waitFor(() => {
      const mark = document.querySelector("pre mark.ask-citation-highlight");
      expect(mark?.textContent).toBe("beta");
    });
  });

  it("offers to quote a selection made in Read", async () => {
    installServer({ streams: [{ bytes: enc("alpha\nbeta") }] });
    openTxt();
    await findEditor();
    toRead();
    await waitFor(() => expect(document.querySelector("pre")).not.toBeNull());
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("pre")!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event("selectionchange"));
    const button = await screen.findByRole("button", { name: "Add selection to capture basket" });
    fireEvent.click(button);
    expect(getSourceCaptures("d")).toEqual([
      expect.objectContaining({
        sourceFileId: "f1",
        filename: "note.txt",
        kind: "document_selection",
      }),
    ]);
  });
});

describe("SPEC-ADDON-037 version history of a .txt (I10)", () => {
  it("shows a version's text raw, with no link decoding", async () => {
    installServer({
      streams: [{ bytes: enc("now"), etag: "v1" }],
      versions: [{ id: 2, content: "[a](#%E4%B8%80)" }],
    });
    openTxt();
    await findEditor();
    fireEvent.click(openMenu("Version history"));
    await waitFor(() =>
      expect(screen.getByTestId("version-preview")).toHaveTextContent(
        "[a](#%E4%B8%80)",
      ),
    );
  });

  it("restores a version in the file's own form, after saving the draft in that form", async () => {
    const server = installServer({
      streams: [
        { bytes: enc("﻿current\r\ntext"), etag: "held" },
        { bytes: enc("﻿old\r\nline\r\nend"), etag: "after-restore" },
      ],
      putResponses: [
        { status: 200, etag: "after-draft" },
        { status: 200, etag: "after-restore" },
      ],
      versions: [{ id: 2, content: "﻿old\nline\rend" }],
    });
    openTxt();
    const editor = await findEditor();
    setEditorContent(editor, "draft\nbody");
    fireEvent.click(
      await (async () => {
        fireEvent.click(openMenu("Version history"));
        return screen.findByRole("button", { name: "Restore this version" });
      })(),
    );
    await waitFor(() => expect(server.puts).toHaveLength(2));
    expect(server.puts[0].body).toEqual(
      Array.from(enc("﻿draft\r\nbody")),
    );
    expect(server.puts[1].body).toEqual(
      Array.from(enc("﻿old\r\nline\r\nend")),
    );
    await waitFor(() => expect(editorContent(editor)).toBe("old\nline\nend"));
  });
});
