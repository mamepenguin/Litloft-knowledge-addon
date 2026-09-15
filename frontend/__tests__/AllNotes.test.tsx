import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => "d" }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname: null, setNickname: vi.fn(), clearNickname: vi.fn() }),
}));
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => ({ enabled: true, isLoading: false }) }));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => null }));

const getDriveFiles = vi.fn();
const getFolderCounts = vi.fn();
const getDriveTags = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getDriveFiles: (...a: unknown[]) => getDriveFiles(...a),
    getFolderCounts: (...a: unknown[]) => getFolderCounts(...a),
    getDriveTags: (...a: unknown[]) => getDriveTags(...a),
    getWatchHistory: vi.fn().mockResolvedValue([]),
  };
});

const NotesPage = (await import("../NotesPage")).default;
const { allNotesHref, readAllNotesScope } = await import("../allNotesParams");

function note(id: string, folder: string, tags: string[] = []): FileItem {
  return {
    id,
    filename: `${id}.md`,
    title: `Note ${id}`,
    drive: "d",
    folder_path: folder,
    mime_type: "text/markdown",
    tags,
    updated_at: new Date().toISOString(),
  } as FileItem;
}

const page = (files: FileItem[], total = files.length) => ({ data: files, meta: { total, page: 1, limit: 30 } });

beforeEach(() => {
  params = new URLSearchParams({ view: "all" });
  push.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, text: async () => "" })));
  getDriveFiles.mockReset().mockResolvedValue(page([note("a", "Knowledge", ["AI"])]));
  getFolderCounts.mockReset().mockResolvedValue([
    { path: "", count: 2 },
    { path: "Knowledge", count: 5 },
    { path: "Knowledge/AI", count: 3 },
  ]);
  getDriveTags.mockReset().mockResolvedValue([{ name: "AI", count: 4 }]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rail = () => screen.getByRole("navigation", { name: "knowledge.notes.filtersLabel" });

describe("allNotesParams", () => {
  it("reads defaults, keeps an empty folder as the drive root, and leaves defaults out of the URL", () => {
    expect(readAllNotesScope(new URLSearchParams("view=all&sort=bogus"))).toEqual({
      folder: null,
      tag: null,
      sort: "updated",
      query: "",
    });
    expect(readAllNotesScope(new URLSearchParams("view=all&folder=&tag=AI&sort=title&q=+x+"))).toEqual({
      folder: "",
      tag: "AI",
      sort: "title",
      query: "x",
    });
    expect(allNotesHref(PATH, { folder: null, tag: null, sort: "updated", query: "" })).toBe(`${PATH}?view=all`);
    expect(allNotesHref(PATH, { folder: "", tag: "AI", sort: "created", query: "x" })).toBe(
      `${PATH}?view=all&folder=&tag=AI&sort=created&q=x`,
    );
  });
});

describe("the All notes rail", () => {
  it("lists every folder flat with its count, the total first, and marks the current scope", async () => {
    params = new URLSearchParams({ view: "all", folder: "Knowledge/AI", sort: "title" });
    render(<NotesPage />);

    await waitFor(() => expect(within(rail()).getAllByRole("link")).toHaveLength(5));
    const links = within(rail()).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
      ["knowledge.notes.everyFolder10", `${PATH}?view=all&sort=title`, null],
      ["knowledge.notes.rootFolder2", `${PATH}?view=all&folder=&sort=title`, null],
      ["Knowledge5", `${PATH}?view=all&folder=Knowledge&sort=title`, null],
      ["Knowledge / AI3", `${PATH}?view=all&folder=Knowledge%2FAI&sort=title`, "true"],
      ["AI4", `${PATH}?view=all&folder=Knowledge%2FAI&tag=AI&sort=title`, null],
    ]);
    expect(getFolderCounts.mock.calls).toEqual([["d", "text"]]);
    expect(getDriveTags.mock.calls).toEqual([["d", null, "text", "Knowledge/AI"]]);
  });

  it("takes a selected tag off when it is chosen again", async () => {
    params = new URLSearchParams({ view: "all", tag: "AI" });
    render(<NotesPage />);
    const tagLink = await within(rail()).findByRole("link", { name: /^AI/ });
    expect(tagLink).toHaveAttribute("aria-current", "true");
    expect(tagLink.getAttribute("href")).toBe(`${PATH}?view=all`);
  });

  it("keeps a deep folder's own name apart from its parents, and names the whole path", async () => {
    getFolderCounts.mockResolvedValue([{ path: "Knowledge/docs/superpowers/specs", count: 1 }]);
    render(<NotesPage />);

    const link = await within(rail()).findByRole("link", { name: /specs/ });
    expect(link).toHaveAttribute("title", "Knowledge/docs/superpowers/specs");
    const leaf = within(link).getByText("specs");
    expect(leaf).not.toHaveTextContent("Knowledge");
    expect(leaf.parentElement).toHaveTextContent(/^Knowledge\/docs\/superpowers \/ specs$/);
  });

  it("keeps the list when the rail cannot load", async () => {
    getFolderCounts.mockRejectedValue(new Error("boom"));
    getDriveTags.mockRejectedValue(new Error("boom"));
    render(<NotesPage />);
    expect(await screen.findByText("Note a")).toBeInTheDocument();
  });
});

