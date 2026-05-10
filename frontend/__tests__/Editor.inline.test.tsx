import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { dirtyRegistry } from "@/lib/dirtyRegistry";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, vars?: Record<string, string | number>) => {
      if (vars) {
        return Object.entries(vars).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
          key,
        );
      }
      return key;
    },
}));

vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => null,
}));

vi.mock("@/hooks/useShortcuts", () => ({
  useShortcuts: () => undefined,
}));

const Editor = (await import("../Editor")).default;

interface FetchSpec {
  ok: boolean;
  status?: number;
  text?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function stubFetch(plan: Record<string, FetchSpec[]>) {
  // Sort patterns longest-first so ``/api/files/f1/stream`` is matched
  // before ``/api/files/f1`` (the metadata endpoint).
  const orderedPatterns = Object.keys(plan).sort(
    (a, b) => b.length - a.length,
  );
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const pattern of orderedPatterns) {
      if (!url.includes(pattern)) continue;
      const queue = plan[pattern];
      const next = queue.shift();
      if (!next) {
        throw new Error(`stubFetch: queue empty for ${pattern} (url=${url})`);
      }
      return {
        ok: next.ok,
        status: next.status ?? (next.ok ? 200 : 400),
        headers: new Headers(next.headers ?? {}),
        json: async () => next.body,
        text: async () => next.text ?? "",
      } as Response;
    }
    throw new Error(`stubFetch: unmatched ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  dirtyRegistry.reset();
});

afterEach(() => {
  cleanup();
  dirtyRegistry.reset();
  vi.unstubAllGlobals();
});

describe("Editor inlineMode", () => {
  it("hides chrome (back, sidebar toggle, rename title, delete) when inlineMode is true", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"abc"' } },
      ],
    });

    render(
      <Editor
        fileId="f1"
        filename="note.md"
        drive="d"
        onBack={() => undefined}
        onDelete={() => undefined}
        onToggleSidebar={() => undefined}
        sidebarHidden={false}
        inlineMode
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("editArea")).toBeInTheDocument();
    });

    // Chrome elements that the host (FileDetailContent) already
    // provides — must NOT appear in inline mode.
    expect(screen.queryByLabelText("back")).toBeNull();
    expect(screen.queryByLabelText("hide")).toBeNull();
    expect(screen.queryByLabelText("show")).toBeNull();
    expect(screen.queryByLabelText("delete")).toBeNull();
  });

  it("renders the full chrome when inlineMode is omitted (legacy Knowledge Page)", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"abc"' } },
      ],
    });

    render(
      <Editor
        fileId="f1"
        filename="note.md"
        drive="d"
        onBack={() => undefined}
        onDelete={() => undefined}
        onToggleSidebar={() => undefined}
        sidebarHidden={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("editArea")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("back")).toBeInTheDocument();
    expect(screen.getByLabelText("delete")).toBeInTheDocument();
    expect(screen.getByLabelText("hide")).toBeInTheDocument();
  });

  it("publishes dirty=true on edit and clears it on unmount", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"abc"' } },
      ],
    });

    const { unmount } = render(
      <Editor
        fileId="f1"
        drive="d"
        onBack={() => undefined}
        inlineMode
      />,
    );

    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    expect(dirtyRegistry.isDirty("f1")).toBe(false);

    fireEvent.change(textarea, { target: { value: "hello world" } });
    await waitFor(() => {
      expect(dirtyRegistry.isDirty("f1")).toBe(true);
    });

    unmount();
    expect(dirtyRegistry.isDirty("f1")).toBe(false);
  });

  it("does not publish dirty when content matches the loaded value", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "stable", headers: { etag: '"abc"' } },
      ],
    });

    render(<Editor fileId="f1" drive="d" onBack={() => undefined} inlineMode />);

    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    expect(textarea.value).toBe("stable");
    // Re-set to the same value — must not flip dirty.
    fireEvent.change(textarea, { target: { value: "stable" } });
    expect(dirtyRegistry.isDirty("f1")).toBe(false);
  });

  it("focuses the textarea once content has loaded when autoFocus is true", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"abc"' } },
      ],
    });

    render(
      <Editor
        fileId="f1"
        filename="note.md"
        drive="d"
        onBack={() => undefined}
        inlineMode
        autoFocus
      />,
    );

    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(document.activeElement).toBe(textarea);
    });
  });

  it("does not focus when autoFocus is false (the default)", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"abc"' } },
      ],
    });

    render(
      <Editor
        fileId="f1"
        filename="note.md"
        drive="d"
        onBack={() => undefined}
        inlineMode
      />,
    );

    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    // Give the autoFocus effect a chance to (not) run.
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).not.toBe(textarea);
  });

  it("fetches the filename from the core API when not supplied", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "x", headers: { etag: '"abc"' } },
      ],
      "/api/files/f1": [
        {
          ok: true,
          body: {
            id: "f1",
            filename: "fetched-name.md",
            title: "fetched-name",
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
      ],
    });

    render(<Editor fileId="f1" drive="d" onBack={() => undefined} inlineMode />);

    await screen.findByLabelText("editArea");
    // We can't easily inspect the title field from outside the
    // header (which is hidden in inline mode), so fall back to
    // checking that the editor mounted without crashing on a
    // missing filename prop. Fetch must have been called for the
    // file metadata.
    await waitFor(() => {
      const calls = (
        globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.map((c: unknown[]) => String(c[0]));
      expect(calls.some((u: string) => u === "/api/files/f1")).toBe(true);
    });
  });
});
