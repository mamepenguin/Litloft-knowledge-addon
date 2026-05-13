import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/**
 * Phase C, spec 2026-05-12-markdown-link-three-forms.md §3.9.
 *
 * The Knowledge ``Editor`` textarea opens a wiki-link autocomplete
 * popup when the user types ``[[`` at the caret. The popup reuses
 * ``QuickSwitcher``'s candidate list rendering (drive-scoped search
 * hits). Confirm flow:
 *
 *  - Enter             -> insert ``[[<basename>]]`` (human-readable
 *                          default)
 *  - Shift+Enter       -> insert ``[[<md_id>]]`` (disambiguation form)
 *  - Esc               -> close without insertion
 *  - Backspace past [[ -> close
 *
 * Candidates are fetched via the existing ``searchKnowledge`` helper
 * (drive-scoped). Filtering is debounced at 100ms while typing.
 */

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

vi.mock("@/hooks/useShortcuts", () => ({
  useShortcuts: () => undefined,
}));

vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => null,
}));

// Stub the drive-scoped search so we can control candidate list contents.
const searchKnowledgeMock = vi.hoisted(() => vi.fn());
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    searchKnowledge: searchKnowledgeMock,
  };
});

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

function defaultStream(body = "") {
  stubFetch({
    "/api/files/f1/stream": [
      { ok: true, text: body, headers: { etag: '"abc"' } },
    ],
  });
}

function makeHit(id: string, filename: string, title?: string, snippet = "") {
  return {
    file_id: id,
    filename,
    title: title ?? filename.replace(/\.md$/, ""),
    snippet,
    // The autocomplete popup also needs the frontmatter id so
    // Shift+Enter can insert ``[[<md_id>]]``. The spec says the search
    // result must carry it; pretend the backend returns it alongside
    // the existing fields.
    md_id: undefined as string | undefined,
  };
}

