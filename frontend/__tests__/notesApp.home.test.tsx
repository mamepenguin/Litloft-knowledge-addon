/**
 * SPEC-ADDON-131: Notes Home. Messages are echoed as `namespace.key` with
 * their values; core's own calls are answered by mocks of `@/lib/api`.
 */
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
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => PATH,
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

let nickname: string | null = null;
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname, setNickname: vi.fn(), clearNickname: vi.fn() }),
}));

const getDriveFiles = vi.fn();
const getDriveFilesWithFileIds = vi.fn();
const getWatchHistory = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getDriveFiles: (...a: unknown[]) => getDriveFiles(...a),
    getDriveFilesWithFileIds: (...a: unknown[]) => getDriveFilesWithFileIds(...a),
    getWatchHistory: (...a: unknown[]) => getWatchHistory(...a),
  };
});

const fetchNoteOpenings = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, fetchNoteOpenings: (...a: unknown[]) => fetchNoteOpenings(...a) };
});

const getNotesWithSources = vi.fn();
const getNoteSources = vi.fn();
vi.mock("../notesapp/sourcesApi", () => ({
  getNotesWithSources: (...a: unknown[]) => getNotesWithSources(...a),
  getNoteSources: (...a: unknown[]) => getNoteSources(...a),
}));

const Home = (await import("../notesapp/Home")).default;
type Target = import("../notesapp/useNotesTarget").NotesTarget;

const DEFAULT: Target = { status: "ready", key: "default", params: null, fileIds: null };
const LISTING = { type: "text", exclude_origin: "webclip" };

function note(id: string, over: Partial<FileItem> = {}): FileItem {
  return {
    id,
    filename: `${id}.md`,
    title: `Note ${id}`,
    drive: "d",
    folder_path: "journal",
    mime_type: "text/markdown",
    updated_at: "2026-09-14T09:00:00Z",
    ...over,
  } as FileItem;
}

function page(files: FileItem[], total = files.length) {
  return { data: files, meta: { total, page: 1, limit: files.length } };
}

function source(id: string, over: Record<string, unknown> = {}) {
  return {
    source_file_id: id,
    title: `Source ${id}`,
    filename: `${id}.mp4`,
    folder_path: "Videos/cooking",
    mime_type: "video/mp4",
    has_thumbnail: true,
    locator: { t: 754 },
    ...over,
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

/** What each request carried: the drive and its parameters. */
const asked = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map(([drive, params]) => [drive, params]);
const section = (heading: string) => screen.queryByText(heading)?.closest("section") ?? null;
const SOURCES = "knowledge.notesApp.withSources";
const CONTINUE = "knowledge.notesApp.continueWriting";
const RECENT = "knowledge.notesApp.recent";

beforeEach(() => {
  nickname = null;
  getDriveFiles.mockReset().mockResolvedValue(page([]));
  getDriveFilesWithFileIds.mockReset().mockResolvedValue(page([]));
  getWatchHistory.mockReset().mockResolvedValue([]);
  fetchNoteOpenings
    .mockReset()
    .mockImplementation(async (_d: string, ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, `opening of ${id}`])),
    );
  getNotesWithSources.mockReset().mockResolvedValue([]);
  getNoteSources.mockReset().mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SPEC-ADDON-131 Continue writing", () => {
  it("asks for no history and draws nothing without a profile", async () => {
    getDriveFiles.mockResolvedValue(page([note("r1")]));
    render(<Home drive="d" target={DEFAULT} />);
    await screen.findByText("Note r1");
    expect(getWatchHistory).not.toHaveBeenCalled();
    expect(section(CONTINUE)).toBeNull();
  });

  it("draws up to four cards of the viewer's text history, without clips, with their opening", async () => {
    nickname = "alice";
    getWatchHistory.mockResolvedValue([note("w1"), note("w2")]);
    render(<Home drive="d" target={DEFAULT} />);

    const card = await screen.findByRole("link", { name: /^Note w1/ });
    expect(getWatchHistory).toHaveBeenCalledWith("d", 4, "all", "text", { exclude_origin: "webclip" });
    expect(card.getAttribute("href")).toBe("/drive/d/journal?file=w1");
    expect(card).toHaveTextContent("opening of w1");
    expect(card).toHaveTextContent("journal");
    expect(section(CONTINUE)!.querySelectorAll("a")).toHaveLength(2);
  });

  it.each([
    ["has no rows", () => getWatchHistory.mockResolvedValue([])],
    ["fails", () => getWatchHistory.mockRejectedValue(new Error("viewer_required"))],
  ])("is not drawn when the history %s, and the other sections are", async (_, arrange) => {
    nickname = "alice";
    arrange();
    getDriveFiles.mockResolvedValue(page([note("r1")]));
    render(<Home drive="d" target={DEFAULT} />);
    await screen.findByText("Note r1");
    expect(getWatchHistory).toHaveBeenCalled();
    expect(section(CONTINUE)).toBeNull();
  });

  it("does not follow the Target", async () => {
    nickname = "alice";
    getWatchHistory.mockResolvedValue([note("w1")]);
    const target: Target = {
      status: "ready",
      key: "smart:sf1",
      params: { type: ["text"], tag: ["work"] },
      fileIds: null,
    };
    render(<Home drive="d" target={target} />);
    await screen.findByRole("link", { name: /^Note w1/ });
    expect(getWatchHistory).toHaveBeenCalledWith("d", 4, "all", "text", { exclude_origin: "webclip" });
  });

  it("draws a card only once its opening is known, and without one when the opening fails", async () => {
    nickname = "alice";
    const openings = deferred<Record<string, string>>();
    fetchNoteOpenings.mockReturnValue(openings.promise);
    getWatchHistory.mockResolvedValue([note("w1")]);
    render(<Home drive="d" target={DEFAULT} />);
    await act(async () => {});
    expect(screen.queryByRole("link", { name: /^Note w1/ })).toBeNull();

    await act(async () => openings.reject(new Error("down")));
    const card = await screen.findByRole("link", { name: /^Note w1/ });
    expect(card).not.toHaveTextContent("opening of");
  });
});

