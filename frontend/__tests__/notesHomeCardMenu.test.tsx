/**
 * SPEC-ADDON-164: the file menu on Notes Home — Continue writing, Notes with
 * sources, Recently updated — and what each menu action does to the sections
 * the page holds. Invariant ids are those of docs/specs/app-card-menu.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import type { WireCall } from "@/__tests__/helpers/wireFetch";
import {
  BASE,
  captureHistory,
  fileItem,
  installNotesServer,
  isFiles,
  isFilesQuery,
  isShelvesGet,
  isShelvesQuery,
  isSources,
  isWatchHistory,
  isWithSources,
  nav,
  router,
  setViewport,
  settle,
  type Note,
  type Server,
} from "./notesAppHarness";
import {
  FILE_ROWS,
  HISTORY_ROWS,
  choose,
  closeMenu,
  deferredResponse,
  dialogs,
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
import { json } from "@/__tests__/helpers/wireFetch";

vi.mock("next-intl", async () => (await import("./notesAppHarness")).intlModule());
vi.mock("next/navigation", async () => (await import("./notesAppHarness")).navigationModule);
vi.mock("next/link", async () => {
  const { router: r } = await import("./notesAppHarness");
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
const profile = vi.hoisted(() => ({ nickname: null as string | null }));
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname: profile.nickname, setNickname: vi.fn(), clearNickname: vi.fn() }),
}));
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => ({ enabled: true, isLoading: false }) }));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => null }));
const quickNote = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/components/quick-note", () => ({ useQuickNote: () => quickNote }));
const sidebar = vi.hoisted(() => ({ overlay: vi.fn() }));
vi.mock("@/components/SidebarProvider", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/SidebarProvider");
  return { ...actual, useOverlaySidebar: (...a: unknown[]) => sidebar.overlay(...a) };
});
vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => <div data-testid="markdown" />,
}));
vi.mock("@/components/RenameDialog", async () => (await import("./cardMenuHarness")).renameDialogModule);
vi.mock("@/components/MoveDialog", async () => (await import("./cardMenuHarness")).moveDialogModule);
vi.mock("@/components/ConfirmDialog", async () => (await import("./cardMenuHarness")).confirmDialogModule);
vi.mock("@/components/CollectionPicker", async () => (await import("./cardMenuHarness")).collectionPickerModule);
vi.mock("@/components/ClipboardProvider", async () => (await import("./cardMenuHarness")).clipboardModule);
vi.mock("@/components/ToastProvider", async () => (await import("./cardMenuHarness")).toastModule());

const Page = (await import("../Page")).default;

function notes(count: number): Note[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i + 1}`,
    title: `N note ${i + 1}`,
    folder: i % 2 ? "Journal" : "",
    updated: new Date(Date.UTC(2026, 10, 30) - i * 3_600_000).toISOString(),
  }));
}

function src(id: string) {
  return { source_file_id: id, title: `Source ${id}`, filename: `${id}.mp4`, folder_path: "Lectures", mime_type: "video/mp4", has_thumbnail: true, locator: null };
}

let server: Server;
let control: WriteControl;

function open(history = ["n2", "n1"], count = 4) {
  const all = notes(count);
  server = installNotesServer({
    notes: all,
    history: history.map((id) => all.find((n) => n.id === id)!),
    withSources: ["n1", "n3"],
    sources: { n1: [src("s1")], n3: [src("s3")] },
  });
  control = { hold: {} };
  const routes = writeRoutes<Note>(
    {
      find: (id) => server.notes.find((n) => n.id === id),
      rename: (id, filename) => {
        const title = filename.replace(/\.md$/, "");
        server.notes = server.notes.map((n) => (n.id === id ? { ...n, title } : n));
        server.history = server.history.map((n) => (n.id === id ? { ...n, title } : n));
      },
      move: (id, folder) => {
        server.notes = server.notes.map((n) => (n.id === id ? { ...n, folder } : n));
        server.history = server.history.map((n) => (n.id === id ? { ...n, folder } : n));
      },
      trash: (id) => {
        server.notes = server.notes.filter((n) => n.id !== id);
        server.history = server.history.filter((n) => n.id !== id);
        server.withSources = server.withSources.filter((x) => x !== id);
      },
      forget: (id) => {
        server.history = server.history.filter((n) => n.id !== id);
      },
      item: fileItem,
    },
    control,
  );
  server.override = (c) => routes(c);
  render(<Page />);
}

const CONTINUE = "Continue writing";
const SOURCES = "Notes with sources";
const RECENT = "Recently updated";
const TITLE = /^(N note \d+|Renamed|First|Second)$/;

const section = (heading: string): HTMLElement | null => {
  const h = screen.queryByText(heading);
  return h ? ((h.closest("section") ?? h.parentElement!.parentElement!) as HTMLElement) : null;
};
const titles = (heading: string) => {
  const s = section(heading);
  return s ? within(s).queryAllByText(TITLE).map((e) => e.textContent) : [];
};
const card = (heading: string, title: string) => within(section(heading)!).getByText(title);

/** Requests that list notes, history or sources: none is sent when a card leaves. */
const listReads = (calls: WireCall[]) =>
  calls.filter(
    (c) => isFiles(c) || isFilesQuery(c) || isWatchHistory(c) || isWithSources(c) || isSources(c) || ((isShelvesGet(c) || isShelvesQuery(c)) && !isReread(c)),
  );

