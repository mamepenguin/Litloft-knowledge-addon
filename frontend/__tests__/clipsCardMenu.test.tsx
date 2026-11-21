/**
 * SPEC-ADDON-164: the file menu on the Clips cards and rows — Home's shelves
 * and its Unverified rows, the Library's shelves and grid, the shelf pages —
 * and what each menu action does to the lists the page holds. Invariant ids
 * are those of docs/specs/app-card-menu.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import {
  CLIPS,
  NOT_CLIPS,
  captureHistory,
  clips,
  emit,
  fileItem,
  installClipsServer,
  isNewShelf,
  isTagShelves,
  isUnreadShelf,
  isUnverifiedShelf,
  isWatchHistory,
  nav,
  profile,
  reachEnd,
  resetSocket,
  setNickname,
  setViewport,
  settle,
  type Call,
  type Clip,
  type Server,
} from "./clipsAppHarness";
import {
  FILE_ROWS,
  HISTORY_ROWS,
  choose,
  closeMenu,
  deferredResponse,
  failWith,
  isReread,
  press,
  release,
  resetToast,
  rightClick,
  rows,
  submit,
  toasted,
  writeLog,
  writeRoutes,
  writes,
  type WriteControl,
} from "./cardMenuHarness";

vi.mock("next-intl", async () => (await import("./clipsAppHarness")).intlModule());
vi.mock("next/navigation", async () => (await import("./clipsAppHarness")).navigationModule);
vi.mock("next/link", async () => {
  const { router: r } = await import("./clipsAppHarness");
  return {
    default: ({ href, onClick, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
      <a
        href={String(href)}
        {...rest}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          onClick?.(e);
          if (!e.defaultPrevented) {
            e.preventDefault();
            r.push(String(href));
          }
        }}
      >
        {children}
      </a>
    ),
  };
});
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => "d" }));
vi.mock("@/components/ProfileProvider", async () => (await import("./clipsAppHarness")).profileModule);
vi.mock("@/hooks/useWebSocket", async () => (await import("./clipsAppHarness")).socketModule);
vi.mock("@/components/appshell/useNearEnd", async () => (await import("./clipsAppHarness")).nearEndModule());
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => ({ enabled: true, isLoading: false }) }));
vi.mock("@/components/FolderPicker", () => ({
  FolderPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="folder" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
const sidebar = vi.hoisted(() => ({ overlay: vi.fn() }));
vi.mock("@/components/SidebarProvider", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/SidebarProvider");
  return { ...actual, useOverlaySidebar: (...a: unknown[]) => sidebar.overlay(...a) };
});
vi.mock("@/components/RenameDialog", async () => (await import("./cardMenuHarness")).renameDialogModule);
vi.mock("@/components/MoveDialog", async () => (await import("./cardMenuHarness")).moveDialogModule);
vi.mock("@/components/ConfirmDialog", async () => (await import("./cardMenuHarness")).confirmDialogModule);
vi.mock("@/components/CollectionPicker", async () => (await import("./cardMenuHarness")).collectionPickerModule);
vi.mock("@/components/ClipboardProvider", async () => (await import("./cardMenuHarness")).clipboardModule);
vi.mock("@/components/ToastProvider", async () => (await import("./cardMenuHarness")).toastModule());

const Page = (await import("../pages/clips")).default;

const LIBRARY = `${CLIPS}?view=all`;
const unverified = (n: number) =>
  clips(n, "v", { trust: "unverified" }).map((c, i) => ({ ...c, created: `2026-10-${String(28 - i).padStart(2, "0")}T00:00:00Z` }));

let server: Server;
let control: WriteControl;

function serve(files: Clip[], extra: Parameters<typeof installClipsServer>[0] = {}) {
  server = installClipsServer({ files, ...extra });
  control = { hold: {} };
  const routes = writeRoutes<Clip>(
    {
      find: (id) => server.files.find((c) => c.id === id),
      rename: (id, filename) => {
        server.files = server.files.map((c) => (c.id === id ? { ...c, filename, title: filename.replace(/\.md$/, "") } : c));
      },
      move: (id, folder) => {
        server.files = server.files.map((c) => (c.id === id ? { ...c, folder } : c));
      },
      trash: (id) => {
        server.files = server.files.filter((c) => c.id !== id);
        server.history = server.history.filter((x) => x !== id);
      },
      forget: (id) => {
        server.history = server.history.filter((x) => x !== id);
      },
      item: fileItem,
    },
    control,
  );
  server.override = (c) => routes(c);
  return server;
}

function home() {
  serve([...clips(3), ...unverified(2), ...NOT_CLIPS], { history: ["c3", "v1"] });
  render(<Page />);
}

const TITLE = /^([A-Z] clip \d+|Renamed)$/;
const heading = (name: string) => screen.queryByRole("heading", { level: 2, name });
const shelf = (name: string): HTMLElement | null => {
  const h = heading(name);
  return h ? ((h.closest("section") ?? h.parentElement!.parentElement!) as HTMLElement) : null;
};
const titles = (name: string) => {
  const s = shelf(name);
  return s ? within(s).queryAllByText(TITLE).map((e) => e.textContent) : [];
};
const card = (name: string, title: string) => within(shelf(name)!).getByText(title);
const drawn = () => screen.queryAllByText(TITLE).map((e) => e.textContent);

const UNREAD = "Unread";
const RECENT = "Recently opened";
const UNVERIFIED = "Unverified";

/** Requests that load a list. None is sent when a card leaves or is redrawn. */
const listLoads = (calls: Call[]) =>
  calls.filter((c) => isUnreadShelf(c) || isUnverifiedShelf(c) || isWatchHistory(c) || isNewShelf(c) || isTagShelves(c));