describe("SPEC-ADDON-131 Notes with sources", () => {
  it("walks the target's newest notes, keeps those with sources, and draws them in walk order", async () => {
    getNotesWithSources.mockResolvedValue(["s2", "s1"]);
    getDriveFiles.mockImplementation(async (_d: string, p: { limit?: number }) =>
      p.limit === 60 ? page([note("x"), note("s1"), note("y"), note("s2")]) : page([note("r1")]),
    );
    getNoteSources.mockResolvedValue({ s1: [source("v1")], s2: [source("v2")] });
    render(<Home drive="d" target={DEFAULT} />);

    await screen.findByText("Note s1");
    const walk = asked(getDriveFiles).filter(([, p]) => (p as { limit?: number }).limit === 60);
    expect(walk).toEqual([["d", { ...LISTING, sort: "updated_at", order: "desc", page: 1, limit: 60 }]]);
    expect(getNoteSources).toHaveBeenCalledWith("d", ["s1", "s2"]);
    const rows = within(section(SOURCES)!).getAllByRole("link");
    expect(rows.map((a) => a.textContent)).toEqual([
      expect.stringContaining("Note s1"),
      expect.stringContaining("Note s2"),
    ]);
    expect(rows[0].getAttribute("href")).toBe("/drive/d/journal?file=s1");
  });

  it("stops the walk at five candidates", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    getNotesWithSources.mockResolvedValue(ids);
    getDriveFiles.mockImplementation(async (_d: string, p: { limit?: number }) =>
      p.limit === 60 ? page(ids.map((id) => note(id)), 600) : page([note("r1")]),
    );
    getNoteSources.mockResolvedValue({});
    render(<Home drive="d" target={DEFAULT} />);

    await waitFor(() => expect(getNoteSources).toHaveBeenCalled());
    expect(getNoteSources.mock.calls[0][1]).toEqual(["a", "b", "c", "d", "e"]);
    expect(getDriveFiles.mock.calls.filter(([, p]) => (p as { limit?: number }).limit === 60)).toHaveLength(1);
  });

  it("walks at most three pages of sixty", async () => {
    getNotesWithSources.mockResolvedValue(["never"]);
    getDriveFiles.mockImplementation(async (_d: string, p: { limit?: number; page?: number }) =>
      p.limit === 60
        ? { data: Array.from({ length: 60 }, (_, i) => note(`p${p.page}-${i}`)), meta: { total: 600, page: p.page, limit: 60 } }
        : page([note("r1")]),
    );
    render(<Home drive="d" target={DEFAULT} />);

    await screen.findByText("Note r1");
    await act(async () => {});
    const walk = getDriveFiles.mock.calls.filter(([, p]) => (p as { limit?: number }).limit === 60);
    expect(walk.map(([, p]) => (p as { page: number }).page)).toEqual([1, 2, 3]);
    expect(getNoteSources).not.toHaveBeenCalled();
    expect(section(SOURCES)).toBeNull();
  });

  it("stops at the last page of a short listing", async () => {
    getNotesWithSources.mockResolvedValue(["never"]);
    getDriveFiles.mockImplementation(async (_d: string, p: { limit?: number }) =>
      p.limit === 60 ? page([note("a"), note("b")], 2) : page([note("r1")]),
    );
    render(<Home drive="d" target={DEFAULT} />);
    await screen.findByText("Note r1");
    await act(async () => {});
    expect(getDriveFiles.mock.calls.filter(([, p]) => (p as { limit?: number }).limit === 60)).toHaveLength(1);
  });

  it("asks for no walk when no note has a source", async () => {
    getNotesWithSources.mockResolvedValue([]);
    getDriveFiles.mockResolvedValue(page([note("r1")]));
    render(<Home drive="d" target={DEFAULT} />);
    await screen.findByText("Note r1");
    expect(getDriveFiles.mock.calls.filter(([, p]) => (p as { limit?: number }).limit === 60)).toHaveLength(0);
    expect(section(SOURCES)).toBeNull();
  });

  it("drops a candidate the answer gives no source, and draws nothing when none is left", async () => {
    getNotesWithSources.mockResolvedValue(["s1", "s2"]);
    getDriveFiles.mockImplementation(async (_d: string, p: { limit?: number }) =>
      p.limit === 60 ? page([note("s1"), note("s2")]) : page([note("r1")]),
    );
    getNoteSources.mockResolvedValue({ s1: [], s2: [source("v2")] });
    const { unmount } = render(<Home drive="d" target={DEFAULT} />);
    await screen.findByText("Note s2");
    expect(within(section(SOURCES)!).queryByText("Note s1")).toBeNull();
    unmount();

    getNoteSources.mockResolvedValue({ s1: [], s2: [] });
    render(<Home drive="d" target={DEFAULT} />);
    await screen.findByText("Note r1");
    await act(async () => {});
    expect(section(SOURCES)).toBeNull();
  });

  it.each([
    ["with-sources", () => getNotesWithSources.mockRejectedValue(new Error("503"))],
    ["the walk", () => getDriveFiles.mockImplementation(async (_d: string, p: { limit?: number }) => {
      if (p.limit === 60) throw new Error("down");
      return page([note("r1")]);
    })],
    ["notes/sources", () => getNoteSources.mockRejectedValue(new Error("503"))],
  ])("is not drawn when %s fails, and the other sections are", async (_, arrange) => {
    nickname = "alice";
    getWatchHistory.mockResolvedValue([note("w1")]);
    getNotesWithSources.mockResolvedValue(["s1"]);
    getDriveFiles.mockImplementation(async (_d: string, p: { limit?: number }) =>
      p.limit === 60 ? page([note("s1")]) : page([note("r1")]),
    );
    getNoteSources.mockResolvedValue({ s1: [source("v1")] });
    arrange();
    render(<Home drive="d" target={DEFAULT} />);

    await screen.findByText("Note r1");
    await screen.findByRole("link", { name: /^Note w1/ });
    await act(async () => {});
    expect(section(SOURCES)).toBeNull();
  });

  describe("a row", () => {
    async function drawn(sources: Record<string, unknown[]>, note1 = note("s1")) {
      getNotesWithSources.mockResolvedValue(["s1"]);
      getDriveFiles.mockImplementation(async (_d: string, p: { limit?: number }) =>
        p.limit === 60 ? page([note1]) : page([note("r1")]),
      );
      getNoteSources.mockResolvedValue(sources);
      render(<Home drive="d" target={DEFAULT} />);
      await screen.findByText(note1.title!);
      return within(section(SOURCES)!);
    }

    it.each([
      ["under an hour as m:ss", { t: 754 }, "12:34"],
      ["an hour and over as h:mm:ss", { t: 3725 }, "1:02:05"],
      ["a second as m:ss", { t: 5 }, "0:05"],
      ["a page as the page label", { page: 64 }, 'knowledge.notesApp.badgePage{"n":64}'],
    ])("writes a locator %s on the badge and in the source line", async (_, locator, text) => {
      const row = await drawn({ s1: [source("v1", { locator })] });
      expect(row.getByTestId("locator-badge")).toHaveTextContent(text);
      expect(row.getByTestId("source-line").textContent).toBe(`Videos/cooking · ${text}`);
    });

    it("has no badge, and the folder alone as its source line, when the source has no position", async () => {
      const row = await drawn({ s1: [source("v1", { locator: null })] });
      expect(row.queryByTestId("locator-badge")).toBeNull();
      expect(row.getByTestId("source-line").textContent).toBe("Videos/cooking");
    });

    it("names the root as the drive root", async () => {
      const row = await drawn({ s1: [source("v1", { folder_path: "", locator: null })] });
      expect(row.getByTestId("source-line").textContent).toBe("knowledge.notesApp.rootFolder");
    });

    it("draws the first source's thumbnail when it has one, and the first source only", async () => {
      const row = await drawn({ s1: [source("v1"), source("v2")] });
      const img = row.getByRole("link").querySelector("img")!;
      expect(img.getAttribute("src")).toBe("/api/files/v1/thumbnail");
      expect(row.getAllByTestId("locator-badge")).toHaveLength(1);
    });

    it("draws the icon of the source's kind when it has no thumbnail", async () => {
      const row = await drawn({ s1: [source("v1", { has_thumbnail: false, mime_type: "application/pdf" })] });
      expect(row.getByRole("link").querySelector("img")).toBeNull();
      expect(row.getByRole("link").querySelector("svg")).not.toBeNull();
    });

    it("shows the note's title, its opening and its date", async () => {
      const row = await drawn({ s1: [source("v1")] });
      expect(row.getByText("Note s1")).toBeInTheDocument();
      expect(row.getByTestId("note-excerpt")).toHaveTextContent("opening of s1");
      expect(row.getByRole("link")).toHaveTextContent(/Sep 14|2026/);
    });

    it("is drawn without an opening when the opening fails", async () => {
      fetchNoteOpenings.mockRejectedValue(new Error("down"));
      const row = await drawn({ s1: [source("v1")] });
      expect(row.getByText("Note s1")).toBeInTheDocument();
      expect(row.queryByTestId("note-excerpt")).toBeNull();
    });
  });

  it("sends a member target's ids through the query route, for the walk too", async () => {
    getNotesWithSources.mockResolvedValue(["s1"]);
    getDriveFilesWithFileIds.mockImplementation(async (_d: string, p: { limit?: number }) =>
      p.limit === 60 ? page([note("s1")]) : page([note("r1")]),
    );
    getNoteSources.mockResolvedValue({ s1: [source("v1")] });
    const target: Target = { status: "ready", key: "member:sf1:2", params: null, fileIds: ["s1", "r1"] };
    render(<Home drive="d" target={target} />);
    await screen.findByText("Note s1");
    expect(getDriveFiles).not.toHaveBeenCalled();
    for (const [, , ids] of getDriveFilesWithFileIds.mock.calls) expect(ids).toEqual(["s1", "r1"]);
  });

  it("walks again for a changed Target, without showing the previous target's rows", async () => {
    getNotesWithSources.mockResolvedValue(["s1", "t1"]);
    const second = deferred<ReturnType<typeof page>>();
    getDriveFiles.mockImplementation(async (_d: string, p: { limit?: number; tag?: string[] }) => {
      if (p.limit !== 60) return page([note("r1")]);
      return p.tag ? second.promise : page([note("s1")]);
    });
    getNoteSources.mockImplementation(async (_d: string, ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, [source("v")]])),
    );
    const { rerender } = render(<Home drive="d" target={DEFAULT} />);
    await screen.findByText("Note s1");

    rerender(
      <Home drive="d" target={{ status: "ready", key: "smart:sf", params: { type: ["text"], tag: ["x"] }, fileIds: null }} />,
    );
    await act(async () => {});
    expect(screen.queryByText("Note s1")).toBeNull();
    await act(async () => second.resolve(page([note("t1")])));
    await screen.findByText("Note t1");
  });
});

