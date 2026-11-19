import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { dirtyRegistry } from "@/lib/dirtyRegistry";
import { navigationGuard } from "@/lib/navigationGuard";
import type { FileItem } from "@/types";

import type { NotesTarget } from "../../notesapp/useNotesTarget";

type FlushResult = "saved" | "failed" | "conflict";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    (ns?: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns ? `${ns.replace("knowledge.", "")}.` : ""}${key}${values ? JSON.stringify(values) : ""}`,
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
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

const policy = vi.hoisted(() => ({ state: { enabled: true, isLoading: false } }));
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => policy.state }));
const plain = vi.hoisted(() => ({ state: { decided: true, plainTextDocument: false } }));
vi.mock("@/components/FileDetail/hooks/usePlainTextDocument", () => ({
  usePlainTextDocument: () => plain.state,
}));
const flag = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/featureFlags", () => ({ isInlineKnowledgeEditorEnabled: () => flag.on }));

vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: ({ source }: { source: string }) => <div data-testid="md">{source}</div>,
}));
vi.mock("@/components/TextPreview", () => ({
  TextPreview: ({ fileId }: { fileId: string }) => <div data-testid="txt">{fileId}</div>,
}));
vi.mock("../../useNoteOpenings", () => ({
  useNoteOpenings: () => ({ text: { a: "Opening of a" }, answered: new Set<string>() }),
}));

const editor = vi.hoisted(() => ({
  dirty: false,
  emptyHandle: false,
  flush: undefined as unknown as () => Promise<"saved" | "failed" | "conflict">,
  mounts: [] as string[],
}));
vi.mock("../../KnowledgeEditSection", async () => {
  const { useEffect } = await import("react");
  const { dirtyRegistry: registry } = await import("@/lib/dirtyRegistry");
  function FakeEditSection({
    fileId,
    saveHandle,
  }: {
    fileId: string;
    saveHandle?: { current: { dirty(): boolean; flush(): Promise<"saved" | "failed" | "conflict"> } | null };
  }) {
    useEffect(() => {
      editor.mounts.push(fileId);
      if (saveHandle && !editor.emptyHandle) {
        saveHandle.current = { dirty: () => editor.dirty, flush: () => editor.flush() };
      }
      return () => {
        if (saveHandle) saveHandle.current = null;
        registry.set(fileId, "knowledge-editor", false);
      };
    }, [fileId, saveHandle]);
    return <div data-testid="editor">{fileId}</div>;
  }
  return { default: FakeEditSection };
});

const getDriveFiles = vi.fn();
const getDriveFilesWithFileIds = vi.fn();
const getShelves = vi.fn();
const getShelvesWithFileIds = vi.fn();
const getFile = vi.fn();
const getFileRelations = vi.fn();
const getWikiResolutions = vi.fn();
const recordFileView = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getDriveFiles: (...a: unknown[]) => getDriveFiles(...a),
    getDriveFilesWithFileIds: (...a: unknown[]) => getDriveFilesWithFileIds(...a),
    getShelves: (...a: unknown[]) => getShelves(...a),
    getShelvesWithFileIds: (...a: unknown[]) => getShelvesWithFileIds(...a),
    getFile: (...a: unknown[]) => getFile(...a),
    getFileRelations: (...a: unknown[]) => getFileRelations(...a),
    getWikiResolutions: (...a: unknown[]) => getWikiResolutions(...a),
    recordFileView: (...a: unknown[]) => recordFileView(...a),
  };
});
const getNoteSources = vi.fn();
vi.mock("../../notesapp/sourcesApi", () => ({
  getNoteSources: (...a: unknown[]) => getNoteSources(...a),
}));

const NotesLibrary = (await import("../NotesLibrary")).default;
const { runGated } = await import("../../notesapp/changeGate");

const READY: NotesTarget = { status: "ready", key: "default", params: null, fileIds: null };

function note(id: string, over: Partial<FileItem> = {}): FileItem {
  return {
    id,
    filename: `${id}.md`,
    title: `Note ${id}`,
    drive: "d",
    folder_path: "Notes",
    mime_type: "text/markdown",
    file_size: 10,
    tags: ["t1"],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...over,
  } as FileItem;
}

const page = (files: FileItem[], total = files.length) => ({ data: files, meta: { total, page: 1, limit: 60 } });

let contentFor: (id: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;
let folderCounts: unknown;
const fetchMock = vi.fn();

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

async function mount(opts: { width?: number; query?: string; target?: NotesTarget; total?: number | null } = {}) {
  setWidth(opts.width ?? 1440);
  params = new URLSearchParams(opts.query ?? "view=all");
  const ui = (
    <NotesLibrary drive="d" target={opts.target ?? READY} total={opts.total === undefined ? 3 : opts.total} />
  );
  const view = render(ui);
  return {
    ...view,
    again: () =>
      view.rerender(
        <NotesLibrary drive="d" target={opts.target ?? READY} total={opts.total === undefined ? 3 : opts.total} />,
      ),
  };
}

beforeEach(() => {
  params = new URLSearchParams("view=all");
  for (const fn of [push, replace, getDriveFiles, getDriveFilesWithFileIds, getShelves, getShelvesWithFileIds, getFile, getFileRelations, getWikiResolutions, recordFileView, getNoteSources, fetchMock]) {
    fn.mockReset();
  }
  policy.state = { enabled: true, isLoading: false };
  plain.state = { decided: true, plainTextDocument: false };
  flag.on = true;
  editor.dirty = false;
  editor.emptyHandle = false;
  editor.mounts = [];
  editor.flush = vi.fn(async () => "saved" as const);
  folderCounts = [
    { path: "", count: 1 },
    { path: "Notes", count: 2 },
  ];
  contentFor = async (id) => ({ ok: true, text: async () => `body of ${id}` });
  getDriveFiles.mockImplementation(async () => page([note("a"), note("b"), note("c")]));
  getDriveFilesWithFileIds.mockImplementation(async () => page([]));
  getShelves.mockResolvedValue({ by: "tag", shelves: [], total_shelves: 0, base: "" });
  getFile.mockImplementation(async (id: string) => note(id));
  getFileRelations.mockResolvedValue({ relations: [] });
  getWikiResolutions.mockResolvedValue({});
  recordFileView.mockResolvedValue(undefined);
  getNoteSources.mockResolvedValue({});
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/folder-counts")) return { ok: true, json: async () => folderCounts };
    const m = /\/api\/files\/([^/]+)\/stream/.exec(url);
    if (m) return contentFor(m[1]);
    return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
  navigationGuard.reset();
  for (const entry of dirtyRegistry.list()) dirtyRegistry.set(entry.fileId, entry.source, false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const lastListParams = () => getDriveFiles.mock.calls.at(-1)?.[1] as Record<string, unknown>;

describe("SPEC-ADDON-132 Library step 1: the rail", () => {
  it("lists the folders with their counts, and All with the scope line's total", async () => {
    await mount();
    const rail = await screen.findByRole("navigation", { name: "notesLibrary.railLabel" });
    await within(rail).findByText("2");
    expect(within(rail).getByText("notesLibrary.rootFolder")).toBeInTheDocument();
    expect(within(rail).getByText("Notes")).toBeInTheDocument();
    expect(within(rail).getByText("3")).toBeInTheDocument();
    const url = fetchMock.mock.calls.find(([u]) => String(u).includes("/folder-counts"))?.[0] as string;
    const query = new URL(url, "http://x").searchParams;
    expect(query.getAll("type")).toEqual(["text"]);
    expect(query.get("exclude_origin")).toBe("webclip");
  });

  it("draws no count for All while the scope line's total is unknown", async () => {
    await mount({ total: null });
    const rail = await screen.findByRole("navigation", { name: "notesLibrary.railLabel" });
    await within(rail).findByText("Notes");
    const all = within(rail).getByText("notesLibrary.all").closest("button")!;
    expect(all.textContent).toBe("notesLibrary.all");
  });

  it("shows three skeleton entries while the counts load", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await mount();
    expect(await screen.findByTestId("rail-skeleton")).toBeInTheDocument();
  });

  it("failing counts leave All and the selected entry without counts, and a retry", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/folder-counts") ? { ok: false, status: 500, statusText: "x" } : { ok: false },
    );
    await mount({ query: "view=all&folder=Notes" });
    const rail = await screen.findByRole("navigation", { name: "notesLibrary.railLabel" });
    await within(rail).findByRole("button", { name: "notesLibrary.retry" });
    const selected = within(rail).getByText("Notes").closest("button")!;
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(selected.textContent).toBe("Notes");
    fireEvent.click(within(rail).getByRole("button", { name: "notesLibrary.retry" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/folder-counts"))).toHaveLength(2),
    );
  });

  it("the Tags segment requests tag shelves 24 at a time, one after another, without the untagged shelf", async () => {
    window.localStorage.setItem("litloft.addon.knowledge.classification.d", "tag");
    const shelves = (from: number, n: number, tail: unknown[] = []) => ({
      by: "tag",
      total_shelves: 30,
      base: "",
      shelves: [...Array.from({ length: n }, (_, i) => ({ key: `tag${from + i}`, label: `tag${from + i}`, count: 1, items: [] })), ...tail],
    });
    let inFlight = 0;
    let maxInFlight = 0;
    getShelves.mockImplementation(async (_d: string, p: { offset: number }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return p.offset === 0
        ? shelves(0, 24)
        : shelves(24, 5, [{ key: "no_tag", label: "", count: 9, items: [] }]);
    });
    await mount();
    const rail = await screen.findByRole("navigation", { name: "notesLibrary.railLabel" });
    await within(rail).findByText("tag28");
    expect(getShelves.mock.calls.map(([, p]) => [p.by, p.offset, p.shelf_limit, p.per_shelf, p.type, p.exclude_origin])).toEqual([
      ["tag", 0, 24, 1, "text", "webclip"],
      ["tag", 24, 24, 1, "text", "webclip"],
    ]);
    expect(maxInFlight).toBe(1);
    expect(within(rail).queryByText("no_tag")).toBeNull();
    expect(within(rail).getAllByRole("button")).toHaveLength(1 + 1 + 29);
  });

  it("a later tag page failing keeps the tags drawn and offers a retry", async () => {
    window.localStorage.setItem("litloft.addon.knowledge.classification.d", "tag");
    getShelves.mockImplementation(async (_d: string, p: { offset: number }) => {
      if (p.offset > 0) throw new Error("boom");
      return {
        by: "tag",
        total_shelves: 40,
        base: "",
        shelves: Array.from({ length: 24 }, (_, i) => ({ key: `tag${i}`, label: "", count: 1, items: [] })),
      };
    });
    await mount();
    const rail = await screen.findByRole("navigation", { name: "notesLibrary.railLabel" });
    await within(rail).findByRole("button", { name: "notesLibrary.retry" });
    expect(within(rail).getByText("tag23")).toBeInTheDocument();
  });

  it("stops asking for tags at 200 entries", async () => {
    window.localStorage.setItem("litloft.addon.knowledge.classification.d", "tag");
    getShelves.mockImplementation(async (_d: string, p: { offset: number }) => ({
      by: "tag",
      total_shelves: 1000,
      base: "",
      shelves: Array.from({ length: 24 }, (_, i) => ({ key: `t${p.offset + i}`, label: "", count: 1, items: [] })),
    }));
    await mount();
    const rail = await screen.findByRole("navigation", { name: "notesLibrary.railLabel" });
    await within(rail).findByText("t199");
    expect(getShelves).toHaveBeenCalledTimes(9);
    expect(within(rail).queryByText("t200")).toBeNull();
  });

  it("a member target counts through folder-counts/query and shelves/query", async () => {
    const member: NotesTarget = { status: "ready", key: "member:s:2", params: null, fileIds: ["x", "y"] };
    await mount({ target: member });
    await screen.findByText("Notes");
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/folder-counts"))!;
    expect(String(call[0])).toContain("/folder-counts/query?");
    expect(call[1]).toMatchObject({ method: "POST", body: JSON.stringify({ file_ids: ["x", "y"] }) });
    expect(getDriveFiles).not.toHaveBeenCalled();
    expect(getDriveFilesWithFileIds).toHaveBeenCalled();
    expect(getDriveFilesWithFileIds.mock.calls[0][2]).toEqual(["x", "y"]);
  });

  it("asks nothing while the target is looked up or empty", async () => {
    await mount({ target: { status: "lookingUp" } });
    expect(getDriveFiles).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    cleanup();
    await mount({ target: { status: "empty" } });
    expect(getDriveFiles).not.toHaveBeenCalled();
  });
});

describe("SPEC-ADDON-132 Library step 2: the list", () => {
  it("asks for 60 text notes, clips excluded, newest update first", async () => {
    await mount();
    await screen.findByText("Note a");
    expect(lastListParams()).toMatchObject({
      type: "text",
      exclude_origin: "webclip",
      sort: "updated_at",
      order: "desc",
      page: 1,
      limit: 60,
    });
    expect(lastListParams()).not.toHaveProperty("path");
  });

  it.each([
    ["view=all&folder=Notes", { path: "Notes" }],
    ["view=all&folder=", { path: "" }],
    ["view=all&tag=ai", { tag: ["ai"] }],
    ["view=all&q=hello&sort=title", { search: "hello", sort: "title", order: "asc" }],
    ["view=all&sort=created&clips=1", { sort: "created_at", order: "desc", exclude_origin: "webclip" }],
  ])("%s", async (query, expected) => {
    await mount({ query });
    await screen.findByText("Note a");
    expect(lastListParams()).toMatchObject({ type: "text", exclude_origin: "webclip", ...expected });
  });

  it("adds the selected tag to the target's own tags instead of replacing them", async () => {
    const target: NotesTarget = {
      status: "ready",
      key: "smart:1",
      params: { type: ["text"], tag: ["work"] },
      fileIds: null,
    };
    await mount({ query: "view=all&tag=ai", target });
    await screen.findByText("Note a");
    expect(lastListParams().tag).toEqual(["work", "ai"]);
  });

  it("names the selection in the search placeholder", async () => {
    await mount({ query: "view=all&folder=Notes" });
    expect(await screen.findByPlaceholderText('notesLibrary.searchFolder{"folder":"Notes"}')).toBeInTheDocument();
  });

  it("an empty answer shows No notes here; a failed one a retry that keeps the rows drawn", async () => {
    getDriveFiles.mockResolvedValueOnce(page([]));
    await mount({ width: 800 });
    expect(await screen.findByText("notesLibrary.noNotesHere")).toBeInTheDocument();
    cleanup();

    getDriveFiles.mockReset();
    getDriveFiles.mockResolvedValueOnce(page([note("a")], 120)).mockRejectedValueOnce(new Error("x"));
    await mount({ width: 800 });
    await screen.findByText("Note a");
    // A page that fails leaves the rows and offers a retry.
    expect(screen.queryByText("notesLibrary.loadFailed")).toBeNull();
  });

  it("a failing first page shows Try again", async () => {
    getDriveFiles.mockRejectedValue(new Error("x"));
    await mount({ width: 800 });
    expect(await screen.findByText("notesLibrary.loadFailed")).toBeInTheDocument();
    getDriveFiles.mockResolvedValue(page([note("a")]));
    fireEvent.click(screen.getByRole("button", { name: "notesLibrary.retry" }));
    expect(await screen.findByText("Note a")).toBeInTheDocument();
  });

  it("a URL naming both a folder and a tag is repaired to the tag", async () => {
    await mount({ query: "view=all&folder=Notes&tag=ai" });
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`${PATH}?view=all&tag=ai&sort=updated`));
  });
});

describe("SPEC-ADDON-132 Library step 3: choosing a note", () => {
  it("shows the first row when the URL names no note", async () => {
    await mount();
    await screen.findByTestId("md");
    expect(getFile).toHaveBeenCalledWith("a");
  });

  it("shows the note the URL names when it is among the rows, without asking", async () => {
    await mount({ query: "view=all&note=b" });
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("body of b"));
    expect(getDriveFilesWithFileIds).not.toHaveBeenCalled();
  });

  it("checks a note that is not among the rows with files/query, without the target", async () => {
    getDriveFilesWithFileIds.mockResolvedValue(page([note("z")]));
    const target: NotesTarget = { status: "ready", key: "smart:1", params: { type: ["text"], tag: ["x"] }, fileIds: null };
    await mount({ query: "view=all&note=z", target });
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("body of z"));
    const [drive, p, ids] = getDriveFilesWithFileIds.mock.calls[0];
    expect(drive).toBe("d");
    expect(ids).toEqual(["z"]);
    expect(p).toMatchObject({ type: "text", exclude_origin: "webclip" });
    expect(p).not.toHaveProperty("tag");
  });

  it("total 0 replaces note with the first row", async () => {
    getDriveFilesWithFileIds.mockResolvedValue(page([]));
    await mount({ query: "view=all&note=z" });
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`${PATH}?view=all&note=a&sort=updated`));
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("body of a"));
  });

  it("total 0 with an empty list removes note and draws no pane", async () => {
    getDriveFiles.mockResolvedValue(page([]));
    getDriveFilesWithFileIds.mockResolvedValue(page([]));
    await mount({ query: "view=all&note=z" });
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`${PATH}?view=all&sort=updated`));
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("a failing check is the pane's error with a retry, and the URL is kept", async () => {
    getDriveFilesWithFileIds.mockRejectedValueOnce(new Error("x"));
    await mount({ query: "view=all&note=z" });
    expect(await screen.findByText("notesLibrary.loadFailedNote")).toBeInTheDocument();
    expect(replace.mock.calls.every(([href]) => String(href).includes("note=z"))).toBe(true);
    getDriveFilesWithFileIds.mockResolvedValue(page([note("z")]));
    fireEvent.click(screen.getByRole("button", { name: "notesLibrary.retry" }));
    await waitFor(() => expect(screen.getByTestId("md").textContent).toBe("body of z"));
  });

  it("choosing a row sets note with a replace", async () => {
    await mount();
    await screen.findByTestId("md");
    fireEvent.click(screen.getByText("Note b"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`${PATH}?view=all&sort=updated&note=b`));
  });
});

describe("SPEC-ADDON-132 Library step 4 and I21: reading and the view record", () => {
  it("records nothing for the first row shown with no note", async () => {
    await mount();
    await screen.findByTestId("md");
    expect(recordFileView).not.toHaveBeenCalled();
  });

  it("records one empty view per note shown, and none again after Done", async () => {
    await mount({ query: "view=all&note=a" });
    await screen.findByTestId("md");
    await waitFor(() => expect(recordFileView).toHaveBeenCalledTimes(1));
    expect(recordFileView).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "notesLibrary.edit" }));
    await screen.findByTestId("editor");
    fireEvent.click(screen.getByRole("button", { name: "notesLibrary.done" }));
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    await screen.findByTestId("md");
    expect(recordFileView).toHaveBeenCalledTimes(1);
  });

  it("records the next note when another is shown", async () => {
    const { again } = await mount({ query: "view=all&note=a" });
    await screen.findByTestId("md");
    params = new URLSearchParams("view=all&note=b");
    again();
    await waitFor(() => expect(recordFileView).toHaveBeenCalledWith("b"));
    expect(recordFileView).toHaveBeenCalledTimes(2);
  });

  it("records nothing for a note whose content failed to load", async () => {
    contentFor = async () => ({ ok: false, text: async () => "" });
    await mount();
    expect(await screen.findByText("notesLibrary.loadFailedNote")).toBeInTheDocument();
    expect(recordFileView).not.toHaveBeenCalled();
  });

  it("draws the folder, the updated time and the tags read-only, and Related files and Sources", async () => {
    getFileRelations.mockResolvedValue({
      relations: [
        {
          relation_id: 1, kind: "related", direction: "outgoing", origin: null, created_at: "", created_by: null,
          file: { id: "r1", drive: "d", filename: "r1.md", title: "Related one", folder_path: "X", missing_since: null },
        },
        {
          relation_id: 2, kind: "related", direction: "outgoing", origin: null, created_at: "", created_by: null,
          file: { id: "r2", drive: "d", filename: "r2.md", title: "Gone", folder_path: "X", missing_since: "2026-01-01" },
        },
      ],
    });
    getNoteSources.mockResolvedValue({
      a: [{ source_file_id: "s1", title: "A video", filename: "v.mp4", folder_path: "Vids", mime_type: "video/mp4", has_thumbnail: false, locator: { t: 125 } }],
    });
    await mount();
    await screen.findByTestId("md");
    expect(screen.getByText("t1")).toBeInTheDocument();
    expect(await screen.findByText('notesLibrary.relatedFiles{"count":2}')).toBeInTheDocument();
    const missing = screen.getByText("Gone").closest("span[aria-disabled]");
    expect(missing).not.toBeNull();
    expect(screen.getByText("Related one").closest("a")).not.toBeNull();
    expect(await screen.findByText('notesLibrary.sources{"count":1}')).toBeInTheDocument();
    expect(screen.getByText("Vids · 2:05")).toBeInTheDocument();
    expect(screen.getByText("A video").closest("a")?.getAttribute("href")).toContain("t=125");
    expect(screen.getByText("notesLibrary.graph").closest("a")?.getAttribute("href")).toBe(
      "/drive/d/addons/knowledge/connections?focus=a",
    );
    expect(getNoteSources).toHaveBeenCalledWith("d", ["a"]);
  });

  it("failing relations or sources leave their column out and nothing else", async () => {
    getFileRelations.mockRejectedValue(new Error("x"));
    getNoteSources.mockRejectedValue(new Error("x"));
    await mount();
    await screen.findByTestId("md");
    expect(screen.queryByText("notesLibrary.connections")).toBeNull();
    expect(screen.getByTestId("md")).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-132 Library step 5 and I5, I6: when Edit is offered", () => {
  const edit = () => screen.queryByRole("button", { name: "notesLibrary.edit" });

  it("is offered for Markdown once everything is known", async () => {
    await mount();
    await screen.findByTestId("md");
    expect(edit()).not.toBeNull();
  });

  it.each([
    ["the policy is still loading", () => (policy.state = { enabled: true, isLoading: true })],
    ["the policy is disabled", () => (policy.state = { enabled: false, isLoading: false })],
    ["the inline editor flag is off", () => (flag.on = false)],
  ])("is not offered while %s", async (_name, arrange) => {
    arrange();
    await mount();
    await screen.findByTestId("md");
    expect(edit()).toBeNull();
  });

  it.each([
    ["undecided", { decided: false, plainTextDocument: false }, false],
    ["not a plain-text document", { decided: true, plainTextDocument: false }, false],
    ["a plain-text document", { decided: true, plainTextDocument: true }, true],
  ])("a text/plain file that is %s", async (_name, decision, offered) => {
    plain.state = decision;
    getFile.mockImplementation(async (id: string) => note(id, { mime_type: "text/plain", filename: `${id}.txt` }));
    await mount();
    await screen.findByTestId("txt");
    expect(edit() !== null).toBe(offered);
  });

  it("is not offered, and no editor is mounted, before the content has loaded", async () => {
    let release: (v: { ok: boolean; text: () => Promise<string> }) => void = () => {};
    contentFor = () => new Promise((resolve) => (release = resolve));
    await mount();
    await waitFor(() => expect(getFile).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/files/a/stream"))).toBe(true));
    expect(screen.getByTestId("pane-skeleton")).toBeInTheDocument();
    expect(edit()).toBeNull();
    expect(editor.mounts).toEqual([]);
    await act(async () => release({ ok: true, text: async () => "late" }));
    await screen.findByTestId("md");
    expect(edit()).not.toBeNull();
  });

  it("is not offered when the metadata fails", async () => {
    getFile.mockRejectedValue(new Error("x"));
    await mount();
    expect(await screen.findByText("notesLibrary.loadFailedNote")).toBeInTheDocument();
    expect(edit()).toBeNull();
    expect(editor.mounts).toEqual([]);
  });

  it("is not offered below 1024px, where no pane is drawn", async () => {
    await mount({ width: 800 });
    await screen.findByText("Note a");
    expect(screen.queryByRole("article")).toBeNull();
    expect(edit()).toBeNull();
  });
});

describe("SPEC-ADDON-132 Library step 9 and I6: widths", () => {
  it("below 1024px a row links to the file page, the click is not taken, note is ignored and nothing is recorded", async () => {
    await mount({ width: 800, query: "view=all&note=zzz" });
    const row = (await screen.findByText("Note b")).closest("a")!;
    expect(row.getAttribute("href")).toBe("/drive/d/Notes?file=b");
    replace.mockClear();
    let preventedByRow = true;
    document.addEventListener(
      "click",
      (e) => {
        preventedByRow = e.defaultPrevented;
        e.preventDefault();
      },
      { once: true },
    );
    fireEvent.click(row);
    expect(preventedByRow).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(getDriveFilesWithFileIds).not.toHaveBeenCalled();
    expect(recordFileView).not.toHaveBeenCalled();
    expect(getFile).not.toHaveBeenCalled();
  });

  it("from 1024px a plain row click is taken by the pane", async () => {
    await mount({ width: 1100 });
    const row = (await screen.findByText("Note b")).closest("a")!;
    expect(fireEvent.click(row)).toBe(false);
  });

  it("draws nothing that depends on the pane before the width is measured", async () => {
    const view = await mount({ width: 800 });
    expect(view.container.querySelector("[data-layout]")?.getAttribute("data-layout")).toBe("list");
  });

  it("narrowing below 1024px removes a reading pane", async () => {
    await mount({ width: 1440 });
    await screen.findByTestId("md");
    setWidth(800);
    act(() => void window.dispatchEvent(new Event("resize")));
    await waitFor(() => expect(screen.queryByTestId("md")).toBeNull());
  });

  it("narrowing keeps a mounted editor until Done, then removes it", async () => {
    await mount({ width: 1440 });
    await screen.findByTestId("md");
    fireEvent.click(screen.getByRole("button", { name: "notesLibrary.edit" }));
    await screen.findByTestId("editor");
    setWidth(800);
    act(() => void window.dispatchEvent(new Event("resize")));
    await waitFor(() => expect(document.querySelector("[data-layout]")?.getAttribute("data-layout")).toBe("list"));
    expect(screen.getByTestId("editor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "notesLibrary.done" }));
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
  });
});

async function startEditing() {
  await screen.findByTestId("md");
  fireEvent.click(screen.getByRole("button", { name: "notesLibrary.edit" }));
  await screen.findByTestId("editor");
  dirtyRegistry.set("a", "knowledge-editor", true);
  editor.dirty = true;
}

describe("SPEC-ADDON-132 Library step 7 and I4: Done and the gate", () => {
  it("Done saves, unmounts the editor, loads the note again and asks the list and rail again", async () => {
    await mount();
    await startEditing();
    const listCalls = getDriveFiles.mock.calls.length;
    const fileCalls = getFile.mock.calls.length;
    const counts = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/folder-counts")).length;
    const railCalls = counts();
    getFile.mockImplementation(async (id: string) => note(id, { title: "Renamed" }));
    fireEvent.click(screen.getByRole("button", { name: "notesLibrary.done" }));
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    expect(editor.flush).toHaveBeenCalledTimes(1);
    await screen.findByText("Renamed", { selector: "h2" });
    expect(getFile.mock.calls.length).toBeGreaterThan(fileCalls);
    expect(getNoteSources.mock.calls.length).toBeGreaterThan(1);
    expect(getFileRelations.mock.calls.length).toBeGreaterThan(1);
    await waitFor(() => expect(getDriveFiles.mock.calls.length).toBeGreaterThan(listCalls));
    await waitFor(() => expect(counts()).toBeGreaterThan(railCalls));
  });

  it("the rows already drawn stay while the list is asked again", async () => {
    await mount();
    await startEditing();
    getDriveFiles.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "notesLibrary.done" }));
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    expect(screen.getByText("Note b")).toBeInTheDocument();
    expect(screen.queryByTestId("list-skeleton")).toBeNull();
  });

  it.each(["failed", "conflict"] as const)(
    "Done with a %s save keeps the editor mounted and shows the message",
    async (result) => {
      editor.flush = vi.fn(async () => result);
      await mount();
      await startEditing();
      fireEvent.click(screen.getByRole("button", { name: "notesLibrary.done" }));
      await screen.findByText(result === "failed" ? "notesLibrary.saveFailed" : "notesLibrary.conflict");
      expect(screen.getByTestId("editor")).toBeInTheDocument();
      expect(navigationGuard.getPending()).toBeNull();
    },
  );

  it("Done with an empty handle returns to reading", async () => {
    editor.emptyHandle = true;
    await mount();
    await screen.findByTestId("md");
    fireEvent.click(screen.getByRole("button", { name: "notesLibrary.edit" }));
    await screen.findByTestId("editor");
    fireEvent.click(screen.getByRole("button", { name: "notesLibrary.done" }));
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
    expect(editor.flush).not.toHaveBeenCalled();
  });

  it("another note is shown only after the text is saved", async () => {
    let finish: (r: "saved") => void = () => {};
    editor.flush = vi.fn((): Promise<FlushResult> => new Promise((resolve) => (finish = resolve)));
    await mount();
    await startEditing();
    replace.mockClear();
    fireEvent.click(screen.getByText("Note b"));
    await waitFor(() => expect(editor.flush).toHaveBeenCalledTimes(1));
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("notesLibrary.saving")).toBeInTheDocument();
    await act(async () => finish("saved"));
    expect(replace).toHaveBeenCalledWith(`${PATH}?view=all&sort=updated&note=b`);
    expect(navigationGuard.getPending()).toBeNull();
  });

  it("while the save has not settled the pane accepts no other change and the editor takes no input", async () => {
    editor.flush = vi.fn((): Promise<FlushResult> => new Promise(() => {}));
    await mount();
    await startEditing();
    replace.mockClear();
    fireEvent.click(screen.getByText("Note b"));
    await waitFor(() => expect(editor.flush).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("Note c"));
    expect(editor.flush).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor").closest("[inert]")).not.toBeNull();
  });

  it("a failed save hands the change to the discard dialog; confirming lets it happen", async () => {
    editor.flush = vi.fn(async () => "failed" as const);
    await mount();
    await startEditing();
    replace.mockClear();
    fireEvent.click(screen.getByText("Note b"));
    await waitFor(() => expect(navigationGuard.getPending()).not.toBeNull());
    expect(replace).not.toHaveBeenCalled();
    act(() => navigationGuard.confirm());
    expect(replace).toHaveBeenCalledWith(`${PATH}?view=all&sort=updated&note=b`);
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());
  });

  it("cancelling the dialog keeps the editor mounted on the same note and changes nothing", async () => {
    editor.flush = vi.fn(async () => "conflict" as const);
    await mount();
    await startEditing();
    replace.mockClear();
    fireEvent.click(screen.getByText("Note b"));
    await waitFor(() => expect(navigationGuard.getPending()).not.toBeNull());
    act(() => navigationGuard.cancel());
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor").textContent).toBe("a");
    expect(screen.getByText("notesLibrary.conflict")).toBeInTheDocument();
  });

  it("a segment, selection, sort and search change, the file page link and the frame's changes pass through the same gate", async () => {
    await mount();
    await startEditing();
    const proceeded: string[] = [];
    editor.flush = vi.fn(async () => "saved" as const);

    fireEvent.click(screen.getByRole("button", { name: /appView\.groupBy/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "notesLibrary.tags" }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(editor.flush).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenLastCalledWith(`${PATH}?view=all&sort=updated`);
    expect(JSON.parse(window.localStorage.getItem("litloft.addon.knowledge.view.d") ?? "{}")).toEqual({
      default: { group: "tag" },
    });
    expect(window.localStorage.getItem("litloft.addon.knowledge.classification.d")).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("editor")).toBeNull());

    // A frame change (a tab, the Target) while an editor is mounted.
    await screen.findByTestId("md");
    fireEvent.click(screen.getByRole("button", { name: "notesLibrary.edit" }));
    await screen.findByTestId("editor");
    dirtyRegistry.set("a", "knowledge-editor", true);
    editor.flush = vi.fn(async () => "failed" as const);
    act(() => runGated(() => proceeded.push("frame")));
    await waitFor(() => expect(navigationGuard.getPending()).not.toBeNull());
    expect(proceeded).toEqual([]);
    act(() => navigationGuard.confirm());
    expect(proceeded).toEqual(["frame"]);
  });

  it("a sort change and a search wait for the save", async () => {
    editor.flush = vi.fn((): Promise<FlushResult> => new Promise(() => {}));
    await mount();
    await startEditing();
    fireEvent.click(screen.getByRole("button", { name: /appView\.sortBy/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "notesLibrary.sort.title" }));
    await waitFor(() => expect(editor.flush).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });

  it("a search submitted while the editor is mounted waits for the save", async () => {
    let finish: (r: "saved") => void = () => {};
    editor.flush = vi.fn((): Promise<FlushResult> => new Promise((resolve) => (finish = resolve)));
    await mount();
    await startEditing();
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(editor.flush).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
    await act(async () => finish("saved"));
    expect(push).toHaveBeenCalledWith(`${PATH}?view=all&sort=updated&q=hello`);
  });

  it("the file page link waits for the save, then navigates", async () => {
    let finish: (r: "saved") => void = () => {};
    editor.flush = vi.fn((): Promise<FlushResult> => new Promise((resolve) => (finish = resolve)));
    await mount();
    await startEditing();
    fireEvent.click(screen.getByRole("link", { name: "notesLibrary.openFile" }));
    await waitFor(() => expect(editor.flush).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
    await act(async () => finish("saved"));
    expect(push).toHaveBeenCalledWith("/drive/d/Notes?file=a");
  });

  it("outside the editor a change happens at once, with no save asked for", async () => {
    await mount();
    await screen.findByTestId("md");
    replace.mockClear();
    fireEvent.click(screen.getByText("Note b"));
    expect(replace).toHaveBeenCalledWith(`${PATH}?view=all&sort=updated&note=b`);
    expect(editor.flush).not.toHaveBeenCalled();
  });
});

describe("SPEC-ADDON-132 Library step 1: choosing a segment and an entry", () => {
  it("choosing an entry pushes its selection and drops the note", async () => {
    await mount({ query: "view=all&note=b&sort=title" });
    const rail = await screen.findByRole("navigation", { name: "notesLibrary.railLabel" });
    await within(rail).findByText("2");
    fireEvent.click(within(rail).getByText("Notes"));
    expect(push).toHaveBeenCalledWith(`${PATH}?view=all&sort=title&folder=Notes`);
    fireEvent.click(within(rail).getByText("notesLibrary.rootFolder"));
    expect(push).toHaveBeenLastCalledWith(`${PATH}?view=all&sort=title&folder=`);
  });
});
