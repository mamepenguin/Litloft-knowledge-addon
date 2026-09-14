import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { accentFills } from "@/__tests__/helpers/accentFills";
import type { FileItem } from "@/types";

vi.mock("next-intl", () => ({
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

vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => "d" }));

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

vi.mock("@/components/FolderPicker", () => ({
  FolderPicker: () => <div data-testid="folder-picker" />,
}));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => null }));
vi.mock("../ConnectionsGraph", () => ({ default: () => <div data-testid="graph" /> }));

const CONNECTIONS = "knowledge.notes.connections";

const NotesPage = (await import("../NotesPage")).default;

function note(id: string, folder = "journal"): FileItem {
  return {
    id,
    filename: `${id}.md`,
    title: `Note ${id}`,
    drive: "d",
    folder_path: folder,
    mime_type: "text/markdown",
  } as FileItem;
}

function page(files: FileItem[], total = files.length) {
  return { data: files, meta: { total, page: 1, limit: files.length } };
}

const CLIP_URL = "knowledge.dashboard.clipUrlLabel";
const before = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  params = new URLSearchParams();
  nickname = null;
  editorEnabled = true;
  push.mockReset();
  getDriveFiles.mockReset().mockResolvedValue(page([]));
  getWatchHistory.mockReset().mockResolvedValue([]);
  createClip.mockReset().mockResolvedValue({ job_id: 1, file_id: "c1", status: "fetching" });
  findClipsByUrl.mockReset().mockResolvedValue([]);
  createTextFile.mockReset().mockResolvedValue({ id: "n1" });
  window.localStorage.clear();
});

afterEach(cleanup);

describe("the Notes landing", () => {
  it("lays out Find, Continue writing, Recent notes, the clip form and the connections link in that order", async () => {
    nickname = "alice";
    getWatchHistory.mockResolvedValue([note("w1")]);
    getDriveFiles.mockResolvedValue(page([note("r1")], 12));
    render(<NotesPage />);

    const find = screen.getByRole("search");
    const cont = await screen.findByText("knowledge.notes.continueWriting");
    const recent = screen.getByText("knowledge.notes.recent");
    await screen.findByText("Note r1");
    const clip = screen.getByRole("textbox", { name: CLIP_URL });
    const connections = screen.getByRole("link", { name: CONNECTIONS });
    expect(screen.queryByTestId("graph")).toBeNull();
    expect([before(find, cont), before(cont, recent), before(recent, clip), before(clip, connections)]).toEqual([
      true,
      true,
      true,
      true,
    ]);
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
    expect(getWatchHistory.mock.calls).toEqual([["d", 6, "all", "text"]]);
    expect(screen.getByRole("link", { name: /Note w1/ }).getAttribute("href")).toBe("/drive/d/journal?file=w1");

    cleanup();
    getWatchHistory.mockResolvedValueOnce([]);
    render(<NotesPage />);
    await screen.findByText("knowledge.notes.empty");
    await act(async () => {});
    expect(screen.queryByText("knowledge.notes.continueWriting")).toBeNull();
  });

  it("keeps the clip form and Continue writing when the note list fails", async () => {
    nickname = "alice";
    getWatchHistory.mockResolvedValue([note("w1")]);
    getDriveFiles.mockRejectedValue(new Error("boom"));
    render(<NotesPage />);

    const recent = screen.getByText("knowledge.notes.recent").closest("section")!;
    expect(await within(recent).findByRole("alert")).toHaveTextContent("knowledge.notes.loadFailed");
    expect(await screen.findByText("Note w1")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: CLIP_URL })).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("puts Find into the URL", async () => {
    render(<NotesPage />);
    expect(screen.getByRole("searchbox")).toHaveAttribute("maxlength", "200");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " kyoto trip " } });
    fireEvent.submit(screen.getByRole("search"));
    expect(push.mock.calls).toEqual([[`${PATH}?q=kyoto+trip`]]);
  });

  it("puts the clip form first when a bookmarklet lands, and submits it once", async () => {
    params = new URLSearchParams({ prefill: "https://example.com/a", title: "A", autosubmit: "1" });
    render(<NotesPage />);

    const clip = screen.getByRole("textbox", { name: CLIP_URL });
    expect(before(clip, screen.getByRole("search"))).toBe(true);
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
    expect(screen.queryByRole("search")).toBeNull();
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

  it("fills nothing when the editor is off, and offers no New note", async () => {
    editorEnabled = false;
    getDriveFiles.mockResolvedValue(page([note("r1")], 12));
    const { container } = render(<NotesPage />);
    await screen.findByText("Note r1");

    expect(screen.queryByRole("button", { name: "knowledge.notes.newNote" })).toBeNull();
    expect(accentFills(container)).toEqual([]);
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

  it("hides the clip form, out of reach, on the results pages", async () => {
    params = new URLSearchParams({ view: "all" });
    const { container } = render(<NotesPage />);
    await screen.findByText("knowledge.notes.all");

    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${CLIP_URL}"]`)!;
    const wrapper = input.closest("[hidden]") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(getComputedStyle(wrapper).display).toBe("none");
    expect(screen.queryByRole("link", { name: CONNECTIONS })).toBeNull();
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("puts the clip form first for a prefill without autosubmit, and sends nothing", async () => {
    params = new URLSearchParams({ prefill: "https://example.com/a" });
    render(<NotesPage />);
    const clip = screen.getByRole("textbox", { name: CLIP_URL });
    expect(before(clip, screen.getByRole("search"))).toBe(true);
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
    expect(screen.getAllByRole("link", { name: /^Note n/ }).map((a) => a.textContent)).toEqual(
      all.map((f) => `${f.title}${f.folder_path}`),
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

describe("New note on the landing", () => {
  it("opens the dialog, creates nothing on cancel, and opens the created note in the editor", async () => {
    render(<NotesPage />);
    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.newNote" }));
    const dialog = await screen.findByRole("dialog", { name: "knowledge.newNote.dialogTitle" });
    fireEvent.click(within(dialog).getByRole("button", { name: "common.cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createTextFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.newNote" }));
    const again = await screen.findByRole("dialog", { name: "knowledge.newNote.dialogTitle" });
    fireEvent.click(within(again).getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(push.mock.calls).toEqual([["/files/n1?edit=1"]]));
    expect(createTextFile).toHaveBeenCalledTimes(1);
  });
});

describe("Continue writing", () => {
  it("fails on its own, leaving Recent notes and the clip form", async () => {
    nickname = "alice";
    getWatchHistory.mockRejectedValue(new Error("boom"));
    getDriveFiles.mockResolvedValue(page([note("r1")], 1));
    render(<NotesPage />);

    const heading = await screen.findByText("knowledge.notes.continueWriting");
    expect(within(heading.closest("section")!).getByRole("alert")).toHaveTextContent("knowledge.notes.loadFailed");
    expect(await screen.findByText("Note r1")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: CLIP_URL })).toBeInTheDocument();
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

    const href = screen.getByRole("link", { name: CONNECTIONS }).getAttribute("href")!;
    expect(href).toBe("/drive/d/addons/knowledge/connections");

    const knowledge = addonUrlFor("knowledge", { label: "Notes", icon: "notebook-pen", href: "/drive/{drive}/addons/knowledge", scope: "drive" }, "d")!;
    const intelligence = addonUrlFor("intelligence", { label: "Ask", icon: "message-circle-question", href: "/drive/{drive}/addons/intelligence", scope: "drive" }, "d")!;
    expect([isAddonNavRowActive(href, knowledge), isAddonNavRowActive(href, intelligence)]).toEqual([true, false]);
  });
});