async function homeLoaded() {
  await waitFor(() => expect(titles(UNREAD)).toEqual(["C clip 1", "C clip 2", "V clip 2"]));
  await waitFor(() => expect(titles(RECENT)).toEqual(["C clip 3", "V clip 1"]));
  await waitFor(() => expect(titles(UNVERIFIED)).toEqual(["V clip 1", "V clip 2"]));
  expect(within(shelf(UNREAD)!).getByText("3")).toBeInTheDocument();
}

beforeEach(() => {
  localStorage.clear();
  nav.set(CLIPS);
  profile.nickname = "alice";
  resetSocket();
  resetToast();
  sidebar.overlay.mockClear();
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SPEC-ADDON-164 I1: opening the menu on Clips Home", () => {
  it("SPEC-ADDON-164 I1 a Recently opened card offers the file rows and Remove from history, never Remove from Continue, instead of the browser's menu, and sends no request", async () => {
    home();
    await homeLoaded();
    const before = server.calls.length;

    expect(await rightClick(card(RECENT, "C clip 3"))).toBe(false);

    expect(rows()).toEqual(HISTORY_ROWS);
    expect(rows()).not.toContain("Remove from Continue");
    expect(server.calls.length).toBe(before);
  });

  it.each([
    [UNREAD, "C clip 1"],
    [UNVERIFIED, "V clip 2"],
  ])("SPEC-ADDON-164 I1 a %s card offers the file rows without history rows", async (name, title) => {
    home();
    await homeLoaded();

    expect(await rightClick(card(name, title))).toBe(false);

    expect(rows()).toEqual(FILE_ROWS);
  });

  it("SPEC-ADDON-164 I1 Mark as verified, a shelf heading and See all do not open the file menu", async () => {
    home();
    await homeLoaded();
    await rightClick(card(UNVERIFIED, "V clip 1"));
    expect(rows()).toEqual(FILE_ROWS);
    await closeMenu();
    await waitFor(() => expect(rows()).toEqual([]));

    await rightClick(within(shelf(UNVERIFIED)!).getAllByRole("button", { name: "Mark as verified" })[0]);
    await rightClick(heading(UNREAD)!);
    await rightClick(within(shelf(UNREAD)!).getAllByRole("link").find((a) => /See all/.test(a.textContent ?? ""))!);

    expect(rows()).toEqual([]);
  });

  it("SPEC-ADDON-164 I1 without a profile New clips and Unverified cards offer the file rows and no history row", async () => {
    profile.nickname = null;
    serve([...clips(3), ...unverified(1), ...NOT_CLIPS]);
    render(<Page />);
    await waitFor(() => expect(titles("New clips").length).toBeGreaterThan(0));
    await waitFor(() => expect(titles(UNVERIFIED)).toEqual(["V clip 1"]));

    await rightClick(card("New clips", "C clip 1"));
    expect(rows()).toEqual(FILE_ROWS);
    await closeMenu();
    await rightClick(card(UNVERIFIED, "V clip 1"));
    expect(rows()).toEqual(FILE_ROWS);
  });

  it("SPEC-ADDON-164 I1 a right-click on another card moves the one menu there, and its rows act on that card's clip", async () => {
    home();
    await homeLoaded();

    await rightClick(card(UNREAD, "C clip 1"));
    await rightClick(card(UNREAD, "C clip 2"));

    expect(rows()).toEqual(FILE_ROWS);
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(writeLog(server.calls)).toEqual(["trash:c2"]));
  });
});