describe("keeping the rest of the scope", () => {
  const FULL = { view: "all", folder: "Knowledge", tag: "AI", sort: "title", q: "kyoto" };

  it("changes one part from every rail link and keeps the others", async () => {
    params = new URLSearchParams(FULL);
    render(<NotesPage />);
    await waitFor(() => expect(within(rail()).getAllByRole("link")).toHaveLength(5));
    const hrefs = Object.fromEntries(
      within(rail()).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]),
    );
    expect(hrefs).toEqual({
      "knowledge.notes.everyFolder10": `${PATH}?view=all&tag=AI&sort=title&q=kyoto`,
      "knowledge.notes.rootFolder2": `${PATH}?view=all&folder=&tag=AI&sort=title&q=kyoto`,
      Knowledge5: `${PATH}?view=all&folder=Knowledge&tag=AI&sort=title&q=kyoto`,
      "Knowledge / AI3": `${PATH}?view=all&folder=Knowledge%2FAI&tag=AI&sort=title&q=kyoto`,
      AI4: `${PATH}?view=all&folder=Knowledge&sort=title&q=kyoto`,
    });
  });

  it("changes one part from every menu and keeps the others", async () => {
    params = new URLSearchParams(FULL);
    render(<NotesPage />);
    await waitFor(() => expect(within(rail()).getAllByRole("link")).toHaveLength(5));

    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.tagMenu: #AI" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "knowledge.notes.anyTag" }));
    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.folderMenu: Knowledge" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Knowledge/AI" }));
    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.sortMenu: knowledge.notes.sort.title" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "knowledge.notes.sort.updated" }));

    expect(push.mock.calls).toEqual([
      [`${PATH}?view=all&folder=Knowledge&sort=title&q=kyoto`],
      [`${PATH}?view=all&folder=Knowledge%2FAI&tag=AI&sort=title&q=kyoto`],
      [`${PATH}?view=all&folder=Knowledge&tag=AI&q=kyoto`],
    ]);
  });

  it("asks again when the scope changes in place", async () => {
    params = new URLSearchParams({ view: "all" });
    const { rerender } = render(<NotesPage />);
    await screen.findByText("Note a");

    params = new URLSearchParams({ view: "all", tag: "AI" });
    rerender(<NotesPage />);
    await waitFor(() => expect(getDriveFiles).toHaveBeenCalledTimes(2));
    params = new URLSearchParams({ view: "all", tag: "AI", sort: "created" });
    rerender(<NotesPage />);
    await waitFor(() => expect(getDriveFiles).toHaveBeenCalledTimes(3));
    params = new URLSearchParams({ view: "all", folder: "Inbox", tag: "AI", sort: "created" });
    rerender(<NotesPage />);
    await waitFor(() => expect(getDriveFiles).toHaveBeenCalledTimes(4));
    params = new URLSearchParams({ view: "all", folder: "Inbox", tag: "AI", sort: "created", q: "kyoto" });
    rerender(<NotesPage />);
    await waitFor(() => expect(getDriveFiles).toHaveBeenCalledTimes(5));

    expect(getDriveFiles.mock.calls.map(([, o]) => o)).toEqual([
      { type: "text", sort: "updated_at", order: "desc", page: 1, limit: 30 },
      { type: "text", sort: "updated_at", order: "desc", tag: "AI", page: 1, limit: 30 },
      { type: "text", sort: "created_at", order: "desc", tag: "AI", page: 1, limit: 30 },
      { type: "text", sort: "created_at", order: "desc", path: "Inbox", tag: "AI", page: 1, limit: 30 },
      { type: "text", sort: "created_at", order: "desc", path: "Inbox", tag: "AI", search: "kyoto", page: 1, limit: 30 },
    ]);
  });

  it("shows tags in place of the folder at the drive root, and the folder for a tag alone", async () => {
    getDriveFiles.mockResolvedValue(page([note("r", "", ["AI"])]));
    params = new URLSearchParams({ view: "all", folder: "" });
    const { unmount } = render(<NotesPage />);
    const root = await screen.findByRole("link", { name: /^Note r/ });
    expect(within(root).getAllByText("AI")).toHaveLength(2);
    expect(within(root).queryByText("knowledge.notes.rootFolder")).toBeNull();
    unmount();

    params = new URLSearchParams({ view: "all", tag: "AI" });
    render(<NotesPage />);
    const tagged = await screen.findByRole("link", { name: /^Note r/ });
    expect(within(tagged).getAllByText("knowledge.notes.rootFolder")).toHaveLength(2);
    expect(within(tagged).queryByText("AI")).toBeNull();
  });
});

