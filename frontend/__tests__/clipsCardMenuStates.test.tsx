/**
 * The file menu on Clips across inputs the page depends on: a Target change
 * while an action or a re-read is in flight, and a page asked while a card
 * leaves. Invariant ids are those of docs/specs/app-card-menu.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import {
  CLIPS,
  NOT_CLIPS,
  captureHistory,
  clips,
  fileItem,
  installClipsServer,
  isNewShelf,
  isUnreadShelf,
  nav,
  profile,
  reachEnd,
  resetSocket,
  setViewport,
  settle,
  smartFolder,
  type Call,
  type Clip,
  type Server,
} from "./clipsAppHarness";
import {
  choose,
  deferredResponse,
  isReread,
  resetToast,
  rightClick,
  submit,
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
const UNREAD = "Unread";
const TITLE = /^(C clip \d+|Z clip \d+|Renamed)$/;

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

const shelf = (name: string): HTMLElement | null => {
  const h = screen.queryByRole("heading", { level: 2, name });
  return h ? ((h.closest("section") ?? h.parentElement!.parentElement!) as HTMLElement) : null;
};
const titles = (name: string) => {
  const s = shelf(name);
  return s ? within(s).queryAllByText(TITLE).map((e) => e.textContent) : [];
};
const drawn = () => screen.queryAllByText(TITLE).map((e) => e.textContent);

function workClip(): Clip[] {
  return clips(3).map((c) => (c.id === "c1" ? { ...c, tags: ["work"] } : c));
}

async function chooseTarget(name: string) {
  // A menu row is chosen with a press and a click; the press is ended here so
  // the popover that opens next does not take this click for the old one.
  fireEvent.pointerUp(document);
  fireEvent.click(screen.getByRole("button", { name: /Target/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: new RegExp(name) }));
}

function workLoaded() {
  return server.calls.some(
    (c) => isUnreadShelf(c) && c.url.searchParams.getAll("tag").includes("work"),
  );
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

describe("SPEC-ADDON-164 I9: a Target chosen while a trash is in flight", () => {
  it("completes the trash against the clip and leaves the lists loaded for the new Target alone", async () => {
    serve(workClip(), { history: [], smartFolders: [smartFolder("sf-work", "Work", "tag:work")] });
    render(<Page />);
    await waitFor(() => expect(titles(UNREAD)).toEqual(["C clip 1", "C clip 2", "C clip 3"]));

    const held = deferredResponse();
    control.hold.trash = () => held.promise;
    await rightClick(within(shelf(UNREAD)!).getByText("C clip 1"));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(writes(server.calls, "trash", "c1")).toHaveLength(1));

    await chooseTarget("Work");
    await waitFor(() => expect(workLoaded()).toBe(true));
    await waitFor(() => expect(titles(UNREAD)).toEqual(["C clip 1"]));
    await act(async () => held.resolve(new Response(null, { status: 204 })));
    await act(() => settle(100));

    expect(titles(UNREAD)).toEqual(["C clip 1"]);
    expect(server.files.some((c) => c.id === "c1")).toBe(true);
  });
});

describe("SPEC-ADDON-164 I9: a Target chosen while a re-read is in flight", () => {
  it("draws nothing the late re-read answers with in the lists of the new Target", async () => {
    serve(workClip(), { history: [], smartFolders: [smartFolder("sf-work", "Work", "tag:work")] });
    render(<Page />);
    await waitFor(() => expect(titles(UNREAD)).toEqual(["C clip 1", "C clip 2", "C clip 3"]));

    const held = deferredResponse();
    control.hold.reread = () => held.promise;
    await rightClick(within(shelf(UNREAD)!).getByText("C clip 1"));
    await choose("Rename");
    await submit("submit-rename");
    await waitFor(() => expect(server.calls.filter(isReread)).toHaveLength(1));

    await chooseTarget("Work");
    await waitFor(() => expect(workLoaded()).toBe(true));
    await waitFor(() => expect(titles(UNREAD)).toEqual(["Renamed"]));

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

    expect(titles(UNREAD)).toEqual(["Renamed"]);
  });
});

describe("SPEC-ADDON-164 I3 I4: a page in flight when a clip leaves", () => {
  it("drops the page asked under the old boundary and asks again from the shifted one", async () => {
    nav.set(`${LIBRARY}&group=none`);
    serve([...clips(65), ...NOT_CLIPS]);
    render(<Page />);
    expect(await screen.findByText("C clip 60")).toBeInTheDocument();

    const held = deferredResponse();
    let waiting = false;
    const routes = server.override;
    server.override = (c: Call) => {
      const write = routes(c);
      if (write) return write;
      if (isNewShelf(c) && c.url.searchParams.get("page") === "2" && !waiting) {
        waiting = true;
        return held.promise.then(() => server.answer(c));
      }
      return null;
    };

    await reachEnd();
    await waitFor(() =>
      expect(server.calls.some((c) => isNewShelf(c) && c.url.searchParams.get("page") === "2")).toBe(true),
    );

    await rightClick(screen.getByText("C clip 3"));
    await choose("Move to Trash");
    await submit("submit-trash");
    await waitFor(() => expect(screen.queryByText("C clip 3")).toBeNull());
    const heldTitles = drawn();

    await act(async () => held.resolve(new Response(null, { status: 200 })));
    await act(() => settle(100));
    const fresh = server.files.filter((c) => c.id.startsWith("c")).map((c) => c.title);
    expect(drawn()).toEqual(fresh.slice(0, drawn().length));
    expect(drawn()).toHaveLength(heldTitles.length);

    await reachEnd();
    await waitFor(() => expect(drawn().length).toBe(fresh.length));
    await act(() => settle());
    expect(drawn()).toEqual(fresh);
    expect(new Set(drawn()).size).toBe(drawn().length);
  });
});
