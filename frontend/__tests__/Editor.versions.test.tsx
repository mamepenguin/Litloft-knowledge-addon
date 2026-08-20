import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { editorContent, setEditorContent } from "./editorTestDriver";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) =>
    (key: string, vars?: Record<string, string | number>) => {
      let value = `${namespace}.${key}`;
      if (vars) value += `:${Object.values(vars).join(":")}`;
      return value;
    },
}));

vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => null,
}));

vi.mock("@/components/PropertiesPanel", () => ({
  PropertiesPanel: () => null,
}));

const Editor = (await import("../Editor")).default;

function response({
  ok = true,
  status = ok ? 200 : 400,
  body,
  text = "",
  headers,
}: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}): Response {
  return {
    ok,
    status,
    headers: new Headers(headers ?? {}),
    json: async () => body,
    text: async () => text,
  } as Response;
}

function renderEditor() {
  return render(
    <ShortcutsProvider>
      <Editor fileId="f1" filename="note.md" drive="d" inlineMode />
    </ShortcutsProvider>,
  );
}

beforeEach(() => {
  dirtyRegistry.reset();
  markdownContentRegistry.reset();
});

afterEach(() => {
  cleanup();
  dirtyRegistry.reset();
  markdownContentRegistry.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Editor explicit versions", () => {
  it("prevents the browser shortcut and creates an explicit version even when clean", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/files/f1/stream")) {
          return response({ text: "already saved", headers: { etag: '"held"' } });
        }
        if (url.endsWith("/api/files/f1/content") && init?.method === "PUT") {
          return response({
            headers: {
              etag: '"after-explicit"',
              "x-litloft-version-action": "unchanged",
            },
          });
        }
        if (url.includes("/resync-tags/")) return response({});
        return response({ ok: false, status: 404, body: { detail: "not found" } });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderEditor();
    const textarea = await screen.findByLabelText("knowledge.editor.editArea");
    // The shortcut context is enabled only after the async content load.
    // Open the real provider's cheat sheet once to wait until that context
    // has been pushed, then close it before dispatching from the textarea.
    fireEvent.keyDown(document, { key: "?" });
    await screen.findByText("knowledge.shortcuts.keepVersion");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByText("knowledge.shortcuts.keepVersion"),
      ).not.toBeInTheDocument(),
    );
    textarea.focus();

    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
      cancelable: true,
    });
    act(() => textarea.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/api/files/f1/content") &&
          (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      expect(putCall?.[1]?.body).toBe("already saved");
      expect(putCall?.[1]?.headers).toMatchObject({
        "If-Match": '"held"',
        "X-Litloft-Save-Kind": "explicit",
      });
    });
    expect(
      await screen.findByText("knowledge.editor.status.noChanges"),
    ).toBeInTheDocument();
  });

  it("keeps dirty content explicitly and cancels its pending autosave", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const puts: RequestInit[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/files/f1/stream")) {
          return response({ text: "initial", headers: { etag: '"held"' } });
        }
        if (url.endsWith("/api/files/f1/content") && init?.method === "PUT") {
          puts.push(init);
          return response({ headers: { etag: '"after-explicit"' } });
        }
        if (url.includes("/resync-tags/")) return response({});
        return response({ ok: false, status: 404, body: { detail: "not found" } });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderEditor();
    const textarea = await screen.findByLabelText("knowledge.editor.editArea");
    setEditorContent(textarea, "dirty body");
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.toolbar.keepVersion",
      }),
    );

    await waitFor(() => expect(puts).toHaveLength(1));
    await act(async () => vi.advanceTimersByTime(2500));
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toBe("dirty body");
    expect(puts[0].headers).toMatchObject({
      "If-Match": '"held"',
      "X-Litloft-Save-Kind": "explicit",
    });
  });

  it("serializes an explicit version behind an in-flight autosave", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveAutosave!: (value: Response) => void;
    const autosaveResponse = new Promise<Response>((resolve) => {
      resolveAutosave = resolve;
    });
    const contentPuts: RequestInit[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/files/f1/stream")) {
          return response({ text: "initial", headers: { etag: '"held"' } });
        }
        if (url.endsWith("/api/files/f1/content") && init?.method === "PUT") {
          contentPuts.push(init);
          if (contentPuts.length === 1) return autosaveResponse;
          return response({ headers: { etag: '"after-explicit"' } });
        }
        if (url.includes("/resync-tags/")) return response({});
        return response({ ok: false, status: 404, body: { detail: "not found" } });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderEditor();
    const textarea = await screen.findByLabelText("knowledge.editor.editArea");
    setEditorContent(textarea, "autosave body");
    await act(async () => vi.advanceTimersByTime(2100));
    await waitFor(() => expect(contentPuts).toHaveLength(1));

    setEditorContent(textarea, "explicit body");
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.toolbar.keepVersion",
      }),
    );
    expect(contentPuts).toHaveLength(1);

    await act(async () => {
      resolveAutosave(response({ headers: { etag: '"after-auto"' } }));
    });
    await waitFor(() => expect(contentPuts).toHaveLength(2));
    expect(contentPuts[1].body).toBe("explicit body");
    expect(contentPuts[1].headers).toMatchObject({
      "If-Match": '"after-auto"',
      "X-Litloft-Save-Kind": "explicit",
    });
  });

  it("restores with the editor-held ETag and surfaces a 412 in the existing conflict UI", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/files/f1/stream")) {
          return response({ text: "current", headers: { etag: '"stale-held"' } });
        }
        if (url.includes("/api/files/f1/versions?") && !init?.method) {
          return response({
            body: {
              versions: [
                {
                  id: 2,
                  created_at: "2026-08-20T12:00:00Z",
                  nickname: "Aki",
                  kind: "explicit",
                  size_bytes: 3,
                  lines_added: 1,
                  lines_removed: 1,
                },
              ],
              total: 1,
              limit: 50,
              offset: 0,
            },
          });
        }
        if (url.endsWith("/api/files/f1/versions/2/diff")) {
          return response({
            body: {
              id: 2,
              lines: [
                { kind: "del", text: "current\n" },
                { kind: "add", text: "old" },
              ],
              lines_added: 1,
              lines_removed: 1,
            },
          });
        }
        if (url.endsWith("/api/files/f1/versions/2")) {
          return response({ body: { id: 2, content: "old", etag: "version-etag" } });
        }
        if (url.endsWith("/api/files/f1/content") && init?.method === "PUT") {
          return response({ ok: false, status: 412, body: { detail: "conflict" } });
        }
        return response({ ok: false, status: 404, body: { detail: "not found" } });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderEditor();
    const textarea = await screen.findByLabelText("knowledge.editor.editArea");
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.toggleOpen",
      }),
    );
    await screen.findByText("Aki");
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.restore",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("knowledge.editor.conflict.title"),
      ).toBeInTheDocument();
    });
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/api/files/f1/content") &&
        (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall?.[1]?.headers).toMatchObject({
      "If-Match": '"stale-held"',
      "X-Litloft-Save-Kind": "explicit",
    });
    expect(editorContent(textarea)).toBe("current");
  });

  it("applies a restored body through the reload state path and cancels pending autosave", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const contentPuts: RequestInit[] = [];
    let streamReads = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/files/f1/stream")) {
          streamReads += 1;
          return streamReads === 1
            ? response({ text: "current", headers: { etag: '"held"' } })
            : response({
                text: "---\nid: injected\n---\nrestored",
                headers: { etag: '"after-live-reload"' },
              });
        }
        if (url.includes("/api/files/f1/versions?")) {
          return response({
            body: {
              versions: [
                {
                  id: 2,
                  created_at: "2026-08-20T12:00:00Z",
                  nickname: null,
                  kind: "auto",
                  size_bytes: 3,
                  lines_added: 1,
                  lines_removed: 1,
                },
              ],
              total: 1,
              limit: 50,
              offset: 0,
            },
          });
        }
        if (url.endsWith("/api/files/f1/versions/2/diff")) {
          return response({
            body: {
              id: 2,
              lines: [{ kind: "add", text: "restored" }],
              lines_added: 1,
              lines_removed: 0,
            },
          });
        }
        if (url.endsWith("/api/files/f1/versions/2")) {
          return response({ body: { id: 2, content: "restored", etag: "ignored" } });
        }
        if (url.endsWith("/api/files/f1/content") && init?.method === "PUT") {
          contentPuts.push(init);
          if (contentPuts.length === 1) {
            return response({ headers: { etag: '"after-draft"' } });
          }
          if (contentPuts.length === 2) {
            return response({ headers: { etag: '"after-restore"' } });
          }
          return response({ headers: { etag: '"after-edit"' } });
        }
        if (url.includes("/resync-tags/")) return response({});
        return response({ ok: false, status: 404, body: { detail: "not found" } });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderEditor();
    const textarea = await screen.findByLabelText("knowledge.editor.editArea");
    setEditorContent(textarea, "pending local edit");
    expect(dirtyRegistry.isDirty("f1")).toBe(true);

    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.toggleOpen",
      }),
    );
    await screen.findByRole("button", {
      name: "knowledge.editor.versions.restore",
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.restore",
      }),
    );

    await waitFor(() =>
      expect(editorContent(textarea)).toBe("---\nid: injected\n---\nrestored"),
    );
    expect(markdownContentRegistry.lookup("f1")?.getContent()).toBe(
      "---\nid: injected\n---\nrestored",
    );
    expect(dirtyRegistry.isDirty("f1")).toBe(false);
    expect(streamReads).toBe(2);

    await act(async () => vi.advanceTimersByTime(2500));
    expect(contentPuts).toHaveLength(2);
    expect(contentPuts[0].body).toBe("pending local edit");
    expect(contentPuts[0].headers).toMatchObject({
      "If-Match": '"held"',
      "X-Litloft-Save-Kind": "explicit",
    });
    expect(contentPuts[1].body).toBe("restored");
    expect(contentPuts[1].headers).toMatchObject({
      "If-Match": '"after-draft"',
      "X-Litloft-Save-Kind": "explicit",
    });

    setEditorContent(textarea, "---\nid: injected\n---\nafter restore edit");
    await act(async () => vi.advanceTimersByTime(2100));
    await waitFor(() => expect(contentPuts).toHaveLength(3));
    expect(contentPuts[2].headers).toMatchObject({
      "If-Match": '"after-live-reload"',
    });
    expect(contentPuts[2].headers).not.toHaveProperty(
      "X-Litloft-Save-Kind",
    );
  });

  it("stops restore when preserving a dirty draft conflicts", async () => {
    let versionBodyReads = 0;
    const contentPuts: RequestInit[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/files/f1/stream")) {
          return response({ text: "current", headers: { etag: '"held"' } });
        }
        if (url.includes("/api/files/f1/versions?")) {
          return response({
            body: {
              versions: [
                {
                  id: 2,
                  created_at: "2026-08-20T12:00:00Z",
                  nickname: null,
                  kind: "auto",
                  size_bytes: 3,
                  lines_added: 1,
                  lines_removed: 0,
                },
              ],
              total: 1,
              limit: 50,
              offset: 0,
            },
          });
        }
        if (url.endsWith("/api/files/f1/versions/2/diff")) {
          return response({
            body: {
              id: 2,
              lines: [{ kind: "add", text: "old" }],
              lines_added: 1,
              lines_removed: 0,
            },
          });
        }
        if (url.endsWith("/api/files/f1/versions/2")) {
          versionBodyReads += 1;
          return response({ body: { id: 2, content: "old", etag: "ignored" } });
        }
        if (url.endsWith("/api/files/f1/content") && init?.method === "PUT") {
          contentPuts.push(init);
          return response({ ok: false, status: 412, body: { detail: "conflict" } });
        }
        return response({ ok: false, status: 404, body: { detail: "not found" } });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderEditor();
    const textarea = await screen.findByLabelText("knowledge.editor.editArea");
    setEditorContent(textarea, "unsaved draft");
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.toggleOpen",
      }),
    );
    await screen.findByTestId("version-preview");
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.restore",
      }),
    );

    await waitFor(
      () =>
        expect(
          screen.getByText("knowledge.editor.conflict.title"),
        ).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(contentPuts).toHaveLength(1);
    expect(contentPuts[0].body).toBe("unsaved draft");
    expect(versionBodyReads).toBe(1);
    expect(editorContent(textarea)).toBe("unsaved draft");
  });

  it("disables editing while loading a restore and aborts if content revision changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveRestoreBody!: (value: Response) => void;
    const restoreBody = new Promise<Response>((resolve) => {
      resolveRestoreBody = resolve;
    });
    let versionBodyReads = 0;
    const contentPuts: RequestInit[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/files/f1/stream")) {
          return response({ text: "current", headers: { etag: '"held"' } });
        }
        if (url.includes("/api/files/f1/versions?")) {
          return response({
            body: {
              versions: [
                {
                  id: 2,
                  created_at: "2026-08-20T12:00:00Z",
                  nickname: null,
                  kind: "auto",
                  size_bytes: 3,
                  lines_added: 1,
                  lines_removed: 0,
                },
              ],
              total: 1,
              limit: 50,
              offset: 0,
            },
          });
        }
        if (url.endsWith("/api/files/f1/versions/2/diff")) {
          return response({
            body: {
              id: 2,
              lines: [{ kind: "add", text: "old" }],
              lines_added: 1,
              lines_removed: 0,
            },
          });
        }
        if (url.endsWith("/api/files/f1/versions/2")) {
          versionBodyReads += 1;
          if (versionBodyReads === 1) {
            return response({ body: { id: 2, content: "old", etag: "ignored" } });
          }
          return restoreBody;
        }
        if (url.endsWith("/api/files/f1/content") && init?.method === "PUT") {
          contentPuts.push(init);
          return response({ headers: { etag: '"after-external"' } });
        }
        if (url.includes("/resync-tags/")) return response({});
        return response({ ok: false, status: 404, body: { detail: "not found" } });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderEditor();
    const textarea = await screen.findByLabelText("knowledge.editor.editArea");
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.toggleOpen",
      }),
    );
    await screen.findByTestId("version-preview");
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.restore",
      }),
    );

    await waitFor(() =>
      expect(textarea).toHaveAttribute("contenteditable", "false"),
    );
    expect(
      screen.getByRole("button", {
        name: "knowledge.editor.toolbar.keepVersion",
      }),
    ).toBeDisabled();

    act(() => {
      markdownContentRegistry.lookup("f1")?.setContent("external edit");
    });
    await act(async () => {
      resolveRestoreBody(
        response({ body: { id: 2, content: "old", etag: "ignored" } }),
      );
    });

    await waitFor(() =>
      expect(textarea).toHaveAttribute("contenteditable", "true"),
    );
    expect(editorContent(textarea)).toBe("external edit");
    expect(contentPuts).toHaveLength(0);

    await act(async () => vi.advanceTimersByTime(2100));
    await waitFor(() => expect(contentPuts).toHaveLength(1));
    expect(contentPuts[0].body).toBe("external edit");
    expect(contentPuts[0].headers).not.toHaveProperty(
      "X-Litloft-Save-Kind",
    );
  });

  it("does not apply a delayed save completion from file A after rerendering to file B", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveASave!: (value: Response) => void;
    const delayedASave = new Promise<Response>((resolve) => {
      resolveASave = resolve;
    });
    let aContentPuts = 0;
    const bContentPuts: RequestInit[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/files/a/stream")) {
          return response({ text: "alpha", headers: { etag: '"a-held"' } });
        }
        if (url.endsWith("/api/files/b/stream")) {
          return response({ text: "bravo", headers: { etag: '"b-held"' } });
        }
        if (url.endsWith("/api/files/a/content") && init?.method === "PUT") {
          aContentPuts += 1;
          return aContentPuts === 1
            ? delayedASave
            : response({ headers: { etag: '"a-cleanup"' } });
        }
        if (url.endsWith("/api/files/b/content") && init?.method === "PUT") {
          bContentPuts.push(init);
          return response({ headers: { etag: '"b-after"' } });
        }
        if (url.includes("/resync-tags/")) return response({});
        return response({ ok: false, status: 404, body: { detail: "not found" } });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <ShortcutsProvider>
        <Editor fileId="a" filename="a.md" drive="d" inlineMode />
      </ShortcutsProvider>,
    );
    const textarea = await screen.findByLabelText("knowledge.editor.editArea");
    setEditorContent(textarea, "alpha dirty");
    await act(async () => vi.advanceTimersByTime(2100));
    await waitFor(() => expect(aContentPuts).toBe(1));

    view.rerender(
      <ShortcutsProvider>
        <Editor fileId="b" filename="b.md" drive="d" inlineMode />
      </ShortcutsProvider>,
    );
    const bTextarea = await screen.findByLabelText("knowledge.editor.editArea");
    await waitFor(() => expect(editorContent(bTextarea)).toBe("bravo"));
    await act(async () => {
      resolveASave(response({ headers: { etag: '"a-after"' } }));
    });
    expect(editorContent(bTextarea)).toBe("bravo");
    expect(
      screen.queryByText("knowledge.editor.status.saved"),
    ).not.toBeInTheDocument();

    setEditorContent(bTextarea, "bravo dirty");
    await act(async () => vi.advanceTimersByTime(2100));
    await waitFor(() => expect(bContentPuts).toHaveLength(1));
    expect(bContentPuts[0].headers).toMatchObject({
      "If-Match": '"b-held"',
    });
  });

  it("does not apply a delayed restore completion from file A after rerendering to file B", async () => {
    let resolveARestore!: (value: Response) => void;
    const delayedARestore = new Promise<Response>((resolve) => {
      resolveARestore = resolve;
    });
    let aStreamReads = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/files/a/stream")) {
          aStreamReads += 1;
          return response({
            text: aStreamReads === 1 ? "alpha" : "alpha restored live",
            headers: { etag: aStreamReads === 1 ? '"a-held"' : '"a-live"' },
          });
        }
        if (url.endsWith("/api/files/b/stream")) {
          return response({ text: "bravo", headers: { etag: '"b-held"' } });
        }
        if (url.includes("/api/files/a/versions?")) {
          return response({
            body: {
              versions: [
                {
                  id: 2,
                  created_at: "2026-08-20T12:00:00Z",
                  nickname: null,
                  kind: "auto",
                  size_bytes: 3,
                  lines_added: 1,
                  lines_removed: 0,
                },
              ],
              total: 1,
              limit: 50,
              offset: 0,
            },
          });
        }
        if (url.endsWith("/api/files/a/versions/2/diff")) {
          return response({
            body: {
              id: 2,
              lines: [{ kind: "add", text: "old" }],
              lines_added: 1,
              lines_removed: 0,
            },
          });
        }
        if (url.endsWith("/api/files/a/versions/2")) {
          return response({ body: { id: 2, content: "alpha old", etag: "ignored" } });
        }
        if (url.endsWith("/api/files/a/content") && init?.method === "PUT") {
          return delayedARestore;
        }
        return response({ ok: false, status: 404, body: { detail: "not found" } });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <ShortcutsProvider>
        <Editor fileId="a" filename="a.md" drive="d" inlineMode />
      </ShortcutsProvider>,
    );
    const textarea = await screen.findByLabelText("knowledge.editor.editArea");
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.toggleOpen",
      }),
    );
    await screen.findByTestId("version-preview");
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.restore",
      }),
    );
    await waitFor(() =>
      expect(textarea).toHaveAttribute("contenteditable", "false"),
    );

    view.rerender(
      <ShortcutsProvider>
        <Editor fileId="b" filename="b.md" drive="d" inlineMode />
      </ShortcutsProvider>,
    );
    const bTextarea = await screen.findByLabelText("knowledge.editor.editArea");
    await waitFor(() => expect(editorContent(bTextarea)).toBe("bravo"));
    await act(async () => {
      resolveARestore(response({ headers: { etag: '"a-restored"' } }));
    });

    expect(editorContent(bTextarea)).toBe("bravo");
    expect(aStreamReads).toBe(1);
  });
});
