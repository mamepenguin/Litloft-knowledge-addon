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
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    createClip: (...a: unknown[]) => createClip(...a),
    findClipsByUrl: vi.fn(async () => []),
  };
});

vi.mock("@/components/FolderPicker", () => ({
  FolderPicker: () => <div data-testid="folder-picker" />,
}));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => null }));
vi.mock("../ConnectionsGraph", () => ({ default: () => <div data-testid="graph" /> }));

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
  window.localStorage.clear();
});

afterEach(cleanup);

describe("the Notes landing", () => {
  it("lays out Find, Continue writing, Recent notes, the clip form and the graph in that order", async () => {
    nickname = "alice";
    getWatchHistory.mockResolvedValue([note("w1")]);
    getDriveFiles.mockResolvedValue(page([note("r1")], 12));
    render(<NotesPage />);

    const find = screen.getByRole("search");
    const cont = await screen.findByText("knowledge.notes.continueWriting");
    const recent = screen.getByText("knowledge.notes.recent");
    await screen.findByText("Note r1");
    const clip = screen.getByRole("textbox", { name: CLIP_URL });
    const graph = screen.getByTestId("graph");
    expect([before(find, cont), before(cont, recent), before(recent, clip), before(clip, graph)]).toEqual([
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
    expect(screen.queryByTestId("graph")).toBeNull();
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
