/**
 * SPEC-ADDON-130: the Notes app frame. Messages are echoed as `namespace.key`
 * with their values, so the assertions read keys rather than English.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { FileItem } from "@/types";
import type { SmartFolder } from "@/types/smartFolder";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    (ns?: string) =>
    (key: string, values?: Record<string, unknown>) =>
      key === "driveScope"
        ? `${values!.drive} · ${values!.detail}`
        : `${ns ?? ""}.${key}${values ? JSON.stringify(values) : ""}`,
}));

const PATH = "/drive/d/addons/knowledge";
let params = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push, replace }),
  usePathname: () => PATH,
}));
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => "d" }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname: null, setNickname: vi.fn(), clearNickname: vi.fn() }),
}));
const openQuickNote = vi.fn();
vi.mock("@/components/quick-note", () => ({ useQuickNote: () => ({ open: openQuickNote }) }));
const overlaySidebar = vi.fn();
vi.mock("@/components/SidebarProvider", () => ({ useOverlaySidebar: () => overlaySidebar() }));

const getDriveFiles = vi.fn();
const getDriveFilesWithFileIds = vi.fn();
const getWatchHistory = vi.fn();
const getSmartFolders = vi.fn();
const getCollections = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getDriveFiles: (...a: unknown[]) => getDriveFiles(...a),
    getDriveFilesWithFileIds: (...a: unknown[]) => getDriveFilesWithFileIds(...a),
    getWatchHistory: (...a: unknown[]) => getWatchHistory(...a),
    getSmartFolders: (...a: unknown[]) => getSmartFolders(...a),
    getCollections: (...a: unknown[]) => getCollections(...a),
  };
});

const evaluateMemberTarget = vi.fn();
vi.mock("@/lib/memberTarget", async () => {
  const actual = await vi.importActual<typeof import("@/lib/memberTarget")>("@/lib/memberTarget");
  return { ...actual, evaluateMemberTarget: (...a: unknown[]) => evaluateMemberTarget(...a) };
});

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, fetchNoteOpenings: vi.fn(async () => ({})) };
});
vi.mock("../notesapp/sourcesApi", () => ({
  getNotesWithSources: vi.fn(async () => []),
  getNoteSources: vi.fn(async () => ({})),
}));
const library = vi.fn();
vi.mock("../library/NotesLibrary", () => ({
  default: (props: unknown) => {
    library(props);
    return <div data-testid="library" />;
  },
}));

const { registerChangeGate } = await import("../notesapp/changeGate");
const NotesPage = (await import("../NotesPage")).default;

const TARGET_KEY = "litloft.addon.knowledge.target.d";

function note(id: string): FileItem {
  return {
    id,
    filename: `${id}.md`,
    title: `Note ${id}`,
    drive: "d",
    folder_path: "journal",
    mime_type: "text/markdown",
    updated_at: "2026-09-14T09:00:00Z",
  } as FileItem;
}

function page(total: number, files: FileItem[] = []) {
  return { data: files, meta: { total, page: 1, limit: 5 } };
}

function folder(id: string, name: string, query: string, file_type: SmartFolder["file_type"] = null): SmartFolder {
  return {
    id,
    drive: "d",
    name,
    query,
    file_type,
    sort_by: null,
    sort_order: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The line under the title, without the Target button that ends it. */
function scopeLine(): string {
  const line = screen.getByRole("heading", { level: 1 }).nextElementSibling!;
  const button = within(line as HTMLElement).queryByRole("button", { name: /knowledge\.notesApp\.target/ });
  return line.textContent!.replace(button?.textContent ?? "", "").trim();
}
const countCalls = () =>
  getDriveFiles.mock.calls
    .filter(([, p]) => (p as { limit?: number }).limit === 1)
    .map(([drive, p]) => [drive, p]);

