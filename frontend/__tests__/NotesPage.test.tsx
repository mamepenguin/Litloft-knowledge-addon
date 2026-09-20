import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { accentFills } from "@/__tests__/helpers/accentFills";
import type { FileItem } from "@/types";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    (ns?: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns ?? ""}.${key}${values ? JSON.stringify(values) : ""}`,
}));

const PATH = "/drive/d/addons/knowledge";
let params = new URLSearchParams();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => PATH,
}));

let drive = "d";
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => drive }));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a data-next-link="" {...props}>
      {children}
    </a>
  ),
}));

let nickname: string | null = null;
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname, setNickname: vi.fn(), clearNickname: vi.fn() }),
}));

let editorEnabled = true;
vi.mock("@/hooks/usePolicy", () => ({
  usePolicy: () => ({ enabled: editorEnabled, isLoading: false }),
}));

const getDriveFiles = vi.fn();
const getWatchHistory = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getDriveFiles: (...a: unknown[]) => getDriveFiles(...a),
    getWatchHistory: (...a: unknown[]) => getWatchHistory(...a),
  };
});

const createClip = vi.fn();
const findClipsByUrl = vi.fn();
const createTextFile = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    createClip: (...a: unknown[]) => createClip(...a),
    findClipsByUrl: (...a: unknown[]) => findClipsByUrl(...a),
    createTextFile: (...a: unknown[]) => createTextFile(...a),
  };
});

const openQuickNote = vi.fn();
vi.mock("@/components/quick-note", () => ({
  useQuickNote: () => ({ open: openQuickNote }),
}));

vi.mock("@/components/FolderPicker", () => ({
  FolderPicker: () => <div data-testid="folder-picker" />,
}));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => null }));
vi.mock("../ConnectionsGraph", () => ({ default: () => <div data-testid="graph" /> }));

const CONNECTIONS = /^knowledge\.notes\.connections/;
const CLIP_TILE = /^knowledge\.notes\.clipTile/;

const NotesPage = (await import("../NotesPage")).default;

function note(id: string, folder = "journal"): FileItem {
  return {
    id,
    filename: `${id}.md`,
    title: `Note ${id}`,
    drive: "d",
    folder_path: folder,
    mime_type: "text/markdown",
    updated_at: "2026-09-14T09:00:00Z",
  } as FileItem;
}

function page(files: FileItem[], total = files.length) {
  return { data: files, meta: { total, page: 1, limit: files.length } };
}

const CLIP_URL = "knowledge.dashboard.clipUrlLabel";
const before = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  drive = "d";
  params = new URLSearchParams();
  nickname = null;
  editorEnabled = true;
  push.mockReset();
  openQuickNote.mockReset();
  getDriveFiles.mockReset().mockResolvedValue(page([]));
  getWatchHistory.mockReset().mockResolvedValue([]);
  createClip.mockReset().mockResolvedValue({ job_id: 1, file_id: "c1", status: "fetching" });
  findClipsByUrl.mockReset().mockResolvedValue([]);
  createTextFile.mockReset().mockResolvedValue({ id: "n1" });
  window.localStorage.clear();
});

afterEach(cleanup);

describe("the Notes landing", () => {
  it("lays out Find, Continue writing, Recent notes, then the clip and connections entries", async () => {
    nickname = "alice";
    getWatchHistory.mockResolvedValue([note("w1")]);
    getDriveFiles.mockResolvedValue(page([note("r1")], 12));
    render(<NotesPage />);

    const find = screen.getByRole("search");
    const cont = await screen.findByText("knowledge.notes.continueWriting");
    const recent = screen.getByText("knowledge.notes.recent");
    await screen.findByText("Note r1");
    const clipTile = screen.getByRole("button", { name: CLIP_TILE });
    const connections = screen.getByRole("link", { name: CONNECTIONS });
    expect(screen.queryByTestId("graph")).toBeNull();
    expect(screen.queryByRole("textbox", { name: CLIP_URL })).toBeNull();
    expect([before(find, cont), before(cont, recent), before(recent, clipTile), before(clipTile, connections)]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("opens and closes the clip section from its entry, below the entries", async () => {
    render(<NotesPage />);
    const tile = screen.getByRole("button", { name: CLIP_TILE });
    expect(tile).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(tile);
    const clip = screen.getByRole("textbox", { name: CLIP_URL });
    expect(tile).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(tile.getAttribute("aria-controls")!)).toContainElement(clip);
    expect(before(screen.getByRole("link", { name: CONNECTIONS }), clip)).toBe(true);

    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: CLIP_URL })).toBeNull();
  });

  it("asks for recent notes by modification time and opens them at their plain canonical URL", async () => {
    getDriveFiles.mockResolvedValue(page([note("r1"), note("r2", "")], 12));
    render(<NotesPage />);

    await screen.findByText("Note r1");
    expect(getDriveFiles.mock.calls).toEqual([
      ["d", { type: "text", sort: "updated_at", order: "desc", limit: 8 }],
    ]);
    expect(screen.getByRole("link", { name: /Note r1/ }).getAttribute("href")).toBe(
      "/drive/d/journal?file=r1",
    );
    expect(screen.getByRole("link", { name: /Note r2/ }).getAttribute("href")).toBe("/drive/d?file=r2");
    expect(
      screen.getByRole("link", { name: 'knowledge.notes.allLink{"count":12}' }).getAttribute("href"),
    ).toBe(`${PATH}?view=all`);
  });

  it("groups recent notes under the age of their last change", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 14, 15, 0));
    try {
      const at = (d: number) => ({ ...note(`r${d}`), updated_at: new Date(2026, 8, d, 9).toISOString() });
      getDriveFiles.mockResolvedValue(page([at(14), at(10), at(1)], 3));
      render(<NotesPage />);
      await screen.findByText("Note r14");

      const recent = screen.getByText("knowledge.notes.recent").closest("section")!;
      const headings = within(recent).getAllByRole("heading", { level: 3 });
      expect(headings.map((h) => h.textContent)).toEqual([
        "knowledge.notes.age.today",
        "knowledge.notes.age.week",
        "knowledge.notes.age.month",
      ]);
      expect(headings.map((h) => within(h.parentElement!).getAllByRole("link").map((a) => a.textContent?.match(/^Note r\d+/)?.[0]))).toEqual([
        ["Note r14"],
        ["Note r10"],
        ["Note r1"],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dates a Continue writing card the way a row dates a note", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date(2026, 8, 14, 15, 0);
    vi.setSystemTime(now);
    try {
      const { formatNoteTime } = await import("../noteDates");
      nickname = "alice";
      const earlier = { ...note("w1"), updated_at: new Date(2026, 8, 2, 10, 0).toISOString() };
      const today = { ...note("w2"), updated_at: new Date(2026, 8, 14, 9, 5).toISOString() };
      getWatchHistory.mockResolvedValue([earlier, today]);
      render(<NotesPage />);

      const card = await screen.findByRole("link", { name: /^Note w1/ });
      expect(card).toHaveTextContent(new RegExp(`${formatNoteTime(earlier.updated_at, now, "en")}$`));
      expect(screen.getByRole("link", { name: /^Note w2/ })).toHaveTextContent(/09:05$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves today's notes out of Today at midnight without a reload", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 8, 14, 23, 50));
    try {
      getDriveFiles.mockResolvedValue(page([{ ...note("r1"), updated_at: new Date(2026, 8, 14, 23, 30).toISOString() }], 1));
      render(<NotesPage />);
      await act(async () => {});
      const recent = screen.getByText("knowledge.notes.recent").closest("section")!;
      expect(within(recent).getByRole("heading", { level: 3 })).toHaveTextContent("knowledge.notes.age.today");
      expect(within(recent).getByRole("link", { name: /^Note r1/ })).toHaveTextContent(/23:30$/);

      await act(async () => {
        vi.advanceTimersByTime(11 * 60_000);
      });
      expect(within(recent).getByRole("heading", { level: 3 })).toHaveTextContent("knowledge.notes.age.week");
      expect(within(recent).getByRole("link", { name: /^Note r1/ })).not.toHaveTextContent(/23:30$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls over again at the next midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 8, 14, 23, 50));
    try {
      getDriveFiles.mockResolvedValue(page([{ ...note("r1"), updated_at: new Date(2026, 8, 15, 12, 0).toISOString() }], 1));
      render(<NotesPage />);
      await act(async () => {});
      await act(async () => {
        vi.advanceTimersByTime(11 * 60_000);
      });
      const recent = screen.getByText("knowledge.notes.recent").closest("section")!;
      expect(within(recent).getByRole("heading", { level: 3 })).toHaveTextContent("knowledge.notes.age.today");

      await act(async () => {
        vi.advanceTimersByTime(24 * 60 * 60_000);
      });
      expect(within(recent).getByRole("heading", { level: 3 })).toHaveTextContent("knowledge.notes.age.week");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no timer or listener behind when the page goes away", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 8, 14, 23, 50));
    const docAdd = vi.spyOn(document, "addEventListener");
    const docRemove = vi.spyOn(document, "removeEventListener");
    const winAdd = vi.spyOn(window, "addEventListener");
    const winRemove = vi.spyOn(window, "removeEventListener");
    try {
      const { unmount } = render(<NotesPage />);
      await act(async () => {});
      const added = (spy: typeof docAdd, type: string) => spy.mock.calls.filter(([t]) => t === type).map(([, fn]) => fn);
      const visibility = added(docAdd, "visibilitychange");
      const focus = added(winAdd, "focus");
      expect(visibility).toHaveLength(1);
      expect(focus).toHaveLength(1);

      unmount();
      expect(added(docRemove, "visibilitychange")).toEqual(visibility);
      expect(added(winRemove, "focus")).toEqual(focus);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      docAdd.mockRestore();
      docRemove.mockRestore();
      winAdd.mockRestore();
      winRemove.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each([
    ["focus", () => window.dispatchEvent(new Event("focus"))],
    ["visibilitychange", () => document.dispatchEvent(new Event("visibilitychange"))],
  ])("leaves no timer behind after a %s and then leaving the page", async (_, fire) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 8, 14, 23, 50));
    try {
      const { unmount } = render(<NotesPage />);
      await act(async () => {});
      await act(async () => {
        fire();
      });

      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("catches up on the day when the page is shown again after sleeping past midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 8, 14, 23, 50));
    try {
      getDriveFiles.mockResolvedValue(page([{ ...note("r1"), updated_at: new Date(2026, 8, 14, 23, 30).toISOString() }], 1));
      render(<NotesPage />);
      await act(async () => {});
      const recent = screen.getByText("knowledge.notes.recent").closest("section")!;
      expect(within(recent).getByRole("heading", { level: 3 })).toHaveTextContent("knowledge.notes.age.today");

      vi.setSystemTime(new Date(2026, 8, 15, 8, 0));
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(within(recent).getByRole("heading", { level: 3 })).toHaveTextContent("knowledge.notes.age.week");
    } finally {
      vi.useRealTimers();
    }
  });

  it("explains an empty drive without hiding New note", async () => {
    render(<NotesPage />);
    expect(await screen.findByText("knowledge.notes.empty")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /allLink/ })).toBeNull();
    expect(screen.getByRole("button", { name: "knowledge.notes.newNote" })).toBeInTheDocument();
  });

  it("asks for no history and shows no Continue writing without a profile", async () => {
    render(<NotesPage />);
    await screen.findByText("knowledge.notes.empty");
    expect(getWatchHistory).not.toHaveBeenCalled();
    expect(screen.queryByText("knowledge.notes.continueWriting")).toBeNull();
  });

  it("shows Continue writing from text history with a profile, and nothing when it is empty", async () => {
    nickname = "alice";
    getWatchHistory.mockResolvedValueOnce([note("w1")]);
    render(<NotesPage />);
    await screen.findByText("Note w1");
    expect(getWatchHistory.mock.calls).toEqual([["d", 3, "all", "text"]]);
    expect(screen.getByRole("link", { name: /Note w1/ }).getAttribute("href")).toBe("/drive/d/journal?file=w1");

    cleanup();
    getWatchHistory.mockResolvedValueOnce([]);
    render(<NotesPage />);
    await screen.findByText("knowledge.notes.empty");
    await act(async () => {});
    expect(screen.queryByText("knowledge.notes.continueWriting")).toBeNull();
  });

  it("keeps the clip entry and Continue writing when the note list fails", async () => {
    nickname = "alice";
    getWatchHistory.mockResolvedValue([note("w1")]);
    getDriveFiles.mockRejectedValue(new Error("boom"));
    render(<NotesPage />);

    const recent = screen.getByText("knowledge.notes.recent").closest("section")!;
    expect(await within(recent).findByRole("alert")).toHaveTextContent("knowledge.notes.loadFailed");
    expect(await screen.findByText("Note w1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CLIP_TILE })).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("keeps the search field on the query in the URL as it changes", async () => {
    params = new URLSearchParams({ q: "kyoto" });
    const { rerender } = render(<NotesPage />);
    expect(screen.getByRole("searchbox")).toHaveValue("kyoto");

    params = new URLSearchParams({ q: "osaka" });
    rerender(<NotesPage />);
    expect(screen.getByRole("searchbox")).toHaveValue("osaka");

    params = new URLSearchParams();
    rerender(<NotesPage />);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("puts Find into the URL", async () => {
    render(<NotesPage />);
    expect(screen.getByRole("searchbox")).toHaveAttribute("maxlength", "200");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " kyoto trip " } });
    fireEvent.submit(screen.getByRole("search"));
    expect(push.mock.calls).toEqual([[`${PATH}?q=kyoto+trip`]]);
  });

  it("opens the clip form right under Find when a bookmarklet lands, and submits it once", async () => {
    params = new URLSearchParams({ prefill: "https://example.com/a", title: "A", autosubmit: "1" });
    render(<NotesPage />);

    const clip = screen.getByRole("textbox", { name: CLIP_URL });
    expect(before(screen.getByRole("search"), clip)).toBe(true);
    expect(before(clip, screen.getByText("knowledge.notes.recent"))).toBe(true);
    expect(screen.getByRole("button", { name: CLIP_TILE })).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(createClip).toHaveBeenCalledTimes(1));
    expect(createClip.mock.calls[0]).toEqual(["d", { url: "https://example.com/a", subfolder: null, title: "A" }]);
  });
});

describe("Find and All notes", () => {
  it("shows only the matches, counted after filtering, and pages them", async () => {
    params = new URLSearchParams({ q: "kyoto" });
    const first = Array.from({ length: 30 }, (_, i) => note(`q${i}`));
    getDriveFiles.mockResolvedValueOnce(page(first, 31)).mockResolvedValueOnce(page([note("q30")], 31));
    render(<NotesPage />);

    expect(await screen.findByText('knowledge.notes.count{"count":31}')).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("kyoto");
    expect(screen.getByRole("link", { name: "knowledge.notes.clearFind" }).getAttribute("href")).toBe(PATH);
    expect(screen.queryByText("knowledge.notes.recent")).toBeNull();
    expect(screen.queryByRole("textbox", { name: CLIP_URL })).toBeNull();
    expect(screen.queryByRole("link", { name: CONNECTIONS })).toBeNull();
    expect(screen.getByRole("link", { name: "knowledge.notes.back" }).getAttribute("href")).toBe(PATH);

    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.showMore" }));
    await screen.findByText("Note q30");
    expect(getDriveFiles.mock.calls).toEqual([
      ["d", { type: "text", sort: "updated_at", order: "desc", search: "kyoto", page: 1, limit: 30 }],
      ["d", { type: "text", sort: "updated_at", order: "desc", search: "kyoto", page: 2, limit: 30 }],
    ]);
    expect(screen.getAllByRole("link", { name: /^Note q/ })).toHaveLength(31);
    expect(screen.queryByRole("button", { name: "knowledge.notes.showMore" })).toBeNull();
  });

  it("does not list a note twice when the results shift before the next page", async () => {
    params = new URLSearchParams({ q: "kyoto" });
    const first = Array.from({ length: 30 }, (_, i) => note(`q${i}`));
    getDriveFiles.mockResolvedValueOnce(page(first, 31)).mockResolvedValueOnce(page([note("q29")], 31));
    render(<NotesPage />);
    await screen.findByText("Note q29");

    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.showMore" }));
    await waitFor(() => expect(getDriveFiles).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.getAllByRole("link", { name: /^Note q/ })).toHaveLength(30);
    expect(screen.queryByRole("button", { name: "knowledge.notes.showMore" })).toBeNull();
  });

  it.each([
    [60, false],
    [61, true],
  ])("after two pages of a search totalling %i, offers Show more: %s", async (total, offered) => {
    params = new URLSearchParams({ q: "kyoto" });
    const all = Array.from({ length: 60 }, (_, i) => note(`q${i}`));
    getDriveFiles
      .mockResolvedValueOnce(page(all.slice(0, 30), total))
      .mockResolvedValueOnce(page(all.slice(30, 60), total));
    render(<NotesPage />);
    await screen.findByText("Note q29");

    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.showMore" }));
    await screen.findByText("Note q59");
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "knowledge.notes.showMore" }) !== null).toBe(offered);
  });

  it("lists every note for view=all without a search term", async () => {
    params = new URLSearchParams({ view: "all" });
    getDriveFiles.mockResolvedValue(page([note("a1")], 1));
    render(<NotesPage />);
    await screen.findByText("Note a1");
    expect(getDriveFiles.mock.calls).toEqual([
      ["d", { type: "text", sort: "updated_at", order: "desc", search: undefined, page: 1, limit: 30 }],
    ]);
    expect(screen.getByText("knowledge.notes.all")).toBeInTheDocument();
  });
});

describe("the landing's accent budget", () => {
  it("fills New note and nothing else", async () => {
    nickname = "alice";
    getWatchHistory.mockResolvedValue([note("w1")]);
    getDriveFiles.mockResolvedValue(page([note("r1")], 12));
    const { container } = render(<NotesPage />);
    await screen.findByText("Note r1");
    await screen.findByText("Note w1");

    expect(accentFills(container)).toEqual([screen.getByRole("button", { name: "knowledge.notes.newNote" })]);
  });

  it("still offers and fills New note when the editor is off", async () => {
    editorEnabled = false;
    getDriveFiles.mockResolvedValue(page([note("r1")], 12));
    const { container } = render(<NotesPage />);
    await screen.findByText("Note r1");

    expect(accentFills(container)).toEqual([screen.getByRole("button", { name: "knowledge.notes.newNote" })]);
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const BOOKMARKLET = { prefill: "https://example.com/a", title: "A", autosubmit: "1" };

describe("the clip section across in-page navigation", () => {
  it("does not clip again when the reader goes to Find and comes back", async () => {
    params = new URLSearchParams(BOOKMARKLET);
    const { rerender } = render(<NotesPage />);
    await waitFor(() => expect(createClip).toHaveBeenCalledTimes(1));

    findClipsByUrl.mockResolvedValue([{ job_id: 1, file_id: "c1", status: "fetching" }]);
    params = new URLSearchParams({ q: "kyoto" });
    rerender(<NotesPage />);
    await screen.findByText('knowledge.notes.count{"count":0}');
    params = new URLSearchParams(BOOKMARKLET);
    rerender(<NotesPage />);
    await act(async () => {});

    expect(createClip).toHaveBeenCalledTimes(1);
    expect(findClipsByUrl).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a clip that was still being sent when the reader went to All notes", async () => {
    params = new URLSearchParams(BOOKMARKLET);
    const sent = deferred<{ job_id: number; file_id: string; status: string }>();
    createClip.mockReturnValue(sent.promise);
    const { rerender } = render(<NotesPage />);
    await waitFor(() => expect(createClip).toHaveBeenCalledTimes(1));

    params = new URLSearchParams({ view: "all" });
    rerender(<NotesPage />);
    await act(async () => {
      sent.resolve({ job_id: 1, file_id: "c1", status: "fetching" });
    });
    params = new URLSearchParams();
    rerender(<NotesPage />);

    expect(await screen.findByTitle("https://example.com/a")).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem("knowledge:recentJobs:d") ?? "[]") as [string, unknown][];
    expect(stored.map(([id]) => id)).toEqual(["c1"]);
  });

  it("hides an open clip form, out of reach, on the results pages", async () => {
    params = new URLSearchParams({ prefill: "https://example.com/a" });
    const { container, rerender } = render(<NotesPage />);
    params = new URLSearchParams({ view: "all" });
    rerender(<NotesPage />);
    await screen.findByText("knowledge.notes.all");

    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${CLIP_URL}"]`)!;
    const wrapper = input.closest("[hidden]") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(getComputedStyle(wrapper).display).toBe("none");
    expect(screen.queryByRole("link", { name: CONNECTIONS })).toBeNull();
    expect(screen.queryByRole("button", { name: CLIP_TILE })).toBeNull();
  });

  it("opens the clip form under Find for a prefill without autosubmit, and sends nothing", async () => {
    params = new URLSearchParams({ prefill: "https://example.com/a" });
    render(<NotesPage />);
    const clip = screen.getByRole("textbox", { name: CLIP_URL });
    expect(before(screen.getByRole("search"), clip)).toBe(true);
    expect(before(clip, screen.getByText("knowledge.notes.recent"))).toBe(true);
    expect(clip).toHaveValue("https://example.com/a");
    await act(async () => {});
    expect(createClip).not.toHaveBeenCalled();
  });

  it("treats a blank q as the landing", async () => {
    params = new URLSearchParams({ q: "   " });
    render(<NotesPage />);
    expect(screen.getByRole("search")).toBeInTheDocument();
    await screen.findByText("knowledge.notes.empty");
    expect(getDriveFiles.mock.calls).toEqual([["d", { type: "text", sort: "updated_at", order: "desc", limit: 8 }]]);
  });
});