async function loaded() {
  await waitFor(() => expect(titles(CONTINUE)).toEqual(["N note 2", "N note 1"]));
  await waitFor(() => expect(titles(SOURCES)).toEqual(["N note 1", "N note 3"]));
  await waitFor(() => expect(titles(RECENT)).toEqual(["N note 1", "N note 2", "N note 3", "N note 4"]));
}

beforeEach(() => {
  localStorage.clear();
  nav.set(BASE);
  router.push.mockClear();
  router.replace.mockClear();
  profile.nickname = "alice";
  dialogs.renameTo = "Renamed.md";
  dialogs.moveTo = "Elsewhere";
  resetToast();
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SPEC-ADDON-164 I1: opening the menu on Notes Home", () => {
  it("SPEC-ADDON-164 I1 a Continue writing card offers the file rows and Remove from history, never Remove from Continue, instead of the browser's menu, and sends no request", async () => {
    open();
    await loaded();
    const before = server.calls.length;

    expect(await rightClick(card(CONTINUE, "N note 1"))).toBe(false);

    expect(rows()).toEqual(HISTORY_ROWS);
    expect(rows()).not.toContain("Remove from Continue");
    expect(rows()).not.toContain("Edit");
    expect(server.calls.length).toBe(before);
  });

  it.each([SOURCES, RECENT])("SPEC-ADDON-164 I1 a %s card offers the file rows without history rows", async (heading) => {
    open();
    await loaded();

    expect(await rightClick(card(heading, "N note 1"))).toBe(false);

    expect(rows()).toEqual(FILE_ROWS);
  });

  it("SPEC-ADDON-164 I1 a press on the source thumbnail of a with-sources row targets the note, not the source", async () => {
    open();
    await loaded();
    const thumb = [...section(SOURCES)!.querySelectorAll("img")].find((i) => (i.getAttribute("src") ?? "").includes("/api/files/s1/thumbnail"))!;
    expect(thumb).toBeDefined();

    expect(await rightClick(thumb)).toBe(false);
    expect(rows()).toEqual(FILE_ROWS);
    await choose("Move to Trash");
    await submit("submit-trash");

    await waitFor(() => expect(writes(server.calls, "trash")).toHaveLength(1));
    expect(writeLog(server.calls)).toEqual(["trash:n1"]);
  });

  it("SPEC-ADDON-164 I1 Open in new tab on a with-sources row opens the note's own link", async () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    open();
    await loaded();
    const href = card(SOURCES, "N note 3").closest("a")!.getAttribute("href");
    expect(new URL(href!, "http://localhost").searchParams.get("file")).toBe("n3");

    await rightClick(card(SOURCES, "N note 3"));
    await choose("Open in new tab");

    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0][0]).toBe(href);
    expect(opened.mock.calls[0][1]).toBe("_blank");
  });

  it("SPEC-ADDON-164 I1 a right-click on another card moves the one menu there, and its rows act on that card's note", async () => {
    open();
    await loaded();

    await rightClick(card(RECENT, "N note 2"));
    await rightClick(card(RECENT, "N note 3"));

    expect(rows()).toEqual(FILE_ROWS);
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(writeLog(server.calls)).toEqual(["trash:n3"]));
  });

  it("SPEC-ADDON-164 I1 a section heading and See in Library do not open the file menu", async () => {
    open();
    await loaded();
    await rightClick(card(RECENT, "N note 1"));
    expect(rows()).toEqual(FILE_ROWS);
    await closeMenu();
    await waitFor(() => expect(rows()).toEqual([]));

    await rightClick(screen.getByText(RECENT));
    await rightClick(screen.getByText(CONTINUE));
    await rightClick(within(section(RECENT)!).getByRole("link", { name: /See in Library/ }));

    expect(rows()).toEqual([]);
  });

  it("SPEC-ADDON-164 I1 without a profile a card offers the file rows and no history row", async () => {
    profile.nickname = null;
    open();
    await waitFor(() => expect(titles(RECENT)).toEqual(["N note 1", "N note 2", "N note 3", "N note 4"]));

    await rightClick(card(RECENT, "N note 2"));

    expect(rows()).toEqual(FILE_ROWS);
  });
});

