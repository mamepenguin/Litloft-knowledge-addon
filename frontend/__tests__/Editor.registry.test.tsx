import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { markdownContentRegistry } from "@/lib/markdownContentRegistry";

// Phase 3.5 spec 2026-05-10 §D2 / hako ZWLqXgdTwt9le4dAI3U8C: the
// Editor publishes its `content` state into the registry so the
// inspector's EditableTagChips can run in content-mode against the
// same underlying string. Single writer, single etag — no race.

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

vi.mock("@/components/PropertiesPanel", () => ({
  PropertiesPanel: () => null,
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
  markdownContentRegistry.reset();
});

afterEach(() => {
  cleanup();
  markdownContentRegistry.reset();
  vi.unstubAllGlobals();
});

describe("Editor markdownContentRegistry integration", () => {
  it("registers an entry under the editor's fileId once content is loaded", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"abc"' } },
      ],
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);

    await waitFor(() => {
      expect(screen.getByLabelText("editArea")).toBeInTheDocument();
    });

    const entry = markdownContentRegistry.lookup("f1");
    expect(entry).not.toBeNull();
    expect(entry!.getContent()).toBe("hello");
  });

  it("reflects textarea edits via getContent()", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"abc"' } },
      ],
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);

    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });

    await waitFor(() => {
      const entry = markdownContentRegistry.lookup("f1");
      expect(entry!.getContent()).toBe("hello world");
    });
  });

  it("propagates external setContent() into the editor's textarea", async () => {
    // The whole point of the registry: the inspector calls setContent
    // with a rewritten body (frontmatter + new tags), and the
    // editor's textarea reflects that change so the user sees the
    // updated YAML and the editor's own autosave handles the PUT.
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "initial", headers: { etag: '"abc"' } },
      ],
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);

    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    expect(textarea.value).toBe("initial");

    const entry = markdownContentRegistry.lookup("f1");
    expect(entry).not.toBeNull();
    entry!.setContent("---\ntags: [foo]\n---\ninitial");

    await waitFor(() => {
      expect(textarea.value).toBe("---\ntags: [foo]\n---\ninitial");
    });
  });

  it("fires notifySaved on the registry after a successful PUT (hako 0RnZ1KdtomAfIJPLAGIHA)", async () => {
    // Phase 3 follow-up: in content-mode the inspector's chip group
    // doesn't own the save path, so the host (FileDetailContent) can
    // only learn about a successful save via the registry's
    // save-success channel. The Editor must fire notifySaved after
    // every successful PUT so the host can refetch File.tags.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubFetch({
        "/api/files/f1/stream": [
          { ok: true, text: "hello", headers: { etag: '"v1"' } },
        ],
        "/api/files/f1/content": [
          { ok: true, headers: { etag: '"v2"' } },
        ],
        // performSave also fires a resync-tags POST; queue a noop.
        "/api/addons/knowledge/resync-tags/": [{ ok: true }],
      });

      const saveListener = vi.fn();
      const dispose = markdownContentRegistry.subscribeSaved(
        "f1",
        saveListener,
      );

      render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);

      const textarea = (await screen.findByLabelText(
        "editArea",
      )) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hello world" } });

      await act(async () => {
        vi.advanceTimersByTime(2100);
      });

      await waitFor(() => {
        expect(saveListener).toHaveBeenCalled();
      });

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never exposes the previous file's content under the new fileId, even during the transient navigation window (Phase 5)", async () => {
    // Hard variant of the navigation test: hold the second fetch
    // pending and inspect the registry while the swap is in flight.
    // The contract is "registry must never return file-A content
    // under key 'b'". Either lookup('b') returns null (no entry yet)
    // or its getContent() returns something derived from B's fetch.
    let resolveB!: (value: { ok: true; text: string; headers: Record<string, string> }) => void;
    const bPending = new Promise<{ ok: true; text: string; headers: Record<string, string> }>(
      (r) => (resolveB = r),
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/files/a/stream")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ etag: '"a1"' }),
          json: async () => undefined,
          text: async () => "alpha-body",
        } as Response;
      }
      if (url.includes("/api/files/b/stream")) {
        const spec = await bPending;
        return {
          ok: spec.ok,
          status: 200,
          headers: new Headers(spec.headers),
          json: async () => undefined,
          text: async () => spec.text,
        } as Response;
      }
      throw new Error(`unmatched ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <Editor fileId="a" filename="alpha.md" drive="d" inlineMode />,
    );
    await waitFor(() => {
      expect(markdownContentRegistry.lookup("a")).not.toBeNull();
    });

    // Swap to b while b's fetch is still pending.
    rerender(<Editor fileId="b" filename="beta.md" drive="d" inlineMode />);

    // At this point the host (e.g. FileDetailContent) could read
    // lookup("b") via useSyncExternalStore. The contract:
    // - lookup("b") is allowed to be null (no entry until load)
    // - OR getContent() must NOT be alpha-body
    const transient = markdownContentRegistry.lookup("b");
    if (transient !== null) {
      expect(transient.getContent()).not.toBe("alpha-body");
    }

    // Also: the old key should already be disposed.
    expect(markdownContentRegistry.lookup("a")).toBeNull();

    // Finish the load and verify steady-state.
    resolveB({
      ok: true,
      text: "beta-body",
      headers: { etag: '"b1"' },
    });
    await waitFor(() => {
      expect(markdownContentRegistry.lookup("b")?.getContent()).toBe(
        "beta-body",
      );
    });
  });

  it("does not leak previous file's content under the new fileId during navigation (Phase 5)", async () => {
    // Phase 5 edge-case verification: when the host swaps fileId
    // without remounting the Editor (the typical right-pane navigation
    // case), the registry must never expose stale content under the
    // new fileId. The previous file's entry must be disposed and a
    // fresh entry must only appear once the new file's content has
    // actually loaded.
    stubFetch({
      "/api/files/a/stream": [
        { ok: true, text: "alpha-body", headers: { etag: '"a1"' } },
      ],
      "/api/files/b/stream": [
        { ok: true, text: "beta-body", headers: { etag: '"b1"' } },
      ],
    });

    const { rerender } = render(
      <Editor fileId="a" filename="alpha.md" drive="d" inlineMode />,
    );

    // Initial load registers under "a".
    await waitFor(() => {
      const entry = markdownContentRegistry.lookup("a");
      expect(entry).not.toBeNull();
      expect(entry!.getContent()).toBe("alpha-body");
    });

    // Swap fileId without remounting.
    rerender(<Editor fileId="b" filename="beta.md" drive="d" inlineMode />);

    // Wait for the new content to load.
    await waitFor(() => {
      const entry = markdownContentRegistry.lookup("b");
      expect(entry).not.toBeNull();
      expect(entry!.getContent()).toBe("beta-body");
    });

    // The old fileId entry must be disposed.
    expect(markdownContentRegistry.lookup("a")).toBeNull();
    // And critically: the new fileId entry must never have exposed
    // alpha-body. Re-read after settling to assert no residual stale
    // content.
    expect(markdownContentRegistry.lookup("b")!.getContent()).toBe(
      "beta-body",
    );
  });

  it("isolates registry entries when two Editors run side by side (Phase 5)", async () => {
    // Phase 5 edge-case verification: a playlist fullscreen view can
    // run alongside a 2-pane right pane on the same page, each hosting
    // a different .md file. The registry is fileId-keyed and entry
    // identity is captured at register() time, so simultaneous mounts
    // must each see their own entry without crosstalk.
    stubFetch({
      "/api/files/x/stream": [
        { ok: true, text: "x-content", headers: { etag: '"x1"' } },
      ],
      "/api/files/y/stream": [
        { ok: true, text: "y-content", headers: { etag: '"y1"' } },
      ],
    });

    render(
      <div>
        <Editor fileId="x" filename="x.md" drive="d" inlineMode />
        <Editor fileId="y" filename="y.md" drive="d" inlineMode />
      </div>,
    );

    await waitFor(() => {
      expect(markdownContentRegistry.lookup("x")?.getContent()).toBe(
        "x-content",
      );
      expect(markdownContentRegistry.lookup("y")?.getContent()).toBe(
        "y-content",
      );
    });

    // External setContent on one entry must not touch the other.
    markdownContentRegistry.lookup("x")!.setContent("x-edited");
    await waitFor(() => {
      expect(markdownContentRegistry.lookup("x")?.getContent()).toBe(
        "x-edited",
      );
    });
    expect(markdownContentRegistry.lookup("y")?.getContent()).toBe(
      "y-content",
    );
  });

  it("unregisters on unmount", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"abc"' } },
      ],
    });

    const { unmount } = render(
      <Editor fileId="f1" filename="note.md" drive="d" inlineMode />,
    );

    await waitFor(() => {
      expect(markdownContentRegistry.lookup("f1")).not.toBeNull();
    });

    unmount();

    expect(markdownContentRegistry.lookup("f1")).toBeNull();
  });
});
