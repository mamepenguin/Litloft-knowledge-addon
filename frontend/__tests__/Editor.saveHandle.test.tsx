import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";

import { dirtyRegistry } from "@/lib/dirtyRegistry";
import { setEditorContent } from "./editorTestDriver";
import type { EditorSaveHandle } from "../editorSaveHandle";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => null,
}));
vi.mock("@/hooks/useShortcuts", () => ({
  useShortcuts: () => undefined,
}));

const Editor = (await import("../Editor")).default;

type Put = { body: string; resolve: (r: PutReply) => void };
type PutReply = { status: number };

let puts: Put[] = [];
let manualPuts = false;
let getText = "hello";
let getHold: Promise<void> | null = null;

function reply(status: number, etag: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ etag: `"${etag}"` }),
    json: async () => ({}),
    text: async () => getText,
  } as Response;
}

function stubFetch() {
  puts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "PUT" && url.includes("/content")) {
        const body = String(init.body);
        if (!manualPuts) {
          puts.push({ body, resolve: () => undefined });
          return reply(200, `e${puts.length}`);
        }
        return new Promise<Response>((res) => {
          puts.push({
            body,
            resolve: (r) =>
              res(reply(r.status, `e${puts.length}`)),
          });
        });
      }
      if (url.includes("/stream")) {
        if (getHold) await getHold;
        return reply(200, "e0");
      }
      return reply(200, "x");
    }),
  );
}

function mount(
  handle: React.MutableRefObject<EditorSaveHandle | null>,
  fileId = "f1",
  extra: Record<string, unknown> = {},
) {
  const el = (id: string) => (
    <Editor
      fileId={id}
      filename="note.md"
      drive="d"
      onBack={() => undefined}
      inlineMode
      saveHandle={handle}
      {...extra}
    />
  );
  const view = render(el(fileId));
  return { view, rerenderWith: (id: string) => view.rerender(el(id)) };
}

const tick = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });
const answer = (i: number, status: number) =>
  act(async () => {
    puts[i].resolve({ status });
  });
const settle = () => act(async () => {});

beforeEach(() => {
  manualPuts = false;
  getText = "hello";
  getHold = null;
  dirtyRegistry.reset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  dirtyRegistry.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Editor saveHandle: lifetime (SPEC-ADDON-132 Library step 6, I5)", () => {
  it("is null while the content has not loaded, set once it has", async () => {
    stubFetch();
    let release: () => void = () => undefined;
    getHold = new Promise<void>((r) => (release = r));
    const handle = createRef<EditorSaveHandle | null>() as React.MutableRefObject<EditorSaveHandle | null>;
    handle.current = null;
    mount(handle);
    await settle();
    expect(handle.current).toBeNull();

    release();
    await screen.findByLabelText("editArea");
    expect(handle.current).not.toBeNull();
  });

  it("is null again on unmount", async () => {
    stubFetch();
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    const { view } = mount(handle);
    await screen.findByLabelText("editArea");
    expect(handle.current).not.toBeNull();
    view.unmount();
    expect(handle.current).toBeNull();
  });

  it("is null while another file loads, then set for the new file", async () => {
    stubFetch();
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    const { rerenderWith } = mount(handle, "f1");
    await screen.findByLabelText("editArea");
    expect(handle.current).not.toBeNull();

    let release: () => void = () => undefined;
    getHold = new Promise<void>((r) => (release = r));
    rerenderWith("f2");
    expect(handle.current).toBeNull();
    await settle();
    expect(handle.current).toBeNull();

    release();
    await settle();
    await screen.findByLabelText("editArea");
    expect(handle.current).not.toBeNull();
  });
});

describe("Editor saveHandle: dirty() (SPEC-ADDON-132 Library step 6)", () => {
  it("is false when loaded, true inside the debounce, false after the save", async () => {
    stubFetch();
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle);
    const editor = await screen.findByLabelText("editArea");
    expect(handle.current!.dirty()).toBe(false);

    setEditorContent(editor, "hello world");
    await tick(500);
    expect(puts).toHaveLength(0);
    expect(handle.current!.dirty()).toBe(true);

    await tick(1600);
    await settle();
    expect(puts).toHaveLength(1);
    expect(handle.current!.dirty()).toBe(false);
  });
});

