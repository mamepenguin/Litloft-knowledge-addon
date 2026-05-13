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
 * ``QuickSwitcher``'s candidate list rendering (search-vault hits in
 * the same drive). Confirm flow:
 *
 *  - Enter             -> insert ``[[<basename>]]`` (human-readable
 *                          default)
 *  - Shift+Enter       -> insert ``[[<md_id>]]`` (disambiguation form)
 *  - Esc               -> close without insertion
 *  - Backspace past [[ -> close
 *
 * Candidates are fetched once per session via the existing
 * ``searchVault`` helper (already drive-scoped). Filtering is
 * debounced at 100ms while typing.
 *
 * These tests run RED until ``WikiLinkAutocomplete`` (or the inline
 * QuickSwitcher variant) is wired into the textarea.
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

// Stub the vault search so we can control candidate list contents.
const searchVaultMock = vi.hoisted(() => vi.fn());
const listVaultsMock = vi.hoisted(() => vi.fn());
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    searchVault: searchVaultMock,
    listVaults: listVaultsMock,
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
  searchVaultMock.mockReset();
  listVaultsMock.mockReset();
  // Default: a single vault with id=1 active. Tests can override.
  listVaultsMock.mockResolvedValue({
    vaults: [{ id: 1, drive: "d", name: "Notes", path: "Notes" }],
    active_vault_id: 1,
  });
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
    searchVaultMock.mockResolvedValue({
      query: "",
      vault_id: 1,
      results: [
        makeHit("noteid000001", "Alpha.md", "Alpha"),
        makeHit("noteid000002", "Beta.md", "Beta"),
      ],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" vaultId={1} inlineMode />);

    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[");

    // The popup is identifiable by its listbox role + a known testid.
    await waitFor(() => {
      expect(
        screen.getByTestId("wiki-link-autocomplete"),
      ).toBeInTheDocument();
    });
    const list = screen.getByRole("listbox");
    expect(list).toBeInTheDocument();
    expect(list.querySelectorAll("[role=option]").length).toBeGreaterThan(0);
  });

  it("does not open the popup on a single `[`", async () => {
    defaultStream("");
    render(<Editor fileId="f1" filename="note.md" drive="d" vaultId={1} inlineMode />);
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
    searchVaultMock.mockImplementation(
      async (_drive: string, _vaultId: number, query: string) => ({
        query,
        vault_id: 1,
        results: query
          ? [makeHit("noteid000001", "Alpha.md", "Alpha")]
          : [
              makeHit("noteid000001", "Alpha.md", "Alpha"),
              makeHit("noteid000002", "Beta.md", "Beta"),
            ],
        truncated: false,
      }),
    );

    render(<Editor fileId="f1" filename="note.md" drive="d" vaultId={1} inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[");
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
    searchVaultMock.mockResolvedValue({
      query: "",
      vault_id: 1,
      results: [
        makeHit("noteid000001", "Alpha.md", "Alpha"),
        makeHit("noteid000002", "Beta.md", "Beta"),
      ],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" vaultId={1} inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    await typeAtEnd(textarea, "[[");
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
    searchVaultMock.mockResolvedValue({
      query: "",
      vault_id: 1,
      results: [makeHit("noteid000001", "Alpha.md", "Alpha")],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" vaultId={1} inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[");
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
    searchVaultMock.mockResolvedValue({
      query: "",
      vault_id: 1,
      results: [
        {
          ...makeHit("noteid000001", "Alpha.md", "Alpha"),
          md_id: "20260512143028",
        },
      ],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" vaultId={1} inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[");
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
    searchVaultMock.mockResolvedValue({
      query: "",
      vault_id: 1,
      results: [makeHit("noteid000001", "Alpha.md", "Alpha")],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" vaultId={1} inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[");
    await waitFor(() =>
      expect(screen.getByTestId("wiki-link-autocomplete")).toBeInTheDocument(),
    );

    fireEvent.keyDown(textarea, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("wiki-link-autocomplete")).toBeNull(),
    );
    // The user-typed [[ stays put -- Escape only dismisses the popup,
    // it does not undo the typed characters.
    expect(textarea.value).toMatch(/\[\[$/);
  });

  it("closes when the user backspaces past the [[ trigger", async () => {
    defaultStream("");
    searchVaultMock.mockResolvedValue({
      query: "",
      vault_id: 1,
      results: [makeHit("noteid000001", "Alpha.md", "Alpha")],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" vaultId={1} inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[");
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
    searchVaultMock.mockResolvedValue({
      query: "",
      vault_id: 1,
      results: [],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" vaultId={1} inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;
    await typeAtEnd(textarea, "[[");

    await waitFor(() => {
      const popup = screen.getByTestId("wiki-link-autocomplete");
      // Either an empty-state element or zero options.
      expect(popup.querySelectorAll("[role=option]").length).toBe(0);
    });
  });

  it("debounces the candidate fetch (~100ms) while typing", async () => {
    defaultStream("");
    searchVaultMock.mockResolvedValue({
      query: "",
      vault_id: 1,
      results: [],
      truncated: false,
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" vaultId={1} inlineMode />);
    const textarea = (await screen.findByLabelText(
      "editArea",
    )) as HTMLTextAreaElement;

    await typeAtEnd(textarea, "[[");
    // Burst of keystrokes within the debounce window.
    await typeAtEnd(textarea, "abcd");

    // Only the trailing search should fire (initial empty + final
    // "abcd") -- not one per keystroke.
    await new Promise((r) => setTimeout(r, 200));
    expect(searchVaultMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