beforeEach(() => {
  params = new URLSearchParams();
  push.mockReset();
  replace.mockReset();
  openQuickNote.mockReset();
  overlaySidebar.mockReset();
  library.mockReset();
  getDriveFiles.mockReset().mockResolvedValue(page(3, [note("a")]));
  getDriveFilesWithFileIds.mockReset().mockResolvedValue(page(2, [note("m")]));
  getWatchHistory.mockReset().mockResolvedValue([]);
  getSmartFolders.mockReset().mockResolvedValue([]);
  getCollections.mockReset().mockResolvedValue([]);
  evaluateMemberTarget.mockReset().mockResolvedValue({ status: "ready", fileIds: ["m1", "m2"] });
  window.localStorage.clear();
});

afterEach(cleanup);

describe("SPEC-ADDON-130 the header", () => {
  it("draws the app header with the Notes title, the Target, New note and the two tabs", async () => {
    render(<NotesPage />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("knowledge.notesApp.title");
    expect(h1.closest("header")!.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: /knowledge\.notesApp\.target/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "knowledge.notesApp.newNote" }).closest("header")).not.toBeNull();

    const tabs = screen.getByRole("navigation", { name: "knowledge.notesApp.tabsLabel" });
    const [home, lib] = Array.from(tabs.querySelectorAll("a"));
    expect(home).toHaveTextContent("knowledge.notesApp.home");
    expect(home.getAttribute("href")).toBe(PATH);
    expect(home).toHaveAttribute("aria-current", "page");
    expect(lib.getAttribute("href")).toBe(`${PATH}?view=all`);
    await act(async () => {});
  });

  it("leaves the sidebar alone, so it is inline at 1200px and wider", async () => {
    render(<NotesPage />);
    await act(async () => {});
    expect(overlaySidebar).not.toHaveBeenCalled();
  });

  it("is not a page with the landing's search box or its tool tiles", async () => {
    render(<NotesPage />);
    await act(async () => {});
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByText(/clipTile|toolsHeading|connections/)).toBeNull();
  });
});

