import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { dirtyRegistry } from "@/lib/dirtyRegistry";
import { setEditorContent } from "./editorTestDriver";

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

let calls: string[] = [];

function stubFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? ` ${init.body}` : "";
      calls.push(`${method} ${url}${body}`);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ etag: '"v1"' }),
        json: async () => ({}),
        text: async () => "hello",
      } as Response;
    }),
  );
}

function renderEditor(props: Record<string, unknown> = {}) {
  return render(
    <Editor
      fileId="f1"
      filename="note.md"
      drive="d"
      onBack={() => undefined}
      inlineMode
      {...props}
    />,
  );
}

const relevant = () =>
  calls.filter((c) => c.includes("/stream") || c.includes("/content"));

beforeEach(() => {
  dirtyRegistry.reset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  dirtyRegistry.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// SPEC-ADDON-132 I12: an Editor given no saveHandle makes the same requests,
// in the same order, at the same times relative to typing.
describe("Editor request sequence without saveHandle (SPEC-ADDON-132 I12)", () => {
  it("type then wait: one GET, then one PUT only after the 2s debounce", async () => {
    stubFetch();
    renderEditor();
    const editor = await screen.findByLabelText("editArea");
    setEditorContent(editor, "hello world");

    await act(async () => {
      vi.advanceTimersByTime(1900);
    });
    expect(relevant()).toEqual(["GET /api/files/f1/stream"]);

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(relevant()).toEqual([
      "GET /api/files/f1/stream",
      "PUT /api/files/f1/content hello world",
    ]);
  });

  it("type then unmount: one GET, then one PUT on unmount, no more", async () => {
    stubFetch();
    const view = renderEditor();
    const editor = await screen.findByLabelText("editArea");
    setEditorContent(editor, "hello world");
    expect(relevant()).toEqual(["GET /api/files/f1/stream"]);

    view.unmount();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(relevant()).toEqual([
      "GET /api/files/f1/stream",
      "PUT /api/files/f1/content hello world",
    ]);
  });
});
