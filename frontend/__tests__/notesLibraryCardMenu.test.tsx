/**
 * SPEC-ADDON-164: the file menu on the Notes Library list, what its actions do
 * to the list and to the reading pane, and the pane's change gate in front of
 * them. Invariant ids are those of docs/specs/app-card-menu.md.
 *
 * The pane's editor is a stand-in publishing a `saveHandle` the test
 * controls, as in the Library suite, so the gate is driven by `flush()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { dirtyRegistry } from "@/lib/dirtyRegistry";
import { navigationGuard } from "@/lib/navigationGuard";

import {
  BASE,
  captureHistory,
  fileItem,
  installNotesServer,
  isFiles,
  isFilesQuery,
  isMeta,
  nav,
  router,
  setViewport,
  settle,
  smartFolder,
  textNodes,
  type Note,
  type Server,
} from "./notesAppHarness";
import {
  FILE_ROWS,
  choose,
  closeMenu,
  failWith,
  kindOf,
  press,
  release,
  resetToast,
  rightClick,
  rows,
  submit,
  submitIfShown,
  writeLog,
  writeRoutes,
  writes,
  type WriteControl,
  type WriteKind,
} from "./cardMenuHarness";

type Outcome = "saved" | "failed" | "conflict";
const edit = vi.hoisted(() => ({
  dirty: true,
  flush: null as null | ReturnType<typeof vi.fn>,
}));
vi.mock("../KnowledgeEditSection", async () => {
  const { useEffect } = await import("react");
  const Stub = (props: Record<string, unknown>) => {
    const handle = props.saveHandle as { current: unknown } | undefined;
    useEffect(() => {
      if (!handle) return;
      handle.current = { dirty: () => edit.dirty, flush: () => edit.flush!() };
      // The real editor publishes unsaved text here, and the guard asks for it.
      dirtyRegistry.set("stub-editor", "knowledge-editor", edit.dirty);
      return () => {
        handle.current = null;
        dirtyRegistry.set("stub-editor", "knowledge-editor", false);
      };
    }, [handle]);
    return <div data-testid="pane-editor" />;
  };
  return { default: Stub, KnowledgeEditSection: Stub };
});

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
vi.mock("@/lib/featureFlags", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/featureFlags");
  return { ...actual, isInlineKnowledgeEditorEnabled: () => true };
});
vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: (props: Record<string, unknown>) => (
    <div data-testid="markdown">
      {Object.entries(props)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => (
          <div key={k}>{v as string}</div>
        ))}
    </div>
  ),
}));
const nearEnd = vi.hoisted(() => ({ enabled: false, load: () => {} }));
vi.mock("@/components/appshell/useNearEnd", () => ({
  useNearEnd: (enabled: boolean, load: () => void) => {
    nearEnd.enabled = enabled;
    nearEnd.load = load;
    return () => {};
  },
}));
vi.mock("@/components/FileDetail/hooks/usePlainTextDocument", () => ({
  usePlainTextDocument: () => ({ decided: true, plainTextDocument: false }),
}));
vi.mock("@/components/TextPreview", () => ({
  TextPreview: ({ fileId }: { fileId: string }) => <div data-testid="text-preview">{fileId}</div>,
}));
vi.mock("@/components/RenameDialog", async () => (await import("./cardMenuHarness")).renameDialogModule);
vi.mock("@/components/MoveDialog", async () => (await import("./cardMenuHarness")).moveDialogModule);
vi.mock("@/components/ConfirmDialog", async () => (await import("./cardMenuHarness")).confirmDialogModule);
vi.mock("@/components/CollectionPicker", async () => (await import("./cardMenuHarness")).collectionPickerModule);
vi.mock("@/components/ClipboardProvider", async () => (await import("./cardMenuHarness")).clipboardModule);
vi.mock("@/components/ToastProvider", async () => (await import("./cardMenuHarness")).toastModule());

const Page = (await import("../Page")).default;

const NOTES: Note[] = [
  { id: "n1", title: "Alpha", folder: "Journal", tags: ["trip"], updated: "2026-11-10T09:00:00Z", body: "Body of Alpha" },
  { id: "n2", title: "Beta", folder: "", tags: [], updated: "2026-11-09T09:00:00Z", body: "Body of Beta" },
  { id: "n3", title: "Gamma", folder: "Work", tags: ["food"], updated: "2026-11-08T09:00:00Z", body: "Body of Gamma" },
  { id: "n4", title: "Delta", folder: "Journal", tags: ["food"], updated: "2026-11-07T09:00:00Z", body: "Body of Delta" },
];

let server: Server;
let control: WriteControl;

function open(url = `${BASE}?view=all`, notes: Note[] = NOTES) {
  nav.set(url);
  server = installNotesServer({ notes, smartFolders: [smartFolder("sf-trip", "Trip", "tag:trip")] });
  control = { hold: {} };
  const routes = writeRoutes<Note>(
    {
      find: (id) => server.notes.find((n) => n.id === id),
      rename: (id, filename) => {
        server.notes = server.notes.map((n) => (n.id === id ? { ...n, title: filename.replace(/\.md$/, "") } : n));
      },
      move: (id, folder) => {
        server.notes = server.notes.map((n) => (n.id === id ? { ...n, folder } : n));
      },
      trash: (id) => {
        server.notes = server.notes.filter((n) => n.id !== id);
      },
      forget: () => {},
      item: fileItem,
    },
    control,
  );
  server.override = (c) => routes(c);
  return render(<Page />);
}

beforeEach(() => {
  localStorage.clear();
  router.push.mockClear();
  router.replace.mockClear();
  profile.nickname = "alice";
  nearEnd.enabled = false;
  edit.dirty = true;
  edit.flush = vi.fn(async (): Promise<Outcome> => "saved");
  navigationGuard.reset();
  resetToast();
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  navigationGuard.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const list = () => screen.getByRole("region", { name: "Notes" });
const TITLE = /^(Alpha|Beta|Gamma|Delta|Renamed|Many \d+)$/;
const listTitles = () => within(list()).queryAllByText(TITLE).map((e) => e.textContent);
const row = (title: string) => within(list()).getByText(title);
const shown = (body: string) => screen.queryByText(body) !== null;
/** Elements reading `text` outside the list: the pane's own copy. */
const inPane = (text: string) => textNodes(text).filter((el) => !list().contains(el));
const listCalls = () => server.calls.filter((c) => (isFiles(c) || isFilesQuery(c)) && c.url.searchParams.get("limit") === "60");

