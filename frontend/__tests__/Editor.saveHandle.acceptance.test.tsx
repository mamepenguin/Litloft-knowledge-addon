/**
 * SPEC-ADDON-132 Library step 6: the Knowledge editor's optional `saveHandle`.
 * Invariant ids are those of docs/specs/notes-app.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";

import { installWireFetch, json, type WireCall } from "@/__tests__/helpers/wireFetch";
import { dirtyRegistry } from "@/lib/dirtyRegistry";
import { MarkdownChromeProvider } from "@/lib/markdownChromeContext";
import { setEditorContent } from "./editorTestDriver";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, vars?: Record<string, string | number>) =>
      vars ? Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), key) : key,
}));
vi.mock("@/components/MarkdownPreview", () => ({ MarkdownPreview: () => null }));
vi.mock("@/hooks/useShortcuts", () => ({ useShortcuts: () => undefined }));

const Editor = (await import("../Editor")).default;

type Outcome = "saved" | "failed" | "conflict";
interface Handle {
  dirty(): boolean;
  flush(): Promise<Outcome>;
}
type HandleRef = { current: Handle | null };

const DEBOUNCE_PAST = 2100;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let calls: WireCall[];
let bodies: Record<string, string>;
let putPlan: Array<() => Response | Promise<Response>>;
let heldStream: Record<string, Promise<void> | undefined>;
let version: number;

const puts = () => calls.filter((c) => c.method === "PUT" && /\/api\/files\/[^/]+\/content$/.test(c.url.pathname));

beforeEach(() => {
  dirtyRegistry.reset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  bodies = { f1: "hello", f2: "second file" };
  putPlan = [];
  heldStream = {};
  version = 1;
  calls = installWireFetch(async (call) => {
    const stream = /^\/api\/files\/([^/]+)\/stream$/.exec(call.url.pathname);
    if (stream && call.method === "GET") {
      await heldStream[stream[1]];
      return new Response(bodies[stream[1]], { status: 200, headers: { etag: `"${stream[1]}-v1"` } });
    }
    const put = /^\/api\/files\/([^/]+)\/content$/.exec(call.url.pathname);
    if (put && call.method === "PUT") {
      const planned = putPlan.shift();
      if (planned) return planned();
      version += 1;
      return new Response(null, { status: 200, headers: { etag: `"${put[1]}-v${version}"` } });
    }
    return json({ detail: "not found" }, 404);
  }).calls;
});

afterEach(() => {
  cleanup();
  dirtyRegistry.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(saveHandle: HandleRef, props: Partial<ComponentProps<typeof Editor>> = {}) {
  return render(
    <Editor
      fileId="f1"
      filename="note.md"
      drive="d"
      onBack={() => undefined}
      inlineMode
      {...({ saveHandle } as object)}
      {...props}
    />,
  );
}

async function loaded(): Promise<HTMLElement> {
  return screen.findByLabelText("editArea");
}

function handleOf(ref: HandleRef): Handle {
  expect(ref.current).not.toBeNull();
  return ref.current!;
}

describe("SPEC-ADDON-132 step 6: when the handle is set", () => {
  it("SPEC-ADDON-132 is set once the content has loaded, and not before", async () => {
    const hold = deferred<void>();
    heldStream.f1 = hold.promise;
    const ref = createRef<Handle>() as HandleRef;
    mount(ref);

    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(ref.current).toBeNull();

    await act(async () => hold.resolve());
    await loaded();
    await waitFor(() => expect(ref.current).not.toBeNull());
    expect(handleOf(ref).dirty()).toBe(false);
  });

  it("SPEC-ADDON-132 goes back to null on unmount", async () => {
    const ref = createRef<Handle>() as HandleRef;
    const view = mount(ref);
    await loaded();
    await waitFor(() => expect(ref.current).not.toBeNull());

    view.unmount();

    expect(ref.current).toBeNull();
  });

  it("SPEC-ADDON-132 goes back to null before another file loads, then is set for that file", async () => {
    const ref = createRef<Handle>() as HandleRef;
    const view = mount(ref);
    await loaded();
    await waitFor(() => expect(ref.current).not.toBeNull());
    const first = ref.current;
    const hold = deferred<void>();
    heldStream.f2 = hold.promise;

    view.rerender(
      <Editor fileId="f2" filename="second.md" drive="d" onBack={() => undefined} inlineMode {...({ saveHandle: ref } as object)} />,
    );
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(ref.current).toBeNull();

    await act(async () => hold.resolve());
    await waitFor(() => expect(ref.current).not.toBeNull());
    expect(ref.current).not.toBe(first);
  });
});

describe("SPEC-ADDON-132 step 6: dirty and flush", () => {
  it("SPEC-ADDON-132 dirty is true inside the autosave debounce, and flush saves the current text at once", async () => {
    const ref = createRef<Handle>() as HandleRef;
    mount(ref);
    const editor = await loaded();
    await waitFor(() => expect(ref.current).not.toBeNull());

    setEditorContent(editor, "hello world");
    expect(handleOf(ref).dirty()).toBe(true);
    expect(puts()).toHaveLength(0);

    let outcome: Outcome | undefined;
    await act(async () => {
      outcome = await handleOf(ref).flush();
    });

    expect(outcome).toBe("saved");
    expect(puts().map((c) => c.body)).toEqual(["hello world"]);
    expect(handleOf(ref).dirty()).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_PAST);
    });
    expect(puts()).toHaveLength(1);
  });

  it("SPEC-ADDON-132 with nothing unsaved flush resolves saved and sends nothing", async () => {
    const ref = createRef<Handle>() as HandleRef;
    mount(ref);
    await loaded();
    await waitFor(() => expect(ref.current).not.toBeNull());

    let outcome: Outcome | undefined;
    await act(async () => {
      outcome = await handleOf(ref).flush();
    });

    expect(outcome).toBe("saved");
    expect(puts()).toHaveLength(0);
  });

  it("SPEC-ADDON-132 text typed while a save is in flight is saved again before flush resolves", async () => {
    const ref = createRef<Handle>() as HandleRef;
    mount(ref);
    const editor = await loaded();
    await waitFor(() => expect(ref.current).not.toBeNull());
    const firstPut = deferred<Response>();
    putPlan.push(() => firstPut.promise);

    setEditorContent(editor, "first edit");
    let outcome: Outcome | undefined;
    let flushed: Promise<void> = Promise.resolve();
    act(() => {
      flushed = handleOf(ref).flush().then((o) => {
        outcome = o;
      });
    });
    await waitFor(() => expect(puts()).toHaveLength(1));
    setEditorContent(editor, "first edit, then more");
    await act(async () => {
      firstPut.resolve(new Response(null, { status: 200, headers: { etag: '"f1-v2"' } }));
    });
    await act(async () => {
      await flushed;
    });

    expect(outcome).toBe("saved");
    expect(puts().map((c) => c.body)).toEqual(["first edit", "first edit, then more"]);
    expect(handleOf(ref).dirty()).toBe(false);
  });

  it.each([
    [500, "failed"],
    [412, "conflict"],
  ] as const)("SPEC-ADDON-132 a save answered %s resolves %s", async (status, expected) => {
    const ref = createRef<Handle>() as HandleRef;
    mount(ref);
    const editor = await loaded();
    await waitFor(() => expect(ref.current).not.toBeNull());
    putPlan.push(() => new Response(JSON.stringify({ detail: "x" }), { status, headers: { etag: '"f1-v9"' } }));

    setEditorContent(editor, "will not land");
    let outcome: Outcome | undefined;
    await act(async () => {
      outcome = await handleOf(ref).flush();
    });

    expect(outcome).toBe(expected);
    expect(handleOf(ref).dirty()).toBe(true);
  });
});

describe("SPEC-ADDON-132 Library step 5: the toolbar's rule", () => {
  const chrome = { viewMode: "edit" as const, setViewMode: () => undefined, publishSaveState: () => undefined, isMobile: false };

  function toolbarRoot(): HTMLElement {
    return document.querySelector(".sticky.top-0 > div") as HTMLElement;
  }

  // The file page wraps the editor in the same provider the Notes pane does.
  function underChrome(props: Partial<ComponentProps<typeof Editor>>) {
    return render(
      <MarkdownChromeProvider value={chrome}>
        <Editor fileId="f1" filename="note.md" drive="d" onBack={() => undefined} inlineMode fillHeight {...props} />
      </MarkdownChromeProvider>,
    );
  }

  const editorHost = () => document.querySelector("div.bg-bg-primary.w-full") as HTMLElement;
  const historyPanel = () => document.querySelector("section.bg-bg-card") as HTMLElement;

  it("the file page, under the chrome provider, keeps the rule under the toolbar and above the history", async () => {
    underChrome({});
    await loaded();
    expect(toolbarRoot().className).toContain("border-b");
    expect(historyPanel().className).toContain("border-t");
    expect(toolbarRoot().className).toContain("px-3");
    expect(editorHost().className).not.toContain("cm-content");
  });

  it("a host that asks for it gets a toolbar with no rule under it", async () => {
    underChrome({ frameless: true } as object);
    await loaded();
    expect(toolbarRoot().className).not.toContain("border-b");
    expect(historyPanel().className).not.toContain("border-t");
    expect(toolbarRoot().className).not.toContain("px-3");
    expect(editorHost().className).toContain("cm-content");
  });
});