describe("Editor saveHandle: flush() (SPEC-ADDON-132 Library step 6, I4)", () => {
  it("with nothing unsaved resolves saved and writes nothing", async () => {
    stubFetch();
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle);
    await screen.findByLabelText("editArea");
    await expect(handle.current!.flush()).resolves.toBe("saved");
    expect(puts).toHaveLength(0);
  });

  it("inside the debounce saves now and cancels the pending autosave", async () => {
    stubFetch();
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle);
    const editor = await screen.findByLabelText("editArea");
    setEditorContent(editor, "typed");
    await tick(300);
    expect(puts).toHaveLength(0);

    let result: string | undefined;
    await act(async () => {
      result = await handle.current!.flush();
    });
    expect(result).toBe("saved");
    expect(puts.map((p) => p.body)).toEqual(["typed"]);

    await tick(5000);
    await settle();
    expect(puts).toHaveLength(1);
  });

  it("does not resolve before the save is answered, and not saved before then", async () => {
    stubFetch();
    manualPuts = true;
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle);
    const editor = await screen.findByLabelText("editArea");
    setEditorContent(editor, "typed");

    let result: string | undefined;
    const p = handle.current!.flush().then((r) => (result = r));
    await settle();
    expect(puts).toHaveLength(1);
    expect(result).toBeUndefined();
    await answer(0, 200);
    await act(async () => {
      await p;
    });
    expect(result).toBe("saved");
  });

  it("saves again when newer text arrives during an in-flight save", async () => {
    stubFetch();
    manualPuts = true;
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle);
    const editor = await screen.findByLabelText("editArea");
    setEditorContent(editor, "first");

    let result: string | undefined;
    const p = handle.current!.flush().then((r) => (result = r));
    await settle();
    expect(puts.map((x) => x.body)).toEqual(["first"]);

    setEditorContent(editor, "first and more");
    await answer(0, 200);
    await settle();
    expect(result).toBeUndefined();
    expect(puts.map((x) => x.body)).toEqual(["first", "first and more"]);

    await answer(1, 200);
    await act(async () => {
      await p;
    });
    expect(result).toBe("saved");
    expect(handle.current!.dirty()).toBe(false);
    await tick(5000);
    await settle();
    expect(puts).toHaveLength(2);
  });

  it("waits for an autosave already in flight instead of resolving over it", async () => {
    stubFetch();
    manualPuts = true;
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle);
    const editor = await screen.findByLabelText("editArea");
    setEditorContent(editor, "typed");
    await tick(2100);
    expect(puts).toHaveLength(1);

    let result: string | undefined;
    const p = handle.current!.flush().then((r) => (result = r));
    await settle();
    expect(result).toBeUndefined();
    await answer(0, 200);
    await act(async () => {
      await p;
    });
    expect(result).toBe("saved");
    expect(puts).toHaveLength(1);
  });

  it("cancels a debounce that was pending behind an autosave already in flight", async () => {
    stubFetch();
    manualPuts = true;
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle);
    const editor = await screen.findByLabelText("editArea");
    setEditorContent(editor, "typed");
    await tick(2100);
    expect(puts).toHaveLength(1);
    setEditorContent(editor, "typed more");

    let result: string | undefined;
    const p = handle.current!.flush().then((r) => (result = r));
    await tick(2500);
    expect(puts).toHaveLength(1);

    await answer(0, 200);
    await settle();
    expect(puts.map((x) => x.body)).toEqual(["typed", "typed more"]);
    await answer(1, 200);
    await act(async () => {
      await p;
    });
    expect(result).toBe("saved");
    await tick(5000);
    expect(puts).toHaveLength(2);
  });

  it("resolves failed when the save fails", async () => {
    stubFetch();
    manualPuts = true;
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle);
    const editor = await screen.findByLabelText("editArea");
    setEditorContent(editor, "typed");
    const p = handle.current!.flush();
    await settle();
    await answer(0, 500);
    await expect(p).resolves.toBe("failed");
    expect(handle.current!.dirty()).toBe(true);
  });

  it("resolves conflict when the server answers 412", async () => {
    stubFetch();
    manualPuts = true;
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle);
    const editor = await screen.findByLabelText("editArea");
    setEditorContent(editor, "typed");
    const p = handle.current!.flush();
    await settle();
    await answer(0, 412);
    await expect(p).resolves.toBe("conflict");
  });

  it("stops at the first failing save when newer text was typed meanwhile", async () => {
    stubFetch();
    manualPuts = true;
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle);
    const editor = await screen.findByLabelText("editArea");
    setEditorContent(editor, "first");
    const p = handle.current!.flush();
    await settle();
    setEditorContent(editor, "first and more");
    await answer(0, 412);
    await expect(p).resolves.toBe("conflict");
    expect(puts).toHaveLength(1);
  });
});

describe("Editor saveHandle: plain-text block (SPEC-ADDON-132 Library step 6)", () => {
  const enc = (t: string | number[]) =>
    typeof t === "string"
      ? new TextEncoder().encode(t)
      : new Uint8Array(t);

  function stubPlain(streams: Uint8Array[]) {
    puts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (init?.method === "PUT") {
          return new Promise<Response>((res) => {
            puts.push({
              body: String(init.body),
              resolve: (r) => res(reply(r.status, "e9")),
            });
          });
        }
        if (url.includes("/stream")) {
          const bytes = streams.shift() ?? enc("");
          return {
            ok: true,
            status: 200,
            headers: new Headers({ etag: '"e0"' }),
            arrayBuffer: async () =>
              bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
              ),
            json: async () => ({}),
            text: async () => "",
          } as unknown as Response;
        }
        return reply(200, "x");
      }),
    );
  }

  it("not dirty and blocked: resolves saved without writing", async () => {
    stubPlain([enc([0xff, 0xfe])]);
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle, "f1", { plainText: true });
    await screen.findByText("notUtf8");
    expect(handle.current!.dirty()).toBe(false);
    await expect(handle.current!.flush()).resolves.toBe("saved");
    expect(puts).toHaveLength(0);
  });

  it("dirty and blocked (held text): resolves failed without writing", async () => {
    stubPlain([enc("one"), enc("a\r\nb\nc")]);
    const handle = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    mount(handle, "f1", { plainText: true });
    const editor = await screen.findByLabelText("plainEditArea");
    setEditorContent(editor, "my precious text");
    const first = handle.current!.flush();
    await settle();
    await answer(0, 412);
    await expect(first).resolves.toBe("conflict");

    fireEvent.click(await screen.findByRole("button", { name: /overwrite/i }));
    await screen.findByText("mixedEndings");
    expect(puts).toHaveLength(1);

    expect(handle.current!.dirty()).toBe(true);
    await expect(handle.current!.flush()).resolves.toBe("failed");
    expect(puts).toHaveLength(1);
  });
});