async function ready() {
  await waitFor(() => expect(listTitles()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]));
  await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
}

async function startEditing() {
  await ready();
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  await waitFor(() => expect(screen.queryByTestId("pane-editor")).not.toBeNull());
  await act(() => settle(10));
}

describe("SPEC-ADDON-164 I1 I2: the menu on a Library row", () => {
  it("SPEC-ADDON-164 I1 a row offers the file rows instead of the browser's menu and sends no request; the rail and the name field do not open it", async () => {
    open();
    await ready();
    await waitFor(() => expect(screen.getAllByText("Work").length).toBeGreaterThan(0));
    const before = server.calls.length;

    expect(await rightClick(row("Gamma"))).toBe(false);
    expect(rows()).toEqual(FILE_ROWS);
    expect(server.calls.length).toBe(before);
    await closeMenu();
    await waitFor(() => expect(rows()).toEqual([]));

    for (const el of [...screen.getAllByText("Work").filter((e) => !list().contains(e)), screen.getByPlaceholderText("Search notes")]) {
      await rightClick(el);
    }
    expect(rows()).toEqual([]);
  });

  it("SPEC-ADDON-164 I2 a 500 ms press opens the menu and its click does not change the pane; a short tap still shows the note", async () => {
    open();
    await ready();

    await press(row("Gamma"), 500);
    expect(rows()).toEqual(FILE_ROWS);
    await release(row("Gamma"));
    await act(() => settle());
    expect(nav.params.get("note")).not.toBe("n3");
    expect(shown("Body of Gamma")).toBe(false);
    await closeMenu();
    await waitFor(() => expect(rows()).toEqual([]));

    await press(row("Gamma"), 100);
    expect(rows()).toEqual([]);
    await release(row("Gamma"));
    await waitFor(() => expect(nav.params.get("note")).toBe("n3"));
    expect(await screen.findByText("Body of Gamma")).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-164 I3 I4: rows leave the Library list in place", () => {
  it("SPEC-ADDON-164 I3 a trashed row that is not in the pane leaves the list, the pane keeps its note, and the list is not asked again", async () => {
    open();
    await ready();
    const asked = listCalls().length;

    await rightClick(row("Gamma"));
    await choose("Move to Trash");
    await submit("submit-trash");

    await waitFor(() => expect(listTitles()).toEqual(["Alpha", "Beta", "Delta"]));
    expect(writeLog(server.calls)).toEqual(["trash:n3"]);
    expect(shown("Body of Alpha")).toBe(true);
    expect(listCalls().length).toBe(asked);
  });

  it("SPEC-ADDON-164 I4 after a trash the next page neither skips nor repeats a note compared with a fresh load", async () => {
    const many: Note[] = Array.from({ length: 130 }, (_, i) => ({
      id: `m${i}`,
      title: `Many ${i}`,
      folder: "",
      tags: [],
      updated: new Date(Date.UTC(2026, 10, 1) - i * 60_000).toISOString(),
    }));
    open(`${BASE}?view=all`, many);
    expect(await within(list()).findByText("Many 59")).toBeInTheDocument();

    await rightClick(row("Many 3"));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(within(list()).queryByText("Many 3")).toBeNull());
    await waitFor(() => expect(nearEnd.enabled).toBe(true));
    act(() => nearEnd.load());
    await waitFor(() => expect(listTitles().length).toBeGreaterThan(100));

    const drawn = listTitles();
    const fresh = server.notes.map((n) => n.title);
    expect(drawn).toEqual(fresh.slice(0, drawn.length));
    expect(new Set(drawn).size).toBe(drawn.length);
  });
});

describe("SPEC-ADDON-164 I10: the note shown in the pane", () => {
  it("SPEC-ADDON-164 I10 trashing the shown note removes note from the URL (replace) and the pane shows what it shows with no note", async () => {
    open(`${BASE}?view=all&note=n1`);
    await ready();

    await rightClick(row("Alpha"));
    await choose("Move to Trash");
    await submit("submit-trash");

    await waitFor(() => expect(listTitles()).toEqual(["Beta", "Gamma", "Delta"]));
    expect(writeLog(server.calls)).toEqual(["trash:n1"]);
    await waitFor(() => expect(nav.params.has("note")).toBe(false));
    expect(nav.log.some((n) => n.kind === "replace" && !n.url.searchParams.has("note"))).toBe(true);
    expect(nav.log.filter((n) => n.kind === "push")).toEqual([]);
    expect(await screen.findByText("Body of Beta")).toBeInTheDocument();
    expect(shown("Body of Alpha")).toBe(false);
    await act(() => settle(100));
    expect(nav.params.has("note")).toBe(false);
  });

  it("SPEC-ADDON-164 I10 renaming the shown note reads it anew and the pane shows the new name", async () => {
    open(`${BASE}?view=all&note=n1`);
    await ready();
    expect(inPane("Alpha").length).toBeGreaterThan(0);
    const before = server.calls.length;

    await rightClick(row("Alpha"));
    await choose("Rename");
    await submit("submit-rename");

    await waitFor(() => expect(listTitles()).toEqual(["Renamed", "Beta", "Gamma", "Delta"]));
    await waitFor(() => expect(inPane("Renamed").length).toBeGreaterThan(0));
    expect(inPane("Alpha")).toEqual([]);
    expect(server.calls.slice(before).some(isMeta("n1"))).toBe(true);
    expect(nav.params.get("note")).toBe("n1");
  });

  it("SPEC-ADDON-164 I10 moving the shown note reads it anew and the pane shows the new folder", async () => {
    open(`${BASE}?view=all&note=n1`);
    await ready();
    const paneFolder = () => screen.queryAllByText(/Elsewhere/).filter((el) => !list().contains(el));
    expect(paneFolder()).toEqual([]);
    const before = server.calls.length;

    await rightClick(row("Alpha"));
    await choose("Move");
    await submit("submit-move");

    await waitFor(() => expect(paneFolder().length).toBeGreaterThan(0));
    expect(server.calls.slice(before).some(isMeta("n1"))).toBe(true);
    expect(listTitles()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(nav.params.get("note")).toBe("n1");
  });

  const GATED: Array<[string, WriteKind]> = [
    ["Rename", "rename"],
    ["Move", "move"],
    ["Move to Trash", "trash"],
  ];
  const sent = (kind: WriteKind) => writes(server.calls, kind, "n1").length;

  it.each(GATED)("SPEC-ADDON-164 I10 %s on the note being edited waits for the save and is sent once it is saved", async (label, kind) => {
    let resolve!: (o: Outcome) => void;
    const pending = new Promise<Outcome>((r) => (resolve = r));
    edit.flush = vi.fn(() => pending);
    open();
    await startEditing();

    await rightClick(row("Alpha"));
    expect(rows()).toContain(label);
    await choose(label);
    await submitIfShown();
    await act(() => settle(50));

    expect(edit.flush).toHaveBeenCalled();
    expect(sent(kind)).toBe(0);
    await act(async () => resolve("saved"));
    await act(() => settle(20));
    await submitIfShown();
    await waitFor(() => expect(sent(kind)).toBe(1));
  });

  it.each(GATED)("SPEC-ADDON-164 I10 %s on the note being edited after a failed save goes to the guard, and cancelling sends nothing", async (label, kind) => {
    edit.flush = vi.fn(async () => "failed" as Outcome);
    open();
    await startEditing();

    await rightClick(row("Alpha"));
    expect(rows()).toContain(label);
    await choose(label);
    await submitIfShown();

    await waitFor(() => expect(navigationGuard.getPending()).not.toBeNull());
    expect(sent(kind)).toBe(0);
    act(() => navigationGuard.cancel());
    await submitIfShown();
    await act(() => settle(50));
    expect(sent(kind)).toBe(0);
    expect(server.calls.map(kindOf).filter(Boolean)).toEqual([]);
  });

  it.each(GATED)("SPEC-ADDON-164 I10 %s on the note being edited after a conflicting save is sent once the discard is confirmed", async (label, kind) => {
    edit.flush = vi.fn(async () => "conflict" as Outcome);
    open();
    await startEditing();

    await rightClick(row("Alpha"));
    expect(rows()).toContain(label);
    await choose(label);
    await submitIfShown();

    await waitFor(() => expect(navigationGuard.getPending()).not.toBeNull());
    expect(sent(kind)).toBe(0);
    act(() => navigationGuard.confirm());
    await act(() => settle(20));
    await submitIfShown();
    await waitFor(() => expect(sent(kind)).toBe(1));
  });

  it("SPEC-ADDON-164 I6 a failed trash of the shown note keeps the dialog open, the row and the URL", async () => {
    open(`${BASE}?view=all&note=n1`);
    await ready();
    control.hold.trash = failWith();

    await rightClick(row("Alpha"));
    await choose("Move to Trash");
    await submit("submit-trash");

    await waitFor(() => expect(writes(server.calls, "trash")).toHaveLength(1));
    await act(() => settle());
    expect(screen.getByText("submit-trash")).toBeInTheDocument();
    expect(listTitles()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(nav.params.get("note")).toBe("n1");
    expect(shown("Body of Alpha")).toBe(true);
  });
});
