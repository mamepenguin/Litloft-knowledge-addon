import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

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
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  dirtyRegistry.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderEditorAndTriggerConflict(): Promise<HTMLTextAreaElement> {
  stubFetch({
    "/api/files/f1/stream": [
      // Initial load
      { ok: true, text: "hello", headers: { etag: '"v1"' } },
    ],
    "/api/files/f1/content": [
      // First PUT — server has moved on, returns 412 with new etag
      {
        ok: false,
        status: 412,
        headers: { etag: '"v2"' },
      },
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

  fireEvent.change(textarea, { target: { value: "hello world" } });

  // Advance past the autosave debounce so the PUT fires.
  await act(async () => {
    vi.advanceTimersByTime(2100);
  });

  await waitFor(() => {
    expect(screen.getByText("title")).toBeInTheDocument();
  });

  return textarea;
}

describe("Editor ConflictModal portal (PR-6)", () => {
  it("renders ConflictModal in document.body, not inside the editor subtree", async () => {
    await renderEditorAndTriggerConflict();

    // The modal heading uses the i18n key ``title`` (mocked to identity).
    const heading = screen.getByText("title");
    // Walk up: the modal must be a direct/transitive child of <body>,
    // not nested inside the Editor's wrapper. The editor's outermost
    // node carries the ``editArea`` textarea; the modal must NOT live
    // under the same ancestor.
    const editArea = screen.getByLabelText("editArea");
    // Editor's root is several wrappers above the textarea. Find any
    // ancestor of the editor that does NOT contain the modal — proves
    // the modal escaped.
    let cursor: HTMLElement | null = editArea;
    let modalContainedByEditor = false;
    while (cursor && cursor !== document.body) {
      if (cursor.contains(heading)) {
        modalContainedByEditor = true;
        break;
      }
      cursor = cursor.parentElement;
    }
    expect(modalContainedByEditor).toBe(false);
    // And confirm the modal lives somewhere under <body>.
    expect(document.body.contains(heading)).toBe(true);
  });

  it("dismiss button closes the modal", async () => {
    await renderEditorAndTriggerConflict();
    expect(screen.getByText("title")).toBeInTheDocument();

    fireEvent.click(screen.getByText("dismiss"));

    expect(screen.queryByText("title")).not.toBeInTheDocument();
  });

  it("reload button refetches content from the server", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"v1"' } },
        // Reload click triggers a fresh GET — server's latest body.
        { ok: true, text: "hello from server", headers: { etag: '"v2"' } },
      ],
      "/api/files/f1/content": [
        { ok: false, status: 412, headers: { etag: '"v2"' } },
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
    fireEvent.change(textarea, { target: { value: "hello local" } });
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    await waitFor(() => expect(screen.getByText("title")).toBeInTheDocument());

    fireEvent.click(screen.getByText("reload"));

    await waitFor(() => {
      expect(textarea.value).toBe("hello from server");
    });
    expect(screen.queryByText("title")).not.toBeInTheDocument();
  });

  it("overwrite button refetches the etag and re-saves", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"v1"' } },
        // Overwrite click triggers a fresh GET to read the latest etag.
        { ok: true, text: "ignored", headers: { etag: '"v2"' } },
      ],
      "/api/files/f1/content": [
        // First PUT — 412.
        { ok: false, status: 412, headers: { etag: '"v2"' } },
        // Second PUT (overwrite) — succeeds with the refreshed etag.
        { ok: true, headers: { etag: '"v3"' } },
      ],
      // performSave triggers a tag resync POST after a successful PUT.
      "/api/addons/knowledge/resync-tags/": [{ ok: true }],
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
    fireEvent.change(textarea, { target: { value: "force-write" } });
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    await waitFor(() => expect(screen.getByText("title")).toBeInTheDocument());

    fireEvent.click(screen.getByText("overwrite"));

    // Modal closes once the overwrite PUT settles.
    await waitFor(() => {
      expect(screen.queryByText("title")).not.toBeInTheDocument();
    });
  });
});