describe("Show more", () => {
  const all = Array.from({ length: 90 }, (_, i) => note(`n${i}`));
  const slice = (p: number) => page(all.slice((p - 1) * 30, p * 30), 90);

  it("shows every note once however hard it is pressed, then goes away", async () => {
    params = new URLSearchParams({ view: "all" });
    const second = deferred<ReturnType<typeof page>>();
    getDriveFiles
      .mockResolvedValueOnce(slice(1))
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce(slice(3));
    render(<NotesPage />);
    await screen.findByText("Note n29");

    const more = screen.getByRole("button", { name: "knowledge.notes.showMore" });
    fireEvent.click(more);
    expect(more).toBeDisabled();
    fireEvent.click(more);
    await act(async () => second.resolve(slice(2)));
    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.showMore" }));
    await screen.findByText("Note n89");

    expect(getDriveFiles.mock.calls.map(([, o]) => (o as { page: number }).page)).toEqual([1, 2, 3]);
    expect(screen.getAllByRole("link", { name: /^Note n/ }).map((a) => a.textContent?.match(/^Note n\d+/)?.[0])).toEqual(
      all.map((f) => f.title),
    );
    expect(screen.queryByRole("button", { name: "knowledge.notes.showMore" })).toBeNull();
  });

  it("offers the same button again after a page fails, and continues from that page", async () => {
    params = new URLSearchParams({ view: "all" });
    getDriveFiles
      .mockResolvedValueOnce(slice(1))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(slice(2));
    render(<NotesPage />);
    await screen.findByText("Note n29");

    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.showMore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("knowledge.notes.loadFailed");
    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.showMore" }));
    await screen.findByText("Note n59");

    expect(getDriveFiles.mock.calls.map(([, o]) => (o as { page: number }).page)).toEqual([1, 2, 2]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("link", { name: /^Note n/ })).toHaveLength(60);
  });

  it("reports a failed first page and lets it be retried", async () => {
    params = new URLSearchParams({ q: "kyoto" });
    getDriveFiles.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(page([note("k1")], 1));
    render(<NotesPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("knowledge.notes.loadFailed");
    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.showMore" }));
    await screen.findByText("Note k1");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("New note", () => {
  async function pressNewNote() {
    render(<NotesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "knowledge.notes.newNote" }));
  }

  it("opens Quick Note on this drive from the landing and creates nothing itself", async () => {
    await pressNewNote();
    expect(openQuickNote.mock.calls).toEqual([[{ drive: "d" }]]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createTextFile).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not pass a folder from the landing or find results", async () => {
    params = new URLSearchParams({ q: "kyoto", folder: "journal" });
    await pressNewNote();
    expect(openQuickNote.mock.calls).toEqual([[{ drive: "d" }]]);
  });

  it("passes no folder on All notes when every folder is listed", async () => {
    params = new URLSearchParams({ view: "all" });
    await pressNewNote();
    expect(openQuickNote.mock.calls).toEqual([[{ drive: "d" }]]);
  });

  it("passes the chosen folder on All notes", async () => {
    params = new URLSearchParams({ view: "all", folder: "journal/2026" });
    await pressNewNote();
    expect(openQuickNote.mock.calls).toEqual([[{ drive: "d", folder: "journal/2026" }]]);
  });

  it("passes the drive root when it is the chosen folder on All notes", async () => {
    params = new URLSearchParams({ view: "all", folder: "" });
    await pressNewNote();
    expect(openQuickNote.mock.calls).toEqual([[{ drive: "d", folder: "" }]]);
  });
});

describe("Continue writing", () => {
  it("fails on its own, leaving Recent notes and the clip entry", async () => {
    nickname = "alice";
    getWatchHistory.mockRejectedValue(new Error("boom"));
    getDriveFiles.mockResolvedValue(page([note("r1")], 1));
    render(<NotesPage />);

    const heading = await screen.findByText("knowledge.notes.continueWriting");
    expect(within(heading.closest("section")!).getByRole("alert")).toHaveTextContent("knowledge.notes.loadFailed");
    expect(await screen.findByText("Note r1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CLIP_TILE })).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("follows a nickname change without keeping the previous profile's rows or error", async () => {
    nickname = "alice";
    const alice = deferred<FileItem[]>();
    getWatchHistory.mockReturnValueOnce(alice.promise).mockResolvedValueOnce([note("bob1")]);
    const { rerender } = render(<NotesPage />);
    await waitFor(() => expect(getWatchHistory).toHaveBeenCalledTimes(1));

    nickname = "bob";
    rerender(<NotesPage />);
    await screen.findByText("Note bob1");
    await act(async () => alice.resolve([note("alice1")]));
    expect(screen.queryByText("Note alice1")).toBeNull();

    cleanup();
    nickname = "alice";
    getWatchHistory.mockReset().mockResolvedValueOnce([note("alice2")]).mockReturnValueOnce(new Promise(() => {}));
    const shown = render(<NotesPage />);
    await screen.findByText("Note alice2");
    nickname = "bob";
    shown.rerender(<NotesPage />);
    await act(async () => {});
    expect(screen.queryByText("Note alice2")).toBeNull();

    cleanup();
    nickname = "alice";
    getWatchHistory.mockReset().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([note("bob2")]);
    const second = render(<NotesPage />);
    await screen.findByRole("alert");
    nickname = "bob";
    second.rerender(<NotesPage />);
    await screen.findByText("Note bob2");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the connections entry", () => {
  it("links to the connections page for this drive, and that page keeps Notes lit in the sidebar", async () => {
    const { addonUrlFor } = await import("@/lib/addons");
    const { isAddonNavRowActive } = await import("@/components/sidebar/isSidebarLinkActive");
    render(<NotesPage />);

    const link = screen.getByRole("link", { name: CONNECTIONS });
    const href = link.getAttribute("href")!;
    expect(href).toBe("/drive/d/addons/knowledge/connections");
    expect(link).toHaveAttribute("data-next-link");

    const knowledge = addonUrlFor("knowledge", { label: "Notes", icon: "notebook-pen", href: "/drive/{drive}/addons/knowledge", scope: "drive" }, "d")!;
    const intelligence = addonUrlFor("intelligence", { label: "Ask", icon: "message-circle-question", href: "/drive/{drive}/addons/intelligence", scope: "drive" }, "d")!;
    expect([isAddonNavRowActive(href, knowledge), isAddonNavRowActive(href, intelligence)]).toEqual([true, false]);
  });
});

describe("the connections entry on a drive whose name needs encoding", () => {
  it("encodes the drive into the link", () => {
    drive = "動画 #1?";
    render(<NotesPage />);
    expect(screen.getByRole("link", { name: CONNECTIONS }).getAttribute("href")).toBe(
      "/drive/%E5%8B%95%E7%94%BB%20%231%3F/addons/knowledge/connections",
    );
  });
});

describe("clip dialogs opened on the landing, after the reader moves to results", () => {
  const PASTE_HTML = "knowledge.clip.paste.placeholder";

  function openClipSection() {
    const { rerender } = render(<NotesPage />);
    fireEvent.click(screen.getByRole("button", { name: CLIP_TILE }));
    return rerender;
  }

  it.each<Record<string, string>>([{ q: "kyoto" }, { view: "all" }])("closes the bookmarklet instructions and the paste form for %o", async (away) => {
    const rerender = openClipSection();
    fireEvent.click(screen.getByRole("button", { name: "knowledge.dashboard.bookmarklet" }));
    fireEvent.click(screen.getByRole("button", { name: "knowledge.dashboard.pasteHtml" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: PASTE_HTML })).toBeInTheDocument();

    params = new URLSearchParams(away);
    rerender(<NotesPage />);
    await act(async () => {});
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    expect(screen.queryByRole("textbox", { name: PASTE_HTML, hidden: true })).toBeNull();

    params = new URLSearchParams();
    rerender(<NotesPage />);
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("textbox", { name: PASTE_HTML })).toBeNull();
    expect(screen.getByRole("textbox", { name: CLIP_URL })).toBeInTheDocument();
  });

  it("closes the duplicate notice", async () => {
    findClipsByUrl.mockResolvedValue([{ job_id: 1, file_id: "c1", status: "ready" }]);
    const rerender = openClipSection();
    fireEvent.change(screen.getByRole("textbox", { name: CLIP_URL }), { target: { value: "https://example.com/a" } });
    fireEvent.click(screen.getByRole("button", { name: "knowledge.clip.submit" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    params = new URLSearchParams({ view: "all" });
    rerender(<NotesPage />);
    await act(async () => {});
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();

    params = new URLSearchParams();
    rerender(<NotesPage />);
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createClip).not.toHaveBeenCalled();
  });
});

describe("a row waits for its own opening", () => {
  /** Holds the listing's openings until the test lets them go. */
  function holdOpenings() {
    const waiting: Array<(openings: Record<string, string>) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/note-openings")) {
          const openings = await new Promise<Record<string, string>>((resolve) => {
            waiting.push(resolve);
          });
          return { ok: true, status: 200, json: async () => ({ openings }) };
        }
        return { ok: false, status: 404, text: async () => "" };
      }),
    );
    return async (openings: Record<string, string> = {}) => {
      await waitFor(() => expect(waiting.length).toBeGreaterThan(0));
      await act(async () => {
        for (const resolve of waiting.splice(0)) resolve(openings);
      });
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a recent note off the list until then", async () => {
    getDriveFiles.mockResolvedValue(page([note("r1")]));
    const letGo = holdOpenings();
    render(<NotesPage />);
    await screen.findByText("knowledge.notes.recent");

    expect(screen.queryByText("Note r1")).toBeNull();

    await letGo({ r1: "The body." });
    expect(await screen.findByText("Note r1")).toBeInTheDocument();
  });

  it("keeps the Continue writing section away until then", async () => {
    nickname = "alice";
    getWatchHistory.mockResolvedValue([note("w1")]);
    const letGo = holdOpenings();
    render(<NotesPage />);
    await screen.findByText("knowledge.notes.recent");

    expect(screen.queryByText("knowledge.notes.continueWriting")).toBeNull();

    await letGo({ w1: "The body." });
    expect(await screen.findByText("knowledge.notes.continueWriting")).toBeInTheDocument();
  });

  it("keeps a search result off the list until then", async () => {
    params = new URLSearchParams({ q: "kyoto" });
    getDriveFiles.mockResolvedValue(page([note("q1")]));
    const letGo = holdOpenings();
    render(<NotesPage />);
    await screen.findByText('knowledge.notes.count{"count":1}');

    expect(screen.queryByText("Note q1")).toBeNull();

    await letGo({ q1: "The body." });
    expect(await screen.findByText("Note q1")).toBeInTheDocument();
  });
});