describe("SPEC-ADDON-131 Recently updated", () => {
  it("asks for the five newest text notes of the target, without clips", async () => {
    getDriveFiles.mockResolvedValue(page([note("r1"), note("r2", { folder_path: "" })], 12));
    render(<Home drive="d" target={DEFAULT} />);
    await screen.findByText("Note r1");

    expect(asked(getDriveFiles)).toContainEqual([
      "d",
      { ...LISTING, sort: "updated_at", order: "desc", limit: 5 },
    ]);
    const rows = within(section(RECENT)!);
    expect(rows.getByRole("link", { name: /Note r1/ }).getAttribute("href")).toBe("/drive/d/journal?file=r1");
    expect(rows.getByRole("link", { name: /Note r2/ }).getAttribute("href")).toBe("/drive/d?file=r2");
    expect(rows.getAllByText("journal").length).toBeGreaterThan(0);
    expect(rows.getAllByTestId("note-excerpt")[0]).toHaveTextContent("opening of r1");
    expect(rows.queryAllByRole("heading", { level: 3 })).toEqual([]);
  });

  it("applies the target's conditions", async () => {
    const target: Target = {
      status: "ready",
      key: "collection:c1",
      params: { type: ["text"], collection: ["Reading list"] },
      fileIds: null,
    };
    getDriveFiles.mockResolvedValue(page([note("r1")]));
    render(<Home drive="d" target={target} />);
    await screen.findByText("Note r1");
    expect(asked(getDriveFiles)).toContainEqual([
      "d",
      { collection: ["Reading list"], type: "text", exclude_origin: "webclip", sort: "updated_at", order: "desc", limit: 5 },
    ]);
  });

  it("links to the Library", async () => {
    getDriveFiles.mockResolvedValue(page([note("r1")]));
    render(<Home drive="d" target={DEFAULT} />);
    await screen.findByText("Note r1");
    expect(screen.getByRole("link", { name: "knowledge.notesApp.seeInLibrary" }).getAttribute("href")).toBe(
      `${PATH}?view=all&sort=updated`,
    );
  });

  it("puts a Try again button where its rows go, and asks again when it is pressed", async () => {
    getDriveFiles.mockRejectedValueOnce(new Error("down")).mockResolvedValue(page([note("r1")]));
    render(<Home drive="d" target={DEFAULT} />);

    const retry = await screen.findByRole("button", { name: "knowledge.notesApp.retry" });
    expect(section(RECENT)!.contains(retry)).toBe(true);
    expect(screen.queryByRole("link", { name: "knowledge.notesApp.seeInLibrary" })).toBeNull();
    fireEvent.click(retry);
    await screen.findByText("Note r1");
    expect(screen.queryByRole("button", { name: "knowledge.notesApp.retry" })).toBeNull();
  });

  it("draws skeleton rows, not a 0, while it loads", async () => {
    getDriveFiles.mockReturnValue(new Promise(() => {}));
    render(<Home drive="d" target={DEFAULT} />);
    await act(async () => {});
    expect(within(section(RECENT)!).getByTestId("skeleton")).toBeInTheDocument();
  });

  it("asks nothing while the target is being looked up", async () => {
    nickname = "alice";
    render(<Home drive="d" target={{ status: "lookingUp" }} />);
    await act(async () => {});
    expect(getDriveFiles).not.toHaveBeenCalled();
  });

  it("draws a row only once its opening is answered", async () => {
    const openings = deferred<Record<string, string>>();
    fetchNoteOpenings.mockReturnValue(openings.promise);
    getDriveFiles.mockResolvedValue(page([note("r1")]));
    render(<Home drive="d" target={DEFAULT} />);
    await act(async () => {});
    expect(screen.queryByText("Note r1")).toBeNull();
    expect(within(section(RECENT)!).getByTestId("skeleton")).toBeInTheDocument();
    await act(async () => openings.resolve({ r1: "text" }));
    expect(await screen.findByText("Note r1")).toBeInTheDocument();
  });

  it("dates a row as today's time until midnight, and as a date after it, with no reload", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 8, 14, 23, 50));
    getDriveFiles.mockResolvedValue(page([note("r1", { updated_at: new Date(2026, 8, 14, 23, 30).toISOString() })]));
    render(<Home drive="d" target={DEFAULT} />);
    await act(async () => {});
    const row = () => within(section(RECENT)!).getByRole("link", { name: /^Note r1/ });
    expect(row()).toHaveTextContent(/23:30$/);

    await act(async () => {
      vi.advanceTimersByTime(11 * 60_000);
    });
    expect(row()).not.toHaveTextContent(/23:30$/);
  });
});

describe("SPEC-ADDON-131 the sections together", () => {
  it("lays out Continue writing, Notes with sources, then Recently updated", async () => {
    nickname = "alice";
    getWatchHistory.mockResolvedValue([note("w1")]);
    getNotesWithSources.mockResolvedValue(["s1"]);
    getDriveFiles.mockImplementation(async (_d: string, p: { limit?: number }) =>
      p.limit === 60 ? page([note("s1")]) : page([note("r1")]),
    );
    getNoteSources.mockResolvedValue({ s1: [source("v1")] });
    render(<Home drive="d" target={DEFAULT} />);
    await screen.findByText("Note s1");
    await screen.findByRole("link", { name: /^Note w1/ });
    await screen.findByText("Note r1");

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([CONTINUE, SOURCES, RECENT]);
  });
});