describe("SPEC-ADDON-164 I1: the target of the menu on Clips Home", () => {
  it("SPEC-ADDON-164 I1 an Unverified row's cover opens the menu for that row's clip", async () => {
    serve([...clips(3), ...unverified(2), ...NOT_CLIPS], {
      history: ["c3", "v1"],
      covers: { v2: { image_id: "imgv2", image_url: null, site: "site.example" } },
    });
    render(<Page />);
    await homeLoaded();
    const cover = await waitFor(() => {
      const img = [...shelf(UNVERIFIED)!.querySelectorAll("img")].find((i) => i.getAttribute("src") === "/api/files/imgv2/thumbnail");
      if (!img) throw new Error("no cover yet");
      return img;
    });

    expect(await rightClick(cover)).toBe(false);
    expect(rows()).toEqual(FILE_ROWS);
    await choose("Move to Trash");
    await submit("submit-trash");

    await waitFor(() => expect(writeLog(server.calls)).toEqual(["trash:v2"]));
  });

  it("SPEC-ADDON-164 I1 Open in new tab opens the card's own link", async () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    home();
    await homeLoaded();
    const href = card(UNREAD, "C clip 2").closest("a")!.getAttribute("href");

    await rightClick(card(UNREAD, "C clip 2"));
    await choose("Open in new tab");

    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0][0]).toBe(href);
    expect(opened.mock.calls[0][1]).toBe("_blank");
  });

  it("SPEC-ADDON-164 I6 a rename dialog stays open when its row leaves the list, and completes against its clip", async () => {
    home();
    await homeLoaded();

    await rightClick(card(UNVERIFIED, "V clip 1"));
    await choose("Rename");
    expect(screen.getByText("submit-rename")).toBeInTheDocument();
    fireEvent.click(within(shelf(UNVERIFIED)!).getAllByRole("button", { name: "Mark as verified" })[0]);
    await waitFor(() => expect(titles(UNVERIFIED)).toEqual(["V clip 2"]));
    await submit("submit-rename");

    await waitFor(() => expect(writeLog(server.calls)).toEqual(["rename:v1", "reread:v1"]));
    await waitFor(() => expect(titles(RECENT)).toEqual(["C clip 3", "Renamed"]));
  });
});

describe("SPEC-ADDON-164 I2: the long press on Clips Home", () => {
  it("SPEC-ADDON-164 I2 a 500 ms press on a shelf card opens the menu and its click opens nothing; a moved press and a short tap behave as before", async () => {
    home();
    await homeLoaded();
    const target = card(UNREAD, "C clip 2");
    const navigations = nav.log.length;

    await press(target, 500);
    expect(rows()).toEqual(FILE_ROWS);
    await release(target);
    expect(nav.log.length).toBe(navigations);
    await closeMenu();
    await waitFor(() => expect(rows()).toEqual([]));

    await press(target, 600, 40);
    expect(rows()).toEqual([]);
    await release(target);

    const tap = card(UNREAD, "C clip 1");
    const beforeTap = nav.log.length;
    await press(tap, 100);
    expect(rows()).toEqual([]);
    await release(tap);
    expect(nav.log.length).toBeGreaterThan(beforeTap);
  });
});