describe("tag counts follow the chosen folder", () => {
  it("counts tags within the chosen folder and asks again when the folder changes", async () => {
    params = new URLSearchParams({ view: "all" });
    const { rerender } = render(<NotesPage />);
    await waitFor(() => expect(getDriveTags).toHaveBeenCalledTimes(1));

    params = new URLSearchParams({ view: "all", folder: "" });
    rerender(<NotesPage />);
    await waitFor(() => expect(getDriveTags).toHaveBeenCalledTimes(2));
    params = new URLSearchParams({ view: "all", folder: "", sort: "title" });
    rerender(<NotesPage />);
    await screen.findByText("Note a");

    expect(getDriveTags.mock.calls).toEqual([
      ["d", null, "text", null],
      ["d", null, "text", ""],
    ]);
    expect(getFolderCounts).toHaveBeenCalledTimes(1);
  });

  it("lists only tags the folder carries, and the chosen tag comes off from the heading", async () => {
    getDriveTags.mockResolvedValue([{ name: "AI", count: 4 }]);
    params = new URLSearchParams({ view: "all", folder: "Inbox", tag: "ai" });
    render(<NotesPage />);
    await waitFor(() => expect(within(rail()).getAllByRole("link")).toHaveLength(5));

    expect(within(rail()).getAllByRole("link", { name: /^AI|^ai/ }).map((a) => a.textContent)).toEqual(["AI4"]);
    const remove = screen.getByRole("link", { name: "#ai knowledge.notes.removeTag" });
    expect(remove.getAttribute("href")).toBe(`${PATH}?view=all&folder=Inbox`);
  });

  it("offers taking the tag off without a folder and before the list answers, keeping sort and search", async () => {
    getDriveFiles.mockReturnValue(new Promise(() => {}));
    getDriveTags.mockResolvedValue([]);
    params = new URLSearchParams({ view: "all", tag: "AI", sort: "created", q: "kyoto" });
    render(<NotesPage />);

    const remove = await screen.findByRole("link", { name: "#AI knowledge.notes.removeTag" });
    expect(remove.getAttribute("href")).toBe(`${PATH}?view=all&sort=created&q=kyoto`);
    expect(screen.queryByText("Note a")).toBeNull();
  });

  it("moves focus to the list when the tag is taken off from the heading", async () => {
    params = new URLSearchParams({ view: "all", tag: "AI" });
    const { rerender } = render(<NotesPage />);
    await screen.findByText("Note a");
    const remove = screen.getByRole("link", { name: /^#AI/ });
    remove.focus();
    fireEvent.click(remove);

    params = new URLSearchParams({ view: "all" });
    rerender(<NotesPage />);
    const row = await screen.findByRole("link", { name: /^Note a/ });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toContainElement(row);
    expect(rail()).not.toContainElement(document.activeElement as HTMLElement);
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"])(
    "leaves focus on the tag link when it is pressed with %s",
    async (modifier) => {
      params = new URLSearchParams({ view: "all", tag: "AI" });
      render(<NotesPage />);
      await screen.findByText("Note a");
      const remove = screen.getByRole("link", { name: /^#AI/ });
      remove.focus();
      fireEvent.click(remove, { [modifier]: true });
      expect(document.activeElement).toBe(remove);
    },
  );

  it("shows the tags of the folder chosen last, even when the earlier answer arrives later", async () => {
    let answerEarlier!: (rows: { name: string; count: number }[]) => void;
    getDriveTags
      .mockReturnValueOnce(new Promise((resolve) => (answerEarlier = resolve)))
      .mockResolvedValueOnce([{ name: "Later", count: 1 }]);
    params = new URLSearchParams({ view: "all", folder: "A" });
    const { rerender } = render(<NotesPage />);
    params = new URLSearchParams({ view: "all", folder: "B" });
    rerender(<NotesPage />);
    await waitFor(() => expect(within(rail()).queryByRole("link", { name: /^Later/ })).not.toBeNull());

    answerEarlier([{ name: "Earlier", count: 9 }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(within(rail()).queryByRole("link", { name: /^Earlier/ })).toBeNull();
    expect(within(rail()).getByRole("link", { name: /^Later/ })).toBeInTheDocument();
  });
});

describe("the All notes list", () => {
  it("asks for the scope in the URL, the drive root as an exact empty path", async () => {
    params = new URLSearchParams({ view: "all", folder: "", tag: "AI", sort: "title", q: "kyoto" });
    render(<NotesPage />);
    await screen.findByText("Note a");
    expect(getDriveFiles.mock.calls).toEqual([
      ["d", { type: "text", sort: "title", order: "asc", path: "", tag: "AI", search: "kyoto", page: 1, limit: 30 }],
    ]);
  });

  it("groups by age only when sorted by update, and shows tags in place of the folder inside a folder", async () => {
    params = new URLSearchParams({ view: "all", folder: "Knowledge" });
    const { unmount } = render(<NotesPage />);
    const row = await screen.findByRole("link", { name: /^Note a/ });
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["knowledge.notes.age.today"]);
    expect(within(row).getAllByText("AI")).toHaveLength(2);
    expect(within(row).queryByText("Knowledge")).toBeNull();
    unmount();

    params = new URLSearchParams({ view: "all", sort: "created" });
    render(<NotesPage />);
    const plain = await screen.findByRole("link", { name: /^Note a/ });
    expect(screen.queryAllByRole("heading", { level: 3 })).toEqual([]);
    expect(within(plain).getAllByText("Knowledge")).toHaveLength(2);
  });

  it("searches within the scope and clears the search when the field is emptied", async () => {
    params = new URLSearchParams({ view: "all", folder: "Knowledge", q: "old" });
    render(<NotesPage />);
    const box = screen.getByRole("searchbox", { name: "knowledge.notes.findInScopeLabel" });
    expect(box).toHaveValue("old");

    fireEvent.change(box, { target: { value: " new " } });
    fireEvent.submit(box.closest("form")!);
    fireEvent.change(box, { target: { value: "  " } });
    fireEvent.submit(box.closest("form")!);
    expect(push.mock.calls).toEqual([
      [`${PATH}?view=all&folder=Knowledge&q=new`],
      [`${PATH}?view=all&folder=Knowledge`],
    ]);
  });

  it("changes the sort and the folder from their menus, keeping the rest of the scope", async () => {
    params = new URLSearchParams({ view: "all", tag: "AI" });
    render(<NotesPage />);
    await screen.findByText("Note a");

    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.sortMenu: knowledge.notes.sort.updated" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "knowledge.notes.sort.title" }));
    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.folderMenu: knowledge.notes.everyFolder" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "knowledge.notes.rootFolder" }));

    expect(push.mock.calls).toEqual([
      [`${PATH}?view=all&tag=AI&sort=title`],
      [`${PATH}?view=all&folder=&tag=AI`],
    ]);
  });

  it("names the scope above the list, and nothing when unfiltered", async () => {
    params = new URLSearchParams({ view: "all", folder: "Knowledge/AI", tag: "AI" });
    const { unmount } = render(<NotesPage />);
    await screen.findByText("Note a");
    const scopeHeading = screen
      .getAllByRole("heading", { level: 2 })
      .find((h) => !rail().contains(h))!;
    expect(scopeHeading).toHaveTextContent("Knowledge / AI#AI");
    unmount();

    params = new URLSearchParams({ view: "all" });
    render(<NotesPage />);
    await screen.findByText("Note a");
    await waitFor(() => expect(within(rail()).getAllByRole("link").length).toBeGreaterThan(0));
    expect(
      screen.queryAllByRole("heading", { level: 2 }).filter((h) => !rail().contains(h)),
    ).toEqual([]);
  });

  it("does not list a note twice when the list shifts before the next page", async () => {
    const first = Array.from({ length: 30 }, (_, i) => note(`n${i}`, "Knowledge"));
    getDriveFiles.mockResolvedValueOnce(page(first, 31)).mockResolvedValueOnce(page([note("n29", "Knowledge")], 31));
    render(<NotesPage />);
    await screen.findByText("Note n29");

    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.showMore" }));
    await waitFor(() => expect(getDriveFiles).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.getAllByRole("link", { name: /^Note n/ })).toHaveLength(30);
    expect(screen.queryByRole("button", { name: "knowledge.notes.showMore" })).toBeNull();
  });

  it("offers a way back to the Notes landing and titles the page All notes", async () => {
    render(<NotesPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("knowledge.notes.all");
    expect(screen.getByRole("link", { name: "knowledge.notes.heading" }).getAttribute("href")).toBe(PATH);
    expect(screen.queryByRole("search", { name: undefined })).not.toBeNull();
    expect(screen.queryByRole("searchbox", { name: "knowledge.notes.findLabel" })).toBeNull();
  });
});

describe("the count on the scope line", () => {
  const scopeLine = () => screen.getByRole("heading", { level: 1 }).closest("header")!.querySelector("h1 + div")!;

  it("states the total the All notes list reports, in the All notes column", async () => {
    getDriveFiles.mockReset().mockResolvedValue(page([note("a", "Knowledge")], 5));
    render(<NotesPage />);
    await waitFor(() => expect(scopeLine().textContent).toContain('count\\":5'));
    expect(screen.getByRole("heading", { level: 1 }).closest("header")!.parentElement?.getAttribute("data-page-frame")).toBe(
      "wide",
    );
  });

  it("ignores an answer for a folder the reader has already left", async () => {
    let answerA: (v: unknown) => void = () => {};
    getDriveFiles
      .mockReset()
      .mockReturnValueOnce(new Promise((r) => { answerA = r; }))
      .mockResolvedValue(page([note("b", "B")], 5));
    params = new URLSearchParams({ view: "all", folder: "A" });
    const { rerender } = render(<NotesPage />);

    params = new URLSearchParams({ view: "all", folder: "B" });
    rerender(<NotesPage />);
    await waitFor(() => expect(scopeLine().textContent).toContain('count\\":5'));

    await act(async () => {
      answerA(page([note("a", "A")], 99));
    });
    expect(scopeLine().textContent).toContain('count\\":5');
    expect(scopeLine().textContent).not.toContain("99");
  });

  it("drops the count when the reader leaves All notes for search results", async () => {
    getDriveFiles.mockReset().mockResolvedValue(page([note("a", "Knowledge")], 5));
    const { rerender } = render(<NotesPage />);
    await waitFor(() => expect(scopeLine().textContent).toContain('count\\":5'));

    params = new URLSearchParams({ q: "cats" });
    rerender(<NotesPage />);
    expect(scopeLine().textContent).toBe("d");
  });

  it("drops the landing's count when the reader moves to search results", async () => {
    params = new URLSearchParams();
    getDriveFiles.mockReset().mockResolvedValue(page([note("a", "Knowledge")], 7));
    const { rerender } = render(<NotesPage />);
    await waitFor(() => expect(scopeLine().textContent).toContain('count\\":7'));
    expect(screen.getByRole("heading", { level: 1 }).closest("header")!.parentElement?.getAttribute("data-page-frame")).toBe(
      "list",
    );

    params = new URLSearchParams({ q: "cats" });
    rerender(<NotesPage />);
    expect(scopeLine().textContent).toBe("d");
  });

  it("names the drive alone when the first page fails, and keeps the count when a later page does", async () => {
    getDriveFiles.mockReset().mockRejectedValueOnce(new Error("down"));
    const { unmount } = render(<NotesPage />);
    await screen.findByRole("button", { name: "knowledge.notes.retry" }).catch(() => null);
    await act(async () => {});
    expect(scopeLine().textContent).toBe("d");
    unmount();

    const first = Array.from({ length: 30 }, (_, i) => note(`n${i}`, "Knowledge"));
    getDriveFiles.mockReset().mockResolvedValueOnce(page(first, 31)).mockRejectedValueOnce(new Error("down"));
    render(<NotesPage />);
    await waitFor(() => expect(scopeLine().textContent).toContain('count\\":31'));
    fireEvent.click(screen.getByRole("button", { name: "knowledge.notes.showMore" }));
    await waitFor(() => expect(getDriveFiles).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(scopeLine().textContent).toContain('count\\":31');
  });
});