beforeEach(() => {
  searchKnowledgeMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function typeAtEnd(textarea: HTMLTextAreaElement, chars: string) {
  // simulate sequential keypresses so the [[ trigger fires on the
  // second `[` rather than on a single change event.
  for (const ch of chars) {
    const next = textarea.value + ch;
    fireEvent.change(textarea, { target: { value: next } });
  }
}

describe("Editor wiki-link autocomplete", () => {
  it("opens an autocomplete popup when [[ is typed at the caret", async () => {
    defaultStream("hello ");
    searchKnowledgeMock.mockResolvedValue({
      query: "",
      drive: "d",
      results: [
        makeHit("noteid000001", "Alpha.md", "Alpha"),
        makeHit("noteid000002", "Beta.md", "Beta"),
      ],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);

    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    // The backend rejects q="" with 422 so we skip the fetch on empty
    // query. Type one extra char so the autocomplete actually searches.
    await typeAtEnd(textarea, "[[a");

    // The popup is identifiable by its listbox role + a known testid.
    await waitFor(() => {
      expect(
        screen.getByTestId("wiki-link-autocomplete"),
      ).toBeInTheDocument();
    });
    const list = screen.getByRole("listbox");
    expect(list).toBeInTheDocument();
    await waitFor(() => {
      expect(
        list.querySelectorAll("[role=option]").length,
      ).toBeGreaterThan(0);
    });
  });

  it("anchors the popup at the [[ caret position with position:fixed", async () => {
    defaultStream("hello ");
    searchKnowledgeMock.mockResolvedValue({
      query: "",
      drive: "d",
      results: [makeHit("noteid000001", "Alpha.md", "Alpha")],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    await typeAtEnd(textarea, "[[a");

    const popup = await screen.findByTestId("wiki-link-autocomplete");
    // Caret-anchored mode renders the popup with position:fixed, top,
    // and left inline styles. The exact numbers depend on layout; we
    // only verify the mode is enabled (the legacy fallback uses
    // ``position: absolute`` from a class, leaving inline style unset).
    expect(popup.style.position).toBe("fixed");
    expect(popup.style.top).not.toBe("");
    expect(popup.style.left).not.toBe("");
  });

  it("closes when the user taps/clicks outside the popup", async () => {
    defaultStream("hello ");
    searchKnowledgeMock.mockResolvedValue({
      query: "",
      drive: "d",
      results: [makeHit("noteid000001", "Alpha.md", "Alpha")],
      truncated: false,
    });
    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    await typeAtEnd(textarea, "[[a");
    await screen.findByTestId("wiki-link-autocomplete");

    // Click on the document body, outside the popup and the textarea.
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("wiki-link-autocomplete")).toBeNull();
    });
  });

  it("does not close when clicking inside the popup (e.g. selecting an option)", async () => {
    defaultStream("hello ");
    searchKnowledgeMock.mockResolvedValue({
      query: "",
      drive: "d",
      results: [makeHit("noteid000001", "Alpha.md", "Alpha")],
      truncated: false,
    });
    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    await typeAtEnd(textarea, "[[a");
    const popup = await screen.findByTestId("wiki-link-autocomplete");

    // A pointerdown on the popup body itself must not close it — the
    // option's own onMouseDown is what should drive selection.
    act(() => {
      fireEvent.mouseDown(popup);
    });
    expect(screen.queryByTestId("wiki-link-autocomplete")).toBeInTheDocument();
  });

  it("does not open the popup on a single `[`", async () => {
    defaultStream("");
    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[");
    // Give the debounce a chance to settle.
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByTestId("wiki-link-autocomplete")).toBeNull();
  });

  it("filters candidates as the user types after [[", async () => {
    defaultStream("");
    // The first hit search runs without a query, returns all notes.
    // Once the user types "al" the popup re-queries.
    searchKnowledgeMock.mockImplementation(
      async (_drive: string, query: string) => ({
        query,
        drive: "d",
        results: query
          ? [makeHit("noteid000001", "Alpha.md", "Alpha")]
          : [
              makeHit("noteid000001", "Alpha.md", "Alpha"),
              makeHit("noteid000002", "Beta.md", "Beta"),
            ],
        truncated: false,
      }),
    );

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[a");
    await waitFor(() => {
      expect(screen.getByTestId("wiki-link-autocomplete")).toBeInTheDocument();
    });

    await typeAtEnd(textarea, "al");
    // 100 ms debounce + a small slack.
    await new Promise((r) => setTimeout(r, 200));
    await waitFor(() => {
      const opts = screen.getAllByRole("option");
      expect(opts).toHaveLength(1);
      expect(opts[0]).toHaveTextContent(/Alpha/);
    });
  });

  it("highlights candidates with ArrowDown / ArrowUp", async () => {
    defaultStream("");
    searchKnowledgeMock.mockResolvedValue({
      query: "",
      drive: "d",
      results: [
        makeHit("noteid000001", "Alpha.md", "Alpha"),
        makeHit("noteid000002", "Beta.md", "Beta"),
      ],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    await typeAtEnd(textarea, "[[a");
    await waitFor(() =>
      expect(screen.getByTestId("wiki-link-autocomplete")).toBeInTheDocument(),
    );

    // First option is selected by default.
    let opts = screen.getAllByRole("option");
    expect(opts[0].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    opts = screen.getAllByRole("option");
    expect(opts[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    opts = screen.getAllByRole("option");
    expect(opts[0].getAttribute("aria-selected")).toBe("true");
  });

  it("inserts [[<basename>]] on Enter and closes the popup", async () => {
    defaultStream("Prefix ");
    searchKnowledgeMock.mockResolvedValue({
      query: "",
      drive: "d",
      results: [makeHit("noteid000001", "Alpha.md", "Alpha")],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[a");
    await waitFor(() =>
      expect(screen.getByTestId("wiki-link-autocomplete")).toBeInTheDocument(),
    );

    fireEvent.keyDown(textarea, { key: "Enter" });

    // The popup closes.
    await waitFor(() => {
      expect(screen.queryByTestId("wiki-link-autocomplete")).toBeNull();
    });
    // The text now contains [[Alpha]] -- basename without extension.
    expect(textarea.value).toContain("[[Alpha]]");
    // The trigger `[[` typed by the user must be replaced, not duplicated.
    expect(textarea.value).not.toContain("[[[[");
    // Caret moved past the closing ]].
    expect(textarea.selectionStart).toBe(textarea.value.indexOf("]]") + 2);
  });

  it("inserts [[<md_id>]] on Shift+Enter for disambiguation", async () => {
    defaultStream("");
    searchKnowledgeMock.mockResolvedValue({
      query: "",
      drive: "d",
      results: [
        {
          ...makeHit("noteid000001", "Alpha.md", "Alpha"),
          md_id: "20260512143028",
        },
      ],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[a");
    await waitFor(() =>
      expect(screen.getByTestId("wiki-link-autocomplete")).toBeInTheDocument(),
    );

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    await waitFor(() => {
      expect(screen.queryByTestId("wiki-link-autocomplete")).toBeNull();
    });
    expect(textarea.value).toContain("[[20260512143028]]");
    expect(textarea.value).not.toContain("[[Alpha]]");
  });

  it("closes without inserting on Escape", async () => {
    defaultStream("hello");
    searchKnowledgeMock.mockResolvedValue({
      query: "",
      drive: "d",
      results: [makeHit("noteid000001", "Alpha.md", "Alpha")],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[a");
    await waitFor(() =>
      expect(screen.getByTestId("wiki-link-autocomplete")).toBeInTheDocument(),
    );

    fireEvent.keyDown(textarea, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("wiki-link-autocomplete")).toBeNull(),
    );
    // The user-typed [[ + query chars stay put -- Escape only dismisses
    // the popup, it does not undo the typed characters.
    expect(textarea.value).toMatch(/\[\[a$/);
  });

  it("closes when the user backspaces past the [[ trigger", async () => {
    defaultStream("");
    searchKnowledgeMock.mockResolvedValue({
      query: "",
      drive: "d",
      results: [makeHit("noteid000001", "Alpha.md", "Alpha")],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[a");
    await waitFor(() =>
      expect(screen.getByTestId("wiki-link-autocomplete")).toBeInTheDocument(),
    );

    // Backspace down to a single `[`.
    fireEvent.change(textarea, { target: { value: "[" } });
    await waitFor(() =>
      expect(screen.queryByTestId("wiki-link-autocomplete")).toBeNull(),
    );
  });

  it("shows a `no candidates` empty state when the drive has no notes", async () => {
    defaultStream("");
    searchKnowledgeMock.mockResolvedValue({
      query: "",
      drive: "d",
      results: [],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    await typeAtEnd(textarea, "[[a");

    await waitFor(() => {
      const popup = screen.getByTestId("wiki-link-autocomplete");
      // Either an empty-state element or zero options.
      expect(popup.querySelectorAll("[role=option]").length).toBe(0);
    });
  });

  it("debounces the candidate fetch (~100ms) while typing", async () => {
    defaultStream("");
    searchKnowledgeMock.mockResolvedValue({
      query: "",
      drive: "d",
      results: [],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[a");
    // Burst of keystrokes within the debounce window.
    await typeAtEnd(textarea, "abcd");

    // Only the trailing search should fire (initial empty + final
    // "abcd") -- not one per keystroke.
    await new Promise((r) => setTimeout(r, 200));
    expect(searchKnowledgeMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