describe("SPEC-ADDON-164 I2: the long press on Notes Home", () => {
  it("SPEC-ADDON-164 I2 a 500 ms press opens the menu and its click does not open the note; a moved press and a short tap behave as before", async () => {
    open();
    await loaded();
    const target = card(RECENT, "N note 3");
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

    const tap = card(RECENT, "N note 2");
    await press(tap, 100);
    expect(rows()).toEqual([]);
    await release(tap);
    expect(nav.last()?.url.searchParams.get("file")).toBe("n2");
  });
});

describe("SPEC-ADDON-164 I3: a note leaves the sections in place", () => {
  it("SPEC-ADDON-164 I3 a trashed note leaves all three sections, the others keep their order, and no list is asked again", async () => {
    open();
    await loaded();
    const before = server.calls.length;

    await rightClick(card(RECENT, "N note 1"));
    await choose("Move to Trash");
    await submit("submit-trash");

    await waitFor(() => expect(titles(RECENT)).toEqual(["N note 2", "N note 3", "N note 4"]));
    expect(titles(CONTINUE)).toEqual(["N note 2"]);
    expect(titles(SOURCES)).toEqual(["N note 3"]);
    expect(writeLog(server.calls)).toEqual(["trash:n1"]);
    expect(listReads(server.calls.slice(before))).toEqual([]);
  });

  it("SPEC-ADDON-164 I3 I10 Remove from history takes the card out of Continue writing alone, through DELETE progress only", async () => {
    open();
    await loaded();

    await rightClick(card(CONTINUE, "N note 1"));
    await choose("Remove from history");

    await waitFor(() => expect(titles(CONTINUE)).toEqual(["N note 2"]));
    expect(titles(SOURCES)).toEqual(["N note 1", "N note 3"]);
    expect(titles(RECENT)).toEqual(["N note 1", "N note 2", "N note 3", "N note 4"]);
    expect(writeLog(server.calls)).toEqual(["history:n1"]);
  });

  it("SPEC-ADDON-164 I3 when the last Continue writing card leaves, the section goes", async () => {
    open(["n2"]);
    await waitFor(() => expect(titles(CONTINUE)).toEqual(["N note 2"]));

    await rightClick(card(CONTINUE, "N note 2"));
    await choose("Remove from history");

    await waitFor(() => expect(section(CONTINUE)).toBeNull());
    expect(titles(RECENT)).toEqual(["N note 1", "N note 2", "N note 3", "N note 4"]);
  });

  it("SPEC-ADDON-164 Remove from history chosen again while the first is in flight sends a second request, and the card leaves once", async () => {
    open(["n1", "n2", "n3"]);
    await waitFor(() => expect(titles(CONTINUE)).toEqual(["N note 1", "N note 2", "N note 3"]));
    const held = [deferredResponse(), deferredResponse()];
    let n = 0;
    control.hold.history = () => held[n++].promise;

    await rightClick(card(CONTINUE, "N note 1"));
    await choose("Remove from history");
    await rightClick(card(CONTINUE, "N note 1"));
    await choose("Remove from history");
    expect(writeLog(server.calls)).toEqual(["history:n1", "history:n1"]);

    await act(async () => {
      held[0].resolve(new Response(null, { status: 204 }));
      held[1].resolve(new Response(null, { status: 204 }));
    });

    await waitFor(() => expect(titles(CONTINUE)).toEqual(["N note 2", "N note 3"]));
    await act(() => settle());
    expect(titles(CONTINUE)).toEqual(["N note 2", "N note 3"]);
  });

  it("SPEC-ADDON-164 I3 a trashed note stays out of Home after Library and back", async () => {
    open();
    await loaded();

    await rightClick(card(RECENT, "N note 1"));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(titles(RECENT)).toEqual(["N note 2", "N note 3", "N note 4"]));

    fireEvent.click(screen.getByRole("link", { name: "Library" }));
    await waitFor(() => expect(nav.params.get("view")).toBe("all"));
    await act(() => settle());
    fireEvent.click(screen.getByRole("link", { name: "Home" }));
    await waitFor(() => expect(section(RECENT)).not.toBeNull());
    await act(() => settle(100));

    expect(screen.queryByText("N note 1")).toBeNull();
    expect(titles(CONTINUE)).toEqual(["N note 2"]);
  });
});