describe("SPEC-ADDON-164 I3: clips leave Home's shelves in place", () => {
  it("SPEC-ADDON-164 I3 a trashed clip leaves every shelf that holds it, Unread's count drops by one, and no shelf is asked again", async () => {
    home();
    await homeLoaded();
    const before = server.calls.length;

    await rightClick(card(UNREAD, "V clip 2"));
    await choose("Move to Trash");
    await submit("submit-trash");

    await waitFor(() => expect(titles(UNREAD)).toEqual(["C clip 1", "C clip 2"]));
    expect(titles(UNVERIFIED)).toEqual(["V clip 1"]);
    expect(titles(RECENT)).toEqual(["C clip 3", "V clip 1"]);
    expect(within(shelf(UNREAD)!).getByText("2")).toBeInTheDocument();
    expect(within(shelf(UNREAD)!).queryByText("3")).toBeNull();
    expect(writeLog(server.calls)).toEqual(["trash:v2"]);
    expect(listLoads(server.calls.slice(before))).toEqual([]);
  });

  it("SPEC-ADDON-164 I3 after a trash, a refresh for a new clip draws Unread's count from the server alone", async () => {
    home();
    await homeLoaded();

    await rightClick(card(UNREAD, "V clip 2"));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(titles(UNREAD)).toEqual(["C clip 1", "C clip 2"]));

    server.files = [...clips(1, "n", { created: "2026-11-20T00:00:00Z" }), ...server.files];
    emit("knowledge.clip.ready", { file_id: "n1", job_id: 1 });

    await waitFor(() => expect(titles(UNREAD)).toEqual(["N clip 1", "C clip 1", "C clip 2"]));
    expect(within(shelf(UNREAD)!).getByText("3")).toBeInTheDocument();
    expect(within(shelf(UNREAD)!).queryByText("2")).toBeNull();
  });

  it("SPEC-ADDON-164 I3 I10 Remove from history takes the card out of Recently opened alone, through DELETE progress only", async () => {
    home();
    await homeLoaded();

    await rightClick(card(RECENT, "V clip 1"));
    await choose("Remove from history");

    await waitFor(() => expect(titles(RECENT)).toEqual(["C clip 3"]));
    expect(titles(UNVERIFIED)).toEqual(["V clip 1", "V clip 2"]);
    expect(titles(UNREAD)).toEqual(["C clip 1", "C clip 2", "V clip 2"]);
    expect(within(shelf(UNREAD)!).getByText("3")).toBeInTheDocument();
    expect(writeLog(server.calls)).toEqual(["history:v1"]);
  });

  it("SPEC-ADDON-164 I3 when the last Recently opened card leaves, the shelf goes", async () => {
    serve([...clips(3), ...NOT_CLIPS], { history: ["c3"] });
    render(<Page />);
    await waitFor(() => expect(titles(RECENT)).toEqual(["C clip 3"]));

    await rightClick(card(RECENT, "C clip 3"));
    await choose("Remove from history");

    await waitFor(() => expect(heading(RECENT)).toBeNull());
    expect(titles(UNREAD)).toEqual(["C clip 1", "C clip 2"]);
  });

  it("SPEC-ADDON-164 I3 a clip trashed on Home is not drawn again after Library and back", async () => {
    home();
    await homeLoaded();

    await rightClick(card(UNREAD, "C clip 1"));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(titles(UNREAD)).toEqual(["C clip 2", "V clip 2"]));

    fireEvent.click(screen.getByRole("link", { name: "Library" }));
    await waitFor(() => expect(nav.params.get("view")).toBe("all"));
    await act(() => settle());
    fireEvent.click(screen.getByRole("link", { name: "Home" }));
    await waitFor(() => expect(heading(UNREAD)).not.toBeNull());
    await act(() => settle(100));

    expect(screen.queryByText("C clip 1")).toBeNull();
  });
});

