import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