describe("SPEC-ADDON-164 I6: a failed action leaves Home unchanged", () => {
  it("SPEC-ADDON-164 I6 a failed Remove from history keeps the card, closes the menu and shows no toast", async () => {
    open();
    await loaded();
    control.hold.history = failWith();

    await rightClick(card(CONTINUE, "N note 1"));
    await choose("Remove from history");

    await waitFor(() => expect(writes(server.calls, "history")).toHaveLength(1));
    await waitFor(() => expect(rows()).toEqual([]));
    await act(() => settle());
    expect(titles(CONTINUE)).toEqual(["N note 2", "N note 1"]);
    expect(toasted()).toBe(0);
  });

  it.each([
    ["Rename", "submit-rename", "rename"],
    ["Move", "submit-move", "move"],
    ["Move to Trash", "submit-trash", "trash"],
  ] as const)("SPEC-ADDON-164 I6 a failed %s keeps the dialog open, changes no section and reads nothing again", async (label, button, kind) => {
    open();
    await loaded();
    control.hold[kind] = failWith();
    const before = server.calls.length;

    await rightClick(card(RECENT, "N note 1"));
    expect(rows()).toEqual(FILE_ROWS);
    await choose(label);
    await submit(button);

    await waitFor(() => expect(writes(server.calls, kind)).toHaveLength(1));
    await act(() => settle());
    expect(screen.getByText(button)).toBeInTheDocument();
    expect(titles(CONTINUE)).toEqual(["N note 2", "N note 1"]);
    expect(titles(SOURCES)).toEqual(["N note 1", "N note 3"]);
    expect(titles(RECENT)).toEqual(["N note 1", "N note 2", "N note 3", "N note 4"]);
    expect(server.calls.slice(before).filter(isReread)).toEqual([]);
  });
});