describe("SPEC-ADDON-164 I5 I6: rename, and failures, on Clips Home", () => {
  it("SPEC-ADDON-164 I5 after a rename the clip is read again by id alone and each of its cards redraws at its position", async () => {
    home();
    await homeLoaded();

    await rightClick(card(UNVERIFIED, "V clip 1"));
    await choose("Rename");
    await submit("submit-rename");

    await waitFor(() => expect(titles(RECENT)).toEqual(["C clip 3", "Renamed"]));
    expect(titles(UNVERIFIED)).toEqual(["Renamed", "V clip 2"]);
    const reread = server.calls.filter(isReread);
    expect(reread).toHaveLength(1);
    expect([...reread[0].url.searchParams.entries()]).toEqual([["by", "all"], ["ids", "v1"]]);
    expect(writeLog(server.calls)).toEqual(["rename:v1", "reread:v1"]);
  });

  it("SPEC-ADDON-164 I5 when two re-reads overlap only the answer to the later one is drawn", async () => {
    home();
    await homeLoaded();
    const held = [deferredResponse(), deferredResponse()];
    let n = 0;
    control.hold.reread = () => held[n++].promise;
    const answerAs = (title: string) =>
      new Response(
        JSON.stringify({
          by: "all", base: "", total_shelves: 1,
          shelves: [{ key: "all", label: "", count: 1, items: [fileItem({ ...server.files.find((c) => c.id === "c1")!, title, filename: `${title}.md` })] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    for (const _ of [0, 1]) {
      await rightClick(card(UNREAD, titles(UNREAD)[0]!));
      await choose("Rename");
      await submit("submit-rename");
    }
    await waitFor(() => expect(server.calls.filter(isReread)).toHaveLength(2));

    await act(async () => held[1].resolve(answerAs("Z clip 2")));
    await waitFor(() => expect(titles(UNREAD)[0]).toBe("Z clip 2"));
    await act(async () => held[0].resolve(answerAs("Z clip 1")));
    await act(() => settle());

    expect(titles(UNREAD)).toEqual(["Z clip 2", "C clip 2", "V clip 2"]);
  });

  it("SPEC-ADDON-164 I6 a failed Remove from history keeps the card, closes the menu and shows no toast", async () => {
    home();
    await homeLoaded();
    control.hold.history = failWith();

    await rightClick(card(RECENT, "C clip 3"));
    await choose("Remove from history");

    await waitFor(() => expect(writes(server.calls, "history")).toHaveLength(1));
    await waitFor(() => expect(rows()).toEqual([]));
    await act(() => settle());
    expect(titles(RECENT)).toEqual(["C clip 3", "V clip 1"]);
    expect(toasted()).toBe(0);
  });

  it.each([
    ["Rename", "submit-rename", "rename"],
    ["Move", "submit-move", "move"],
    ["Move to Trash", "submit-trash", "trash"],
  ] as const)("SPEC-ADDON-164 I6 a failed %s keeps the dialog open and changes no shelf", async (label, button, kind) => {
    home();
    await homeLoaded();
    control.hold[kind] = failWith();

    await rightClick(card(UNREAD, "C clip 1"));
    expect(rows()).toEqual(FILE_ROWS);
    await choose(label);
    await submit(button);

    await waitFor(() => expect(writes(server.calls, kind)).toHaveLength(1));
    await act(() => settle());
    expect(screen.getByText(button)).toBeInTheDocument();
    expect(titles(UNREAD)).toEqual(["C clip 1", "C clip 2", "V clip 2"]);
    expect(within(shelf(UNREAD)!).getByText("3")).toBeInTheDocument();
    expect(server.calls.filter(isReread)).toEqual([]);
  });
});

describe("SPEC-ADDON-164 I9: an answer after the profile changed", () => {
  it("SPEC-ADDON-164 I9 a trash that succeeds after the profile changed completes, and the lists loaded for the new profile keep the clip", async () => {
    home();
    await homeLoaded();
    const held = deferredResponse();
    control.hold.trash = () => held.promise;

    await rightClick(card(UNREAD, "C clip 1"));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(writes(server.calls, "trash", "c1")).toHaveLength(1));

    const loads = listLoads(server.calls).length;
    setNickname("bob");
    await waitFor(() => expect(listLoads(server.calls).length).toBeGreaterThan(loads));
    await waitFor(() => expect(titles(UNREAD)).toEqual(["C clip 1", "C clip 2", "V clip 2"]));
    await act(async () => held.resolve(new Response(null, { status: 204 })));
    await act(() => settle(100));

    expect(titles(UNREAD)).toEqual(["C clip 1", "C clip 2", "V clip 2"]);
  });
});

describe("SPEC-ADDON-164 I9: a re-read answering after the profile changed", () => {
  it("SPEC-ADDON-164 I9 a re-read that answers after the profile changed draws nothing", async () => {
    home();
    await homeLoaded();
    const held = deferredResponse();
    control.hold.reread = () => held.promise;

    await rightClick(card(UNREAD, "C clip 1"));
    await choose("Rename");
    await submit("submit-rename");
    await waitFor(() => expect(server.calls.filter(isReread)).toHaveLength(1));

    const loads = listLoads(server.calls).length;
    setNickname("bob");
    await waitFor(() => expect(listLoads(server.calls).length).toBeGreaterThan(loads));
    await waitFor(() => expect(titles(UNREAD)).toEqual(["Renamed", "C clip 2", "V clip 2"]));
    const late = fileItem({ ...server.files.find((c) => c.id === "c1")!, title: "Z clip 9", filename: "Z clip 9.md" });
    await act(async () =>
      held.resolve(
        new Response(JSON.stringify({ by: "all", base: "", total_shelves: 1, shelves: [{ key: "all", label: "", count: 1, items: [late] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await act(() => settle(100));

    expect(titles(UNREAD)).toEqual(["Renamed", "C clip 2", "V clip 2"]);
  });
});

describe("SPEC-ADDON-164 I1 I3: the Clips shelf pages", () => {
  it("SPEC-ADDON-164 I1 I3 the Recently opened page offers Remove from history, which takes the card out in place", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=recent`);
    serve([...clips(3), ...NOT_CLIPS], { history: ["c2", "c1", "c3"] });
    render(<Page />);
    await waitFor(() => expect(drawn()).toEqual(["C clip 2", "C clip 1", "C clip 3"]));
    const loads = listLoads(server.calls).length;

    expect(await rightClick(screen.getByText("C clip 1"))).toBe(false);
    expect(rows()).toEqual(HISTORY_ROWS);
    await choose("Remove from history");

    await waitFor(() => expect(drawn()).toEqual(["C clip 2", "C clip 3"]));
    expect(writeLog(server.calls)).toEqual(["history:c1"]);
    expect(listLoads(server.calls).length).toBe(loads);
  });

  it("SPEC-ADDON-164 I1 the Unread page offers the file rows without history rows", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=unread`);
    serve([...clips(3), ...NOT_CLIPS], { history: ["c3"] });
    render(<Page />);

    expect(await rightClick(await screen.findByText("C clip 2"))).toBe(false);
    expect(rows()).toEqual(FILE_ROWS);
  });

  it("SPEC-ADDON-164 I3 after a trash, a refresh for a new clip draws the Unread page's count from the server alone", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=unread`);
    serve([...clips(3), ...NOT_CLIPS]);
    render(<Page />);
    await waitFor(() => expect(drawn()).toEqual(["C clip 1", "C clip 2", "C clip 3"]));

    await rightClick(screen.getByText("C clip 2"));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(drawn()).toEqual(["C clip 1", "C clip 3"]));
    expect(screen.getByText("2")).toBeInTheDocument();

    server.files = [...clips(1, "n", { created: "2026-11-20T00:00:00Z" }), ...server.files];
    emit("knowledge.clip.ready", { file_id: "n1", job_id: 1 });

    await waitFor(() => expect(drawn()).toEqual(["N clip 1", "C clip 1", "C clip 3"]));
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("2")).toBeNull();
  });

  it("SPEC-ADDON-164 I3 the Unverified page: a row's title opens the menu, its Mark as verified does not, and a trashed row leaves", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=unverified`);
    serve([...unverified(3), ...NOT_CLIPS], { history: ["v1", "v2", "v3"] });
    render(<Page />);
    await waitFor(() => expect(drawn()).toEqual(["V clip 1", "V clip 2", "V clip 3"]));

    await rightClick(screen.getAllByRole("button", { name: "Mark as verified" })[1]);
    expect(rows()).toEqual([]);
    expect(await rightClick(screen.getByText("V clip 2"))).toBe(false);
    expect(rows()).toEqual(FILE_ROWS);
    await choose("Move to Trash");
    await submit("submit-trash");

    await waitFor(() => expect(drawn()).toEqual(["V clip 1", "V clip 3"]));
    expect(writeLog(server.calls)).toEqual(["trash:v2"]);
  });

  it("SPEC-ADDON-164 I3 a shelf page whose last clip is trashed shows its empty state", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=tag:curry`);
    serve([...clips(1, "k", { tags: ["curry"] }), ...clips(2), ...NOT_CLIPS]);
    render(<Page />);
    await waitFor(() => expect(drawn()).toEqual(["K clip 1"]));

    await rightClick(screen.getByText("K clip 1"));
    await choose("Move to Trash");
    await submit("submit-trash");

    expect(await screen.findByText("No clips here")).toBeInTheDocument();
    expect(drawn()).toEqual([]);
  });
});

describe("SPEC-ADDON-164 I4: paging after a removal", () => {
  /** After a trash and the next page, the drawn clips are a fresh load's under the same filters: none skipped, none twice. */
  async function trashThenPage(victim: string, freshTitles: () => string[]) {
    await rightClick(screen.getByText(victim));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(screen.queryByText(victim)).toBeNull());
    await reachEnd();
    await waitFor(() => expect(drawn().length).toBe(freshTitles().length));
    await act(() => settle());
    const shown = drawn();
    expect(shown).toEqual(freshTitles());
    expect(new Set(shown).size).toBe(shown.length);
  }

  it("SPEC-ADDON-164 I4 the Library's No grouping grid", async () => {
    nav.set(`${LIBRARY}&group=none`);
    serve([...clips(65), ...NOT_CLIPS]);
    render(<Page />);
    expect(await screen.findByText("C clip 60")).toBeInTheDocument();

    await trashThenPage("C clip 3", () => clips(65).filter((c) => c.id !== "c3").map((c) => c.title));
  });

  it("SPEC-ADDON-164 I4 the Library's No grouping grid under a name filter", async () => {
    nav.set(`${LIBRARY}&group=none&q=${encodeURIComponent("A clip")}`);
    serve([...clips(70, "a"), ...clips(5, "b"), ...NOT_CLIPS]);
    server.matchSearch = true;
    render(<Page />);
    expect(await screen.findByText("A clip 60")).toBeInTheDocument();
    expect(screen.queryByText("B clip 1")).toBeNull();

    await trashThenPage("A clip 3", () => clips(70, "a").filter((c) => c.id !== "a3").map((c) => c.title));
  });

  it("SPEC-ADDON-164 I4 a tag shelf page", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=tag:curry`);
    const curry = clips(65, "k", { tags: ["curry"] });
    serve([...curry, ...clips(2), ...NOT_CLIPS]);
    render(<Page />);
    expect(await screen.findByText("K clip 60")).toBeInTheDocument();

    await trashThenPage("K clip 2", () => curry.filter((c) => c.id !== "k2").map((c) => c.title));
  });
});

describe("SPEC-ADDON-164 I3: the Library's tag shelves", () => {
  it("SPEC-ADDON-164 I3 a trashed clip lowers its shelf's count by one, and a shelf whose last clip goes disappears", async () => {
    nav.set(LIBRARY);
    serve([...clips(2, "k", { tags: ["curry"] }), ...clips(1, "s", { tags: ["soup"] }), ...NOT_CLIPS]);
    render(<Page />);
    await waitFor(() => expect(titles("curry")).toEqual(["K clip 1", "K clip 2"]));
    await waitFor(() => expect(titles("soup")).toEqual(["S clip 1"]));
    expect(within(shelf("curry")!).getByText("2")).toBeInTheDocument();
    const before = server.calls.length;

    await rightClick(card("curry", "K clip 1"));
    expect(rows()).toEqual(FILE_ROWS);
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(titles("curry")).toEqual(["K clip 2"]));
    expect(within(shelf("curry")!).getByText("1")).toBeInTheDocument();

    await rightClick(card("soup", "S clip 1"));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(heading("soup")).toBeNull());

    expect(writeLog(server.calls)).toEqual(["trash:k1", "trash:s1"]);
    expect(listLoads(server.calls.slice(before))).toEqual([]);
  });
});
