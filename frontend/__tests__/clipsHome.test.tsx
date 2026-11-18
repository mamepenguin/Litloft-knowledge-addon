/**
 * SPEC-ADDON-138: Clips Home — its shelves, unread dots, Mark as verified and
 * cards. Invariant ids are those of docs/specs/clips-frame.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import {
  CLIPS,
  DRIVE,
  NOT_CLIPS,
  captureHistory,
  clips,
  deferred,
  emit,
  installClipsServer,
  isDotAsk,
  isNewShelf,
  isTrustWrite,
  isUnverifiedShelf,
  reachEnd,
  setNickname,
  isUnreadShelf,
  isWatchHistory,
  nav,
  profile,
  q,
  resetSocket,
  setViewport,
  settle,
  smartFolder,
  type Clip,
  type Server,
} from "./clipsAppHarness";

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

const Page = (await import("../pages/clips")).default;

const CLIPS_TARGET_KEY = `litloft.addon.knowledge-clips.target.${DRIVE}`;
const NOTES_TARGET_KEY = `litloft.addon.knowledge.target.${DRIVE}`;
const TRIP = smartFolder("sf-trip", "Trip", "tag:trip");
const WORK = smartFolder("sf-work", "Work", "tag:work");

let server: Server;

function serve(files: Clip[] = [...clips(3), ...NOT_CLIPS], extra: Parameters<typeof installClipsServer>[0] = {}) {
  server = installClipsServer({ files, smartFolders: [TRIP, WORK], ...extra });
  return server;
}

beforeEach(() => {
  localStorage.clear();
  nav.set(CLIPS);
  profile.nickname = "alice";
  resetSocket();
  sidebar.overlay.mockClear();
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const hrefOf = (a: Element) => new URL(a.getAttribute("href")!, "http://localhost");
const before = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const heading = (name: string) => screen.queryByRole("heading", { level: 2, name });
const shelf = (name: string) => {
  const h = heading(name)!;
  return (h.closest("section") ?? h.parentElement!.parentElement!) as HTMLElement;
};
const seeAll = (name: string) => screen.getByRole("link", { name: new RegExp(`See all.*${name}`) });
const inUnverified = () => within(shelf("Unverified"));
const markButtons = () => screen.queryAllByRole("button", { name: "Mark as verified" });
const unverified = (n: number) => clips(n, "v", { trust: "unverified" }).map((c, i) => ({ ...c, created: `2026-10-${String(28 - i).padStart(2, "0")}T00:00:00Z` }));

describe("SPEC-ADDON-138 step 6: Home with a profile", () => {
  it("SPEC-ADDON-138 asks Unread, Recently opened and Unverified as the spec names them", async () => {
    serve([...clips(3), ...unverified(2), ...NOT_CLIPS], { history: ["c3"] });
    render(<Page />);

    await screen.findByRole("heading", { level: 2, name: "Unverified" });
    const unread = server.calls.filter(isUnreadShelf);
    expect(unread.length).toBeGreaterThan(0);
    for (const call of unread) {
      expect(Object.fromEntries(["by", "key", "opened", "sort", "order", "per_shelf"].map((k) => [k, q(call).get(k)]))).toEqual({
        by: "all", key: "all", opened: "false", sort: "created_at", order: "desc", per_shelf: "12",
      });
    }
    const unv = server.calls.filter(isUnverifiedShelf);
    expect(unv.length).toBeGreaterThan(0);
    for (const call of unv) {
      expect(Object.fromEntries(["by", "key", "trust", "sort", "order", "per_shelf", "opened"].map((k) => [k, q(call).get(k)]))).toEqual({
        by: "all", key: "all", trust: "unverified", sort: "created_at", order: "desc", per_shelf: "5", opened: null,
      });
    }
    expect(server.calls.filter(isNewShelf)).toHaveLength(0);
  });

  it("SPEC-ADDON-138 draws Unread with its count, Recently opened, then Unverified without a count, each with See all to its shelf page", async () => {
    serve([...clips(3), ...unverified(2), ...NOT_CLIPS], { history: ["c3"] });
    render(<Page />);
    await screen.findByText("Recently opened");
    await within(await waitFor(() => shelf("Unverified"))).findByText("V clip 1");

    const [unread, recent, unv] = ["Unread", "Recently opened", "Unverified"].map((n) => heading(n)!);
    expect([before(unread, recent), before(recent, unv)]).toEqual([true, true]);
    // c1, c2, v1, v2 are not in the history.
    expect(within(shelf("Unread")).getByText("4")).toBeInTheDocument();
    expect(within(unv.parentElement!).queryByText("2")).toBeNull();
    for (const [name, id] of [["Unread", "unread"], ["Recently opened", "recent"], ["Unverified", "unverified"]]) {
      const link = within(shelf(name)).getAllByRole("link").find((a) => /See all/.test(a.textContent ?? ""))!;
      const target = hrefOf(link);
      expect([target.pathname, target.searchParams.get("view"), target.searchParams.get("shelf")]).toEqual([CLIPS, "shelf", id]);
    }
    expect(heading("New clips")).toBeNull();
  });

  it("SPEC-ADDON-138 Unread and Recently opened are cards of their own clips, newest first", async () => {
    serve([...clips(3), ...NOT_CLIPS], { history: ["c3"] });
    render(<Page />);
    await screen.findByText("Recently opened");

    const unread = shelf("Unread");
    const c1 = await within(unread).findByText("C clip 1");
    expect(before(c1, within(unread).getByText("C clip 2"))).toBe(true);
    expect(within(unread).queryByText("C clip 3")).toBeNull();
    expect(within(unread).queryByText("A note")).toBeNull();
    expect(within(unread).queryByText("picture")).toBeNull();
    expect(within(shelf("Recently opened")).getByText("C clip 3")).toBeInTheDocument();
  });

  it("SPEC-ADDON-138 a shelf with no card is not drawn", async () => {
    serve([...clips(2), ...NOT_CLIPS], { history: [] });
    render(<Page />);

    await screen.findByText("C clip 1");
    await act(() => settle());
    expect(heading("Recently opened")).toBeNull();
    expect(heading("Unverified")).toBeNull();
  });

  it("SPEC-ADDON-138 the Unverified shelf draws at most 5 rows", async () => {
    serve([...unverified(7), ...NOT_CLIPS], { history: unverified(7).map((c) => c.id) });
    render(<Page />);

    await within(await waitFor(() => shelf("Unverified"))).findByText("V clip 1");
    expect(within(shelf("Unverified")).getByText("V clip 5")).toBeInTheDocument();
    expect(within(shelf("Unverified")).queryByText("V clip 6")).toBeNull();
    expect(markButtons()).toHaveLength(5);
  });
});

describe("SPEC-ADDON-138 step 6, I11: Home without a profile, and after viewer_required", () => {
  it("SPEC-ADDON-138 without a profile draws New clips and Unverified, and asks nothing that needs a viewer", async () => {
    profile.nickname = null;
    serve([...clips(3), ...unverified(1), ...NOT_CLIPS]);
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 2, name: "New clips" })).toBeInTheDocument();
    expect(heading("Unverified")).not.toBeNull();
    expect(heading("Unread")).toBeNull();
    expect(heading("Recently opened")).toBeNull();
    const target = hrefOf(seeAll("New clips"));
    expect([target.searchParams.get("view"), target.searchParams.get("shelf")]).toEqual(["shelf", "new"]);
    for (const call of server.calls.filter(isNewShelf)) {
      expect([q(call).get("by"), q(call).get("key"), q(call).get("sort"), q(call).get("order"), q(call).get("per_shelf")]).toEqual([
        "all", "all", "created_at", "desc", "12",
      ]);
    }
    await act(() => settle());
    expect(server.calls.filter((c) => q(c).has("opened") || isWatchHistory(c))).toHaveLength(0);
  });

  it("SPEC-ADDON-138 I11 after Unread answers viewer_required no request needing a viewer is sent until the nickname changes", async () => {
    serve([...clips(3, "c", { tags: ["food"] }), ...NOT_CLIPS], { viewer: false });
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 2, name: "New clips" })).toBeInTheDocument();
    expect(server.calls.some(isUnreadShelf)).toBe(true);
    await act(() => settle());
    const refused = server.calls.length - 1;
    fireEvent.click(screen.getByRole("link", { name: "Library" }));
    await screen.findByRole("heading", { level: 2, name: "food" });
    emit("knowledge.clip.ready", { file_id: "c1", job_id: 1 });
    await act(() => settle(100));
    const afterRefusal = server.calls.slice(refused + 1);
    expect(afterRefusal.filter((c) => q(c).has("opened") || isWatchHistory(c))).toHaveLength(0);

    server.viewer = true;
    setNickname("bob");
    await waitFor(() => expect(server.calls.filter(isDotAsk).length).toBeGreaterThan(0));
  });
});

describe("SPEC-ADDON-138 step 7, I4: the unread-dot question", () => {
  it("SPEC-ADDON-138 asks, with no target, which cards outside Unread and Recently opened are unread, 60 ids at most", async () => {
    localStorage.setItem(CLIPS_TARGET_KEY, "sf-trip");
    nav.set(`${CLIPS}?view=all&group=none`);
    serve([...clips(70, "t", { tags: ["trip"] }), ...NOT_CLIPS], { history: ["t1"] });
    render(<Page />);

    await screen.findByText("T clip 1");
    await waitFor(() => expect(server.calls.filter(isDotAsk).length).toBeGreaterThan(0));
    const asked = server.calls.filter(isDotAsk);
    for (const call of asked) {
      expect([q(call).get("by"), q(call).get("key"), q(call).get("opened"), q(call).get("per_shelf")]).toEqual(["all", "all", "false", "60"]);
      expect(q(call).getAll("tag")).toEqual([]);
      expect(q(call).getAll("ids").length).toBeLessThanOrEqual(60);
    }
    const ids = asked.flatMap((c) => q(c).getAll("ids"));
    expect(ids).toContain("t1");
    expect(ids).toContain("t60");
    expect(new Set(ids).size).toBe(ids.length);

    await reachEnd();
    await screen.findByText("T clip 61");
    await waitFor(() => expect(server.calls.filter(isDotAsk).flatMap((c) => q(c).getAll("ids"))).toContain("t61"));
    const all = server.calls.filter(isDotAsk).flatMap((c) => q(c).getAll("ids"));
    expect(all.filter((id) => id === "t1")).toHaveLength(1);
  });

  it("SPEC-ADDON-138 I4 without a profile no unread-dot question is sent, and one is once a nickname is set", async () => {
    profile.nickname = null;
    nav.set(`${CLIPS}?view=all&group=none`);
    serve([...clips(3), ...NOT_CLIPS]);
    render(<Page />);

    await screen.findByText("C clip 1");
    await act(() => settle(100));
    expect(server.calls.filter(isDotAsk)).toHaveLength(0);

    setNickname("alice");
    await waitFor(() => expect(server.calls.filter(isDotAsk).length).toBeGreaterThan(0));
  });
});

describe("SPEC-ADDON-138 step 7, I4: the unread dot on a card", () => {
  const link = (root: HTMLElement, title: string) => within(root).getByRole("link", { name: new RegExp(title) });

  it("SPEC-ADDON-138 I4 every Unread card has the dot and no Recently opened card has it; Home with a profile asks no dot question", async () => {
    serve([...clips(3), ...unverified(2), ...NOT_CLIPS], { history: ["c3", "v1", "v2"] });
    render(<Page />);

    await screen.findByText("Recently opened");
    await waitFor(() => within(shelf("Unread")).getByText("C clip 2"));
    expect(link(shelf("Unread"), "C clip 1")).toHaveAccessibleName(/Unread/);
    expect(link(shelf("Unread"), "C clip 2")).toHaveAccessibleName(/Unread/);
    expect(link(shelf("Recently opened"), "C clip 3")).not.toHaveAccessibleName(/Unread/);
    await act(() => settle(100));
    expect(server.calls.filter(isDotAsk)).toHaveLength(0);

    fireEvent.click(screen.getByRole("link", { name: "Library" }));
    await waitFor(() => expect(server.calls.filter(isDotAsk).length).toBeGreaterThan(0));
  });

  it("SPEC-ADDON-138 I4 a card the dot question returns has the dot once the answer arrives, and the others never", async () => {
    nav.set(`${CLIPS}?view=all&group=none`);
    serve([...clips(3), ...NOT_CLIPS], { history: ["c1"] });
    const gate = deferred<void>();
    server.override = (call) => (isDotAsk(call) ? gate.promise.then(() => server.answer(call)) : null);
    render(<Page />);

    await screen.findByText("C clip 3");
    await waitFor(() => expect(server.calls.filter(isDotAsk).length).toBeGreaterThan(0));
    for (const t of ["C clip 1", "C clip 2", "C clip 3"]) expect(link(document.body, t)).not.toHaveAccessibleName(/Unread/);

    await act(async () => gate.resolve());

    await waitFor(() => expect(link(document.body, "C clip 2")).toHaveAccessibleName(/Unread/));
    expect(link(document.body, "C clip 3")).toHaveAccessibleName(/Unread/);
    expect(link(document.body, "C clip 1")).not.toHaveAccessibleName(/Unread/);
  });

  it("SPEC-ADDON-138 I4 when the dot question fails no card has the dot", async () => {
    nav.set(`${CLIPS}?view=all&group=none`);
    serve([...clips(2), ...NOT_CLIPS]);
    server.override = (call) => (isDotAsk(call) ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    await screen.findByText("C clip 2");
    await waitFor(() => expect(server.calls.filter(isDotAsk).length).toBeGreaterThan(0));
    await act(() => settle());
    for (const t of ["C clip 1", "C clip 2"]) expect(link(document.body, t)).not.toHaveAccessibleName(/Unread/);
  });

  it("SPEC-ADDON-138 I4 without a profile no card has the dot", async () => {
    profile.nickname = null;
    nav.set(`${CLIPS}?view=all&group=none`);
    serve([...clips(2), ...NOT_CLIPS]);
    render(<Page />);

    await screen.findByText("C clip 2");
    await act(() => settle());
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
    for (const t of ["C clip 1", "C clip 2"]) expect(link(document.body, t)).not.toHaveAccessibleName(/Unread/);
  });
});

describe("SPEC-ADDON-138 Failure cases: the unread-dot question", () => {
  it("SPEC-ADDON-138 I4 I11 a 400 viewer_required on the dot question ends with a profile until the nickname changes", async () => {
    nav.set(`${CLIPS}?view=all&group=none`);
    serve([...clips(3), ...NOT_CLIPS]);
    server.override = (call) => (isDotAsk(call) ? new Response(JSON.stringify({ detail: "viewer_required" }), { status: 400, headers: { "content-type": "application/json" } }) : null);
    render(<Page />);

    await screen.findByText("C clip 1");
    await waitFor(() => expect(server.calls.filter(isDotAsk).length).toBeGreaterThan(0));
    await act(() => settle());
    const cut = server.calls.length;

    fireEvent.click(screen.getByRole("link", { name: "Home" }));
    expect(await screen.findByRole("heading", { level: 2, name: "New clips" })).toBeInTheDocument();
    await act(() => settle(100));
    expect(server.calls.slice(cut).filter((c) => q(c).has("opened") || isWatchHistory(c))).toHaveLength(0);

    server.override = () => null;
    setNickname("bob");
    expect(await screen.findByRole("heading", { level: 2, name: "Unread" })).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-138 step 8, I5: Mark as verified", () => {
  it("SPEC-ADDON-138 I5 writes the tier, disables the button while saving, then removes the row without reloading the shelf", async () => {
    serve([...unverified(3), ...NOT_CLIPS], { history: unverified(3).map((c) => c.id) });
    const gate = deferred<void>();
    render(<Page />);
    await waitFor(() => inUnverified().getByText("V clip 2"));
    const shelfAsks = server.calls.filter(isUnverifiedShelf).length;
    server.override = (call) => (isTrustWrite(call) ? gate.promise.then(() => server.answer(call)) : null);

    const button = markButtons()[1];
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    const writes = server.calls.filter(isTrustWrite);
    expect(writes.map((c) => [c.url.pathname, c.body])).toEqual([["/api/files/v2/trust-tier", { tier: "verified" }]]);

    await act(async () => gate.resolve());
    await waitFor(() => expect(inUnverified().queryByText("V clip 2")).toBeNull());
    expect(inUnverified().getByText("V clip 1")).toBeInTheDocument();
    expect(inUnverified().getByText("V clip 3")).toBeInTheDocument();
    expect(server.calls.filter(isUnverifiedShelf)).toHaveLength(shelfAsks);
    expect(server.calls.filter(isTrustWrite)).toHaveLength(1);
  });

  it("SPEC-ADDON-138 on failure the row stays with Couldn't save, and a second press saves", async () => {
    serve([...unverified(2), ...NOT_CLIPS], { history: unverified(2).map((c) => c.id) });
    render(<Page />);
    await waitFor(() => inUnverified().getByText("V clip 1"));
    server.override = (call) => (isTrustWrite(call) ? new Response("{}", { status: 500 }) : null);

    fireEvent.click(markButtons()[0]);

    expect(await screen.findByText("Couldn't save")).toBeInTheDocument();
    expect(inUnverified().getByText("V clip 1")).toBeInTheDocument();
    expect(markButtons()[0]).not.toBeDisabled();

    server.override = () => null;
    fireEvent.click(markButtons()[0]);
    await waitFor(() => expect(inUnverified().queryByText("V clip 1")).toBeNull());
    expect(screen.queryByText("Couldn't save")).toBeNull();
    expect(server.calls.filter(isTrustWrite).map((c) => c.url.pathname)).toEqual(["/api/files/v1/trust-tier", "/api/files/v1/trust-tier"]);
  });

  it("SPEC-ADDON-138 a shelf left with no row is not drawn, and no other face offers the button", async () => {
    serve([...clips(2), ...unverified(1), ...NOT_CLIPS], { history: ["v1"] });
    render(<Page />);
    await waitFor(() => inUnverified().getByText("V clip 1"));
    await waitFor(() => within(shelf("Unread")).getByText("C clip 1"));
    expect(within(shelf("Unread")).queryAllByRole("button", { name: "Mark as verified" })).toHaveLength(0);

    fireEvent.click(markButtons()[0]);

    await waitFor(() => expect(heading("Unverified")).toBeNull());
    expect(markButtons()).toHaveLength(0);
  });

  it("SPEC-ADDON-138 a refresh that arrives while saving neither removes nor re-adds the row; the save decides", async () => {
    serve([...unverified(2), ...NOT_CLIPS], { history: unverified(2).map((c) => c.id) });
    const gate = deferred<void>();
    render(<Page />);
    await waitFor(() => inUnverified().getByText("V clip 1"));
    server.override = (call) => (isTrustWrite(call) ? gate.promise.then(() => new Response("{}", { status: 500 })) : null);

    fireEvent.click(markButtons()[0]);
    server.files = server.files.map((c) => (c.id === "v1" ? { ...c, trust: "verified" as const } : c));
    emit("knowledge.clip.ready", { file_id: "other", job_id: 3 });
    await act(() => settle(100));
    expect(inUnverified().getByText("V clip 1")).toBeInTheDocument();

    await act(async () => gate.resolve());
    expect(await screen.findByText("Couldn't save")).toBeInTheDocument();
    expect(inUnverified().getByText("V clip 1")).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-138 step 9: a card", () => {
  it("SPEC-ADDON-138 links to the clip's file page and records nothing itself", async () => {
    nav.set(`${CLIPS}?view=all`);
    serve([{ id: "c1", title: "Curry", folder: "web/recipes", created: "2026-11-10T00:00:00Z" }, ...NOT_CLIPS]);
    render(<Page />);

    const link = (await within(await waitFor(() => shelf("Untagged"))).findByText("Curry")).closest("a")!;
    const href = hrefOf(link);
    expect(href.pathname.startsWith(`/drive/${DRIVE}`)).toBe(true);
    expect(href.searchParams.get("file")).toBe("c1");
    fireEvent.click(link);
    await act(() => settle());
    expect(server.calls.filter((c) => c.method !== "GET" && /\/api\/files\//.test(c.url.pathname))).toHaveLength(0);
  });

  it("SPEC-ADDON-138 the title falls back to the filename without its extension", async () => {
    serve([{ id: "c1", title: "", filename: "pasta-recipe.md", created: "2026-11-10T00:00:00Z" }, ...NOT_CLIPS]);
    render(<Page />);

    expect(await screen.findByText("pasta-recipe")).toBeInTheDocument();
    expect(screen.queryByText("pasta-recipe.md")).toBeNull();
  });
});

describe("SPEC-ADDON-138 Failure cases: a Home shelf", () => {
  it("SPEC-ADDON-138 a failed shelf keeps its heading with Couldn't load and Try again, and the others draw", async () => {
    serve([...clips(2), ...unverified(1), ...NOT_CLIPS], { history: ["c2"] });
    let failing = true;
    server.override = (call) => (isUnreadShelf(call) && failing ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    expect(await screen.findByText("V clip 1")).toBeInTheDocument();
    const unread = await waitFor(() => shelf("Unread"));
    expect(within(unread).getByText(/Couldn't load/)).toBeInTheDocument();
    expect(within(shelf("Recently opened")).getByText("C clip 2")).toBeInTheDocument();

    failing = false;
    fireEvent.click(within(unread).getByRole("button", { name: "Try again" }));
    expect(await within(shelf("Unread")).findByText("C clip 1")).toBeInTheDocument();
  });
});