describe("SPEC-ADDON-130 the scope line", () => {
  it("names the drive alone until the count has answered, then states it", async () => {
    const answer = deferred<ReturnType<typeof page>>();
    getDriveFiles.mockImplementation((_d: string, p: { limit?: number }) =>
      p.limit === 1 ? answer.promise : Promise.resolve(page(42, [note("a")])),
    );
    render(<NotesPage />);
    await act(async () => {});
    expect(scopeLine()).toBe("d");
    expect(scopeLine()).not.toMatch(/0/);

    await act(async () => answer.resolve(page(42)));
    expect(scopeLine()).toContain('knowledge.notesApp.count{"count":42}');
  });

  it("names the drive alone after the count fails, and still draws Home", async () => {
    getDriveFiles.mockImplementation((_d: string, p: { limit?: number }) =>
      p.limit === 1 ? Promise.reject(new Error("down")) : Promise.resolve(page(1, [note("a")])),
    );
    render(<NotesPage />);
    await screen.findByText("Note a");
    expect(scopeLine()).toBe("d");
  });

  it("counts the target's text notes with no clip, and nothing more for the default target", async () => {
    render(<NotesPage />);
    await waitFor(() => expect(countCalls()).toHaveLength(1));
    expect(countCalls()[0]).toEqual(["d", { type: "text", exclude_origin: "webclip", limit: 1 }]);
  });

  it("says 0 only once the listing answers 0, and then draws the empty state alone", async () => {
    getDriveFiles.mockResolvedValue(page(0));
    render(<NotesPage />);
    expect(await screen.findByText("knowledge.notesApp.emptyTitle")).toBeInTheDocument();
    expect(scopeLine()).toContain('knowledge.notesApp.count{"count":0}');
    expect(screen.getByRole("navigation", { name: "knowledge.notesApp.tabsLabel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "knowledge.notesApp.newNote" })).toBeInTheDocument();
    expect(screen.queryByText("knowledge.notesApp.continueWriting")).toBeNull();
    expect(screen.queryByText("knowledge.notesApp.recent")).toBeNull();
  });

  it("asks for no history while the drive has no notes", async () => {
    getDriveFiles.mockResolvedValue(page(0));
    render(<NotesPage />);
    await screen.findByText("knowledge.notesApp.emptyTitle");
    expect(getWatchHistory).not.toHaveBeenCalled();
  });

  it("draws the empty state in the Library too, and not the Library", async () => {
    params = new URLSearchParams({ view: "all" });
    getDriveFiles.mockResolvedValue(page(0));
    render(<NotesPage />);
    expect(await screen.findByText("knowledge.notesApp.emptyTitle")).toBeInTheDocument();
    expect(screen.queryByTestId("library")).toBeNull();
  });
});

describe("SPEC-ADDON-130 the tabs", () => {
  it("draws Home for no view and the Library for view=all, handing it the target and the count", async () => {
    const { rerender } = render(<NotesPage />);
    await screen.findByText("Note a");
    expect(screen.queryByTestId("library")).toBeNull();

    params = new URLSearchParams({ view: "all" });
    rerender(<NotesPage />);
    await screen.findByTestId("library");
    expect(library.mock.lastCall![0]).toMatchObject({
      drive: "d",
      target: { status: "ready", key: "default", params: null, fileIds: null },
    });
    await waitFor(() => expect(library.mock.lastCall![0]).toMatchObject({ total: 3 }));
    const tabs = screen.getByRole("navigation", { name: "knowledge.notesApp.tabsLabel" });
    expect(tabs.querySelectorAll("a")[1]).toHaveAttribute("aria-current", "page");
  });

  it("ignores clips=1, which no longer reaches the lists", async () => {
    params = new URLSearchParams({ view: "all", clips: "1" });
    render(<NotesPage />);
    await screen.findByTestId("library");
    for (const [, p] of getDriveFiles.mock.calls) expect(p).toMatchObject({ exclude_origin: "webclip" });
  });

  it("holds a tab change behind the page's gate, and lets it through when the gate does", async () => {
    render(<NotesPage />);
    await screen.findByText("Note a");
    const gate = vi.fn();
    const off = registerChangeGate(gate);
    try {
      fireEvent.click(screen.getByRole("link", { name: "knowledge.notesApp.library" }));
      expect(push).not.toHaveBeenCalled();
      expect(gate).toHaveBeenCalledTimes(1);
      gate.mock.calls[0][0]();
      expect(push).toHaveBeenCalledWith(`${PATH}?view=all`);
    } finally {
      off();
    }
  });

  it("is a plain link when nothing holds the change back", async () => {
    render(<NotesPage />);
    await screen.findByText("Note a");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link", { name: "knowledge.notesApp.library" }).dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("SPEC-ADDON-130 New note", () => {
  it("opens Quick Note on the drive from Home, with no folder", async () => {
    render(<NotesPage />);
    fireEvent.click(screen.getByRole("button", { name: "knowledge.notesApp.newNote" }));
    expect(openQuickNote).toHaveBeenCalledWith({ drive: "d" });
    await act(async () => {});
  });

  it.each([
    ["a selected folder", "journal", { drive: "d", folder: "journal" }],
    ["the drive root", "", { drive: "d", folder: "" }],
  ])("preselects %s in the Library", async (_, value, expected) => {
    params = new URLSearchParams({ view: "all", folder: value });
    render(<NotesPage />);
    fireEvent.click(screen.getByRole("button", { name: "knowledge.notesApp.newNote" }));
    expect(openQuickNote).toHaveBeenCalledWith(expected);
    await act(async () => {});
  });

  it("preselects no folder in the Library with every folder listed", async () => {
    params = new URLSearchParams({ view: "all", tag: "AI" });
    render(<NotesPage />);
    fireEvent.click(screen.getByRole("button", { name: "knowledge.notesApp.newNote" }));
    expect(openQuickNote).toHaveBeenCalledWith({ drive: "d" });
    await act(async () => {});
  });
});

describe("SPEC-ADDON-130 the Target", () => {
  it("sends no listing request while the saved Smart Collection is looked up", async () => {
    window.localStorage.setItem(TARGET_KEY, "sf1");
    const folders = deferred<SmartFolder[]>();
    getSmartFolders.mockReturnValue(folders.promise);
    render(<NotesPage />);
    await act(async () => {});
    expect(getDriveFiles).not.toHaveBeenCalled();
    expect(getWatchHistory).not.toHaveBeenCalled();
    expect(scopeLine()).toBe("d");

    await act(async () => folders.resolve([folder("sf1", "Work", "tag:work")]));
    await waitFor(() => expect(countCalls()).toHaveLength(1));
    expect(countCalls()[0][1]).toMatchObject({ tag: ["work"], type: "text", exclude_origin: "webclip" });
  });

  it("sends no listing request while the saved collection is looked up", async () => {
    window.localStorage.setItem(TARGET_KEY, "collection:c1");
    const lists = deferred<unknown[]>();
    getCollections.mockReturnValue(lists.promise);
    render(<NotesPage />);
    await act(async () => {});
    expect(getDriveFiles).not.toHaveBeenCalled();
    expect(getWatchHistory).not.toHaveBeenCalled();
    expect(scopeLine()).toBe("d");
    await act(async () => lists.resolve([{ id: "c1", name: "Reading list", count: 3 }]));
    await waitFor(() => expect(countCalls()).toHaveLength(1));
  });

  it("carries a collection's conditions on every request", async () => {
    window.localStorage.setItem(TARGET_KEY, "collection:c1");
    getCollections.mockResolvedValue([{ id: "c1", name: "Reading list", count: 3 }]);
    render(<NotesPage />);
    await waitFor(() => expect(countCalls()).toHaveLength(1));
    expect(countCalls()[0][1]).toMatchObject({ collection: ["Reading list"], type: "text" });
    await screen.findByText("Note a");
    for (const [, p] of getDriveFiles.mock.calls) expect(p).toMatchObject({ collection: ["Reading list"] });
  });

  it("sends a Smart Collection with free text as member ids through the query routes", async () => {
    window.localStorage.setItem(TARGET_KEY, "sf1");
    getSmartFolders.mockResolvedValue([folder("sf1", "Kyoto", "kyoto")]);
    render(<NotesPage />);
    await screen.findByText("Note m");
    expect(getDriveFiles).not.toHaveBeenCalled();
    for (const [, p, ids] of getDriveFilesWithFileIds.mock.calls) {
      expect(p).toMatchObject({ type: "text", exclude_origin: "webclip" });
      expect(ids).toEqual(["m1", "m2"]);
    }
    expect(getDriveFilesWithFileIds.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("asks nothing, and says 0 notes, for a Smart Collection with no text in it", async () => {
    window.localStorage.setItem(TARGET_KEY, "sf1");
    getSmartFolders.mockResolvedValue([folder("sf1", "Videos", "type:video")]);
    render(<NotesPage />);
    expect(await screen.findByText("knowledge.notesApp.emptyTitle")).toBeInTheDocument();
    expect(getDriveFiles).not.toHaveBeenCalled();
    expect(getDriveFilesWithFileIds).not.toHaveBeenCalled();
    expect(scopeLine()).toContain('knowledge.notesApp.count{"count":0}');
  });

  it("asks nothing for a member Smart Collection whose kinds leave no text", async () => {
    window.localStorage.setItem(TARGET_KEY, "sf1");
    getSmartFolders.mockResolvedValue([folder("sf1", "Videos", "kyoto type:video")]);
    render(<NotesPage />);
    expect(await screen.findByText("knowledge.notesApp.emptyTitle")).toBeInTheDocument();
    expect(evaluateMemberTarget).not.toHaveBeenCalled();
    expect(getDriveFilesWithFileIds).not.toHaveBeenCalled();
  });

  it.each([
    ["is too large", { status: "tooLarge" }],
    ["fails", { status: "failed" }],
  ])("puts the default target in force when a member evaluation %s, and keeps the saved id", async (_, result) => {
    window.localStorage.setItem(TARGET_KEY, "sf1");
    getSmartFolders.mockResolvedValue([folder("sf1", "Kyoto", "kyoto")]);
    evaluateMemberTarget.mockResolvedValue(result);
    render(<NotesPage />);
    await screen.findByText("Note a");
    expect(getDriveFilesWithFileIds).not.toHaveBeenCalled();
    expect(countCalls()[0]).toEqual(["d", { type: "text", exclude_origin: "webclip", limit: 1 }]);
    expect(window.localStorage.getItem(TARGET_KEY)).toBe("sf1");

    fireEvent.click(screen.getByRole("button", { name: /knowledge\.notesApp\.target/ }));
    const row = await screen.findByRole("menuitemradio", { name: /Kyoto/ });
    expect(row).toBeDisabled();
    expect(row).toHaveAttribute("title", "knowledge.notesApp.unavailable");
  });

  it("hands the Library the default target, not a half-evaluated member one, after a failed evaluation", async () => {
    params = new URLSearchParams({ view: "all" });
    window.localStorage.setItem(TARGET_KEY, "sf1");
    getSmartFolders.mockResolvedValue([folder("sf1", "Kyoto", "kyoto")]);
    evaluateMemberTarget.mockResolvedValue({ status: "failed" });
    render(<NotesPage />);
    await screen.findByTestId("library");
    expect(library.mock.lastCall![0]).toMatchObject({
      target: { status: "ready", key: "default", params: null, fileIds: null },
    });
  });

  it("falls back to the default target for a saved id that is gone, keeping it", async () => {
    window.localStorage.setItem(TARGET_KEY, "gone");
    render(<NotesPage />);
    await screen.findByText("Note a");
    expect(countCalls()[0]).toEqual(["d", { type: "text", exclude_origin: "webclip", limit: 1 }]);
    expect(window.localStorage.getItem(TARGET_KEY)).toBe("gone");
  });

  it("writes its own key, and no other app's, when a Target is chosen", async () => {
    getSmartFolders.mockResolvedValue([folder("sf1", "Work", "tag:work")]);
    render(<NotesPage />);
    await screen.findByText("Note a");
    fireEvent.click(screen.getByRole("button", { name: /knowledge\.notesApp\.target/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Work/ }));

    expect(window.localStorage.getItem(TARGET_KEY)).toBe("sf1");
    expect(Object.keys(window.localStorage).filter((k) => k.includes("target") && k !== TARGET_KEY)).toEqual([]);
    await waitFor(() =>
      expect(countCalls().at(-1)![1]).toMatchObject({ tag: ["work"], type: "text", exclude_origin: "webclip" }),
    );
  });

  it("shows no 0 while the count of a newly chosen Target loads", async () => {
    getSmartFolders.mockResolvedValue([folder("sf1", "Work", "tag:work")]);
    render(<NotesPage />);
    await screen.findByText("Note a");
    await waitFor(() => expect(scopeLine()).toContain('"count":3'));

    const next = deferred<ReturnType<typeof page>>();
    getDriveFiles.mockImplementation((_d: string, p: { limit?: number }) =>
      p.limit === 1 ? next.promise : Promise.resolve(page(1, [note("w")])),
    );
    fireEvent.click(screen.getByRole("button", { name: /knowledge\.notesApp\.target/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Work/ }));
    await act(async () => {});
    expect(scopeLine()).toBe("d");
    await act(async () => next.resolve(page(7)));
    expect(scopeLine()).toContain('"count":7');
  });

  it("holds a Target change behind the page's gate", async () => {
    getSmartFolders.mockResolvedValue([folder("sf1", "Work", "tag:work")]);
    render(<NotesPage />);
    await screen.findByText("Note a");
    const gate = vi.fn();
    const off = registerChangeGate(gate);
    try {
      fireEvent.click(screen.getByRole("button", { name: /knowledge\.notesApp\.target/ }));
      fireEvent.click(await screen.findByRole("menuitemradio", { name: /Work/ }));
      expect(window.localStorage.getItem(TARGET_KEY)).toBeNull();
      gate.mock.calls[0][0]();
      expect(window.localStorage.getItem(TARGET_KEY)).toBe("sf1");
    } finally {
      off();
    }
  });
});
