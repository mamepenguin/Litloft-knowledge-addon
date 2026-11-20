/**
 * The file menu's list changes across inputs the page depends on: a Target,
 * a refetched list, and a page in flight. Invariant ids are those of
 * docs/specs/app-card-menu.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import { json, type WireCall } from "@/__tests__/helpers/wireFetch";
import {
  BASE,
  captureHistory,
  fileItem,
  installNotesServer,
  isFiles,
  nav,
  router,
  setViewport,
  settle,
  type Note,
  type Server,
} from "./notesAppHarness";
import {
  choose,
  dialogs,
  isReread,
  resetToast,
  rightClick,
  submit,
  writeRoutes,
  type WriteControl,
} from "./cardMenuHarness";
import { navigationGuard } from "@/lib/navigationGuard";

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
  MarkdownPreview: () => <div data-testid="markdown" />,
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
  server = installNotesServer({ notes });
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
  dialogs.renameTo = "Renamed.md";
  dialogs.moveTo = "Elsewhere";
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
const TITLE = /^(Alpha|Beta|Gamma|Delta|Many \d+|Note [\d]+b?)$/;
const listTitles = () => within(list()).queryAllByText(TITLE).map((e) => e.textContent);
const row = (title: string) => within(list()).getByText(title);
const listCalls = () => server.calls.filter((c) => (isFiles(c) && c.url.searchParams.get("limit") === "60"));

async function ready() {
  await waitFor(() => expect(listTitles()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function many(): Note[] {
  return Array.from({ length: 130 }, (_, i) => ({
    id: `m${i}`,
    title: `Many ${i}`,
    folder: "",
    tags: [],
    updated: new Date(Date.UTC(2026, 10, 1) - i * 60_000).toISOString(),
  }));
}

describe("SPEC-ADDON-164 I3: a removal holds while the page does", () => {
  it("draws a trashed note nowhere after Home and back, even though the server still returns it", async () => {
    open();
    await ready();
    control.hold.trash = () => new Response(null, { status: 204 });

    await rightClick(row("Gamma"));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(listTitles()).toEqual(["Alpha", "Beta", "Delta"]));
    expect(server.notes.some((note) => note.id === "n3")).toBe(true);

    fireEvent.click(screen.getByRole("link", { name: "Home" }));
    await waitFor(() => expect(screen.queryByText("Recently updated")).not.toBeNull());
    await act(() => settle(100));
    expect(screen.queryByText("Gamma")).toBeNull();

    const asked = listCalls().length;
    fireEvent.click(screen.getByRole("link", { name: "Library" }));
    await waitFor(() => expect(nav.params.get("view")).toBe("all"));
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(asked));
    await waitFor(() => expect(listTitles()).toEqual(["Alpha", "Beta", "Delta"]));
    expect(server.notes.some((note) => note.id === "n3")).toBe(true);
  });
});

describe("SPEC-ADDON-164 I4: a page asked after a rename draws no id twice", () => {
  it("never repeats a renamed note that comes back under a name sort", async () => {
    const notes: Note[] = Array.from({ length: 130 }, (_, i) => ({
      id: `d${i}`,
      title: `Note ${String(i).padStart(3, "0")}`,
      folder: "",
      tags: [],
      updated: new Date(Date.UTC(2026, 10, 1) - i * 60_000).toISOString(),
    }));
    open(`${BASE}?view=all&sort=title`, notes);
    expect(await within(list()).findByText("Note 059")).toBeInTheDocument();

    dialogs.renameTo = "Note 065b.md";
    await rightClick(row("Note 000"));
    await choose("Rename");
    await submit("submit-rename");
    await waitFor(() => expect(server.calls.filter(isReread)).toHaveLength(1));
    await waitFor(() => expect(within(list()).getByText("Note 065b")).toBeInTheDocument());

    await waitFor(() => expect(nearEnd.enabled).toBe(true));
    act(() => nearEnd.load());
    await waitFor(() => expect(listTitles().length).toBeGreaterThan(60));
    await act(() => settle());

    const drawn = listTitles();
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn.filter((title) => title === "Note 065b")).toHaveLength(1);
  });
});

describe("SPEC-ADDON-164 I3 I4: a page in flight when a note leaves", () => {
  it("drops the page asked under the old boundary and asks again from the shifted one", async () => {
    open(`${BASE}?view=all`, many());
    expect(await screen.findByText("Many 59")).toBeInTheDocument();

    const release = deferred();
    let held = false;
    const routes = server.override;
    server.override = (c: WireCall) => {
      const write = routes(c);
      if (write) return write;
      if (isFiles(c) && c.url.searchParams.get("page") === "2" && !held) {
        held = true;
        return release.promise.then(() => {
          return json({
            data: server.notes.slice(60, 120).map(fileItem),
            meta: { total: server.notes.length, page: 2, limit: 60 },
          });
        });
      }
      return null;
    };

    await waitFor(() => expect(nearEnd.enabled).toBe(true));
    act(() => nearEnd.load());
    await waitFor(() =>
      expect(server.calls.some((c) => isFiles(c) && c.url.searchParams.get("page") === "2")).toBe(true),
    );

    await rightClick(row("Many 3"));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(within(list()).queryByText("Many 3")).toBeNull());
    const heldTitles = listTitles();

    await act(async () => release.resolve());
    await act(() => settle());
    const drawn = listTitles();
    const fresh = server.notes.map((note) => note.title);
    expect(drawn).toEqual(fresh.slice(0, drawn.length));
    expect(drawn).toHaveLength(heldTitles.length);

    await waitFor(() => expect(nearEnd.enabled).toBe(true));
    act(() => nearEnd.load());
    await waitFor(() => expect(listTitles().length).toBeGreaterThan(drawn.length));
    await act(() => settle());
    const after = listTitles();
    expect(after).toEqual(fresh.slice(0, after.length));
    expect(new Set(after).size).toBe(after.length);
  });
});