describe("SPEC-ADDON-164 I5: rename and move redraw the note in place", () => {
  it("SPEC-ADDON-164 I5 after a rename the note is read again by id alone and every card for it redraws at its position", async () => {
    open();
    await loaded();

    await rightClick(card(CONTINUE, "N note 1"));
    await choose("Rename");
    await submit("submit-rename");

    await waitFor(() => expect(titles(RECENT)).toEqual(["Renamed", "N note 2", "N note 3", "N note 4"]));
    expect(titles(CONTINUE)).toEqual(["N note 2", "Renamed"]);
    expect(titles(SOURCES)).toEqual(["Renamed", "N note 3"]);
    const reread = server.calls.filter(isReread);
    expect(reread).toHaveLength(1);
    expect([...reread[0].url.searchParams.entries()]).toEqual([["by", "all"], ["ids", "n1"]]);
    expect(writeLog(server.calls)).toEqual(["rename:n1", "reread:n1"]);
  });

  it("SPEC-ADDON-164 I5 after a move the Recently updated row shows the new folder, at its position", async () => {
    open();
    await loaded();
    expect(within(section(RECENT)!).queryByText(/Elsewhere/)).toBeNull();

    await rightClick(card(RECENT, "N note 1"));
    await choose("Move");
    await submit("submit-move");

    await waitFor(() => expect(within(section(RECENT)!).queryAllByText(/Elsewhere/).length).toBeGreaterThan(0));
    expect(titles(RECENT)).toEqual(["N note 1", "N note 2", "N note 3", "N note 4"]);
    expect(writeLog(server.calls)).toEqual(["move:n1", "reread:n1"]);
  });

  it("SPEC-ADDON-164 I5 when two re-reads overlap only the answer to the later one is drawn", async () => {
    open();
    await loaded();
    const held = [deferredResponse(), deferredResponse()];
    let n = 0;
    control.hold.reread = () => held[n++].promise;
    const answerAs = (title: string) => {
      const item = fileItem({ ...server.notes.find((x) => x.id === "n1")!, title });
      return json({ by: "all", base: "", total_shelves: 1, shelves: [{ key: "all", label: "", count: 1, items: [item] }] });
    };

    dialogs.renameTo = "First.md";
    await rightClick(card(RECENT, "N note 1"));
    await choose("Rename");
    await submit("submit-rename");
    await waitFor(() => expect(server.calls.filter(isReread)).toHaveLength(1));
    dialogs.renameTo = "Second.md";
    await rightClick(card(RECENT, "N note 1"));
    await choose("Rename");
    await submit("submit-rename");
    await waitFor(() => expect(server.calls.filter(isReread)).toHaveLength(2));

    await act(async () => held[1].resolve(answerAs("Second")));
    await waitFor(() => expect(titles(RECENT)[0]).toBe("Second"));
    await act(async () => held[0].resolve(answerAs("First")));
    await act(() => settle());

    expect(titles(RECENT)).toEqual(["Second", "N note 2", "N note 3", "N note 4"]);
    expect(screen.queryByText("First")).toBeNull();
  });

  it.each([
    ["fails", () => json({ detail: "boom" }, 500)],
    ["answers no item", () => json({ by: "all", base: "", total_shelves: 1, shelves: [{ key: "all", label: "", count: 0, items: [] }] })],
  ])("SPEC-ADDON-164 I5 when the re-read %s the cards keep what they drew and no toast is shown", async (_l, answer) => {
    open();
    await loaded();
    control.hold.reread = answer;

    await rightClick(card(RECENT, "N note 1"));
    await choose("Rename");
    await submit("submit-rename");

    await waitFor(() => expect(server.calls.filter(isReread)).toHaveLength(1));
    await act(() => settle());
    expect(titles(RECENT)).toEqual(["N note 1", "N note 2", "N note 3", "N note 4"]);
    expect(titles(CONTINUE)).toEqual(["N note 2", "N note 1"]);
    expect(toasted()).toBe(0);
  });

  it.each(["Copy", "Copy ID", "Cut"])("SPEC-ADDON-164 I5 %s changes nothing on the page and sends nothing", async (label) => {
    open();
    await loaded();
    const before = server.calls.length;

    await rightClick(card(RECENT, "N note 1"));
    expect(rows()).toEqual(FILE_ROWS);
    await choose(label);
    await act(() => settle());

    expect(titles(RECENT)).toEqual(["N note 1", "N note 2", "N note 3", "N note 4"]);
    expect(writeLog(server.calls)).toEqual([]);
    expect(listReads(server.calls.slice(before))).toEqual([]);
  });
});
