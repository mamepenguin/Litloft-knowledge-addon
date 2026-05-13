import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import QuickSwitcher, { recordRecent } from "../QuickSwitcher";
import type { CoreFileItem } from "../api";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string) =>
      key,
}));

const DRIVE = "test-drive";

function makeFile(id: string, filename: string, title?: string): CoreFileItem {
  return {
    id,
    filename,
    title: title ?? filename,
    drive: DRIVE,
    folder_path: "",
    file_type: "text",
    mime_type: "text/markdown",
    thumbnail_url: "",
    file_size: 0,
    created_at: "",
    updated_at: "",
  };
}

// jsdom storage may be missing in some envs — provide an in-memory shim.
function setupStorage() {
  const store = new Map<string, string>();
  const shim = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: shim,
  });
}

describe("QuickSwitcher", () => {
  beforeEach(() => {
    setupStorage();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("shows empty-recents message when no history and query empty", () => {
    render(
      <QuickSwitcher
        drive={DRIVE}
        open
        onClose={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("emptyRecents")).toBeInTheDocument();
  });

  it("renders recents when present", () => {
    recordRecent(DRIVE, makeFile("f1", "alpha.md", "Alpha"));
    recordRecent(DRIVE, makeFile("f2", "beta.md", "Beta"));
    render(
      <QuickSwitcher
        drive={DRIVE}
        open
        onClose={() => {}}
        onSelect={() => {}}
      />,
    );
    // Most recent first
    const items = screen.getAllByRole("option");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Beta");
    expect(items[1]).toHaveTextContent("Alpha");
  });

  it("calls searchKnowledge and renders results when typing", async () => {
    vi.useRealTimers();
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/search?")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            query: "ab",
            drive: DRIVE,
            results: [
              { file_id: "h1", filename: "abacus.md", title: "Abacus", snippet: "" },
            ],
            truncated: false,
          }),
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QuickSwitcher
        drive={DRIVE}
        open
        onClose={() => {}}
        onSelect={() => {}}
      />,
    );
    const input = screen.getByLabelText("placeholder");
    fireEvent.change(input, { target: { value: "ab" } });
    await waitFor(() =>
      expect(screen.getByText("Abacus")).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });

  it("ArrowDown moves selection and Enter selects", async () => {
    vi.useRealTimers();
    recordRecent(DRIVE, makeFile("f1", "alpha.md", "Alpha"));
    recordRecent(DRIVE, makeFile("f2", "beta.md", "Beta"));
    const onSelect = vi.fn();
    const fileFetched = makeFile("f1", "alpha.md", "Alpha");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => fileFetched,
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QuickSwitcher
        drive={DRIVE}
        open
        onClose={() => {}}
        onSelect={onSelect}
      />,
    );
    const input = screen.getByLabelText("placeholder");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(fileFetched));
    vi.unstubAllGlobals();
  });

  it("Escape calls onClose", () => {
    const onClose = vi.fn();
    render(
      <QuickSwitcher
        drive={DRIVE}
        open
        onClose={onClose}
        onSelect={() => {}}
      />,
    );
    const input = screen.getByLabelText("placeholder");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("recordRecent dedupes and caps at limit", () => {
    for (let i = 0; i < 60; i++) {
      recordRecent(DRIVE, makeFile(`f${i}`, `n${i}.md`));
    }
    const stored = JSON.parse(
      window.localStorage.getItem(`knowledge:recentFiles:${DRIVE}`)!,
    );
    expect(stored).toHaveLength(50);
    // Re-recording an existing entry moves it to top, doesn't duplicate
    recordRecent(DRIVE, makeFile("f10", "n10.md"));
    const re = JSON.parse(
      window.localStorage.getItem(`knowledge:recentFiles:${DRIVE}`)!,
    );
    expect(re[0].fileId).toBe("f10");
    expect(re.filter((e: { fileId: string }) => e.fileId === "f10")).toHaveLength(1);
  });
});
