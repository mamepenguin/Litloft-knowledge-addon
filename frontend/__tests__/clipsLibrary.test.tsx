/**
 * SPEC-ADDON-139: the Clips Library and the shelf pages. Invariant ids are
 * those of docs/specs/clips-frame.md.
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
  findText,
  installClipsServer,
  emit,
  isNewShelf,
  isTagShelves,
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
  metaNodes,
  textNodes,
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

const LIBRARY = `${CLIPS}?view=all`;
const hrefOf = (a: Element) => new URL(a.getAttribute("href")!, "http://localhost");
const before = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const heading = (name: string) => screen.queryByRole("heading", { level: 2, name });
const shelfHeadings = () => screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const shelf = (name: string) => {
  const h = heading(name)!;
  return (h.closest("section") ?? h.parentElement!.parentElement!) as HTMLElement;
};
const seeAll = (name: string) => screen.getByRole("link", { name: new RegExp(`See all.*${name}`) });
const menuButton = (name: RegExp) => screen.getByRole("button", { name });
const tagged = (tag: string, n: number, prefix: string) => clips(n, prefix, { tags: [tag] });

async function choose(button: RegExp, item: string) {
  fireEvent.click(await screen.findByRole("button", { name: button }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: item }));
}

describe("SPEC-ADDON-139 step 10: Library by tag", () => {
  it("SPEC-ADDON-139 draws the two menus, and a shelf per tag, most used first, Untagged last, each with its count and See all", async () => {
    nav.set(LIBRARY);
    serve([...tagged("soup", 1, "s"), ...tagged("curry", 3, "k"), ...clips(2, "u"), ...NOT_CLIPS]);
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 2, name: "Untagged" })).toBeInTheDocument();
    expect(menuButton(/By tag/)).toBeInTheDocument();
    expect(menuButton(/Newest clipped/)).toBeInTheDocument();
    expect(shelfHeadings()).toEqual(["curry", "soup", "Untagged"]);
    expect(within(shelf("curry")).getByText("3")).toBeInTheDocument();
    expect(within(shelf("Untagged")).getByText("2")).toBeInTheDocument();
    const curry = hrefOf(seeAll("curry"));
    expect([curry.pathname, curry.searchParams.get("view"), curry.searchParams.get("shelf"), curry.searchParams.get("sort") ?? "newest"]).toEqual([
      CLIPS, "shelf", "tag:curry", "newest",
    ]);
    expect(hrefOf(seeAll("Untagged")).searchParams.get("shelf")).toBe("untagged");
    const k1 = within(shelf("curry")).getByText("K clip 1");
    expect(before(k1, within(shelf("curry")).getByText("K clip 2"))).toBe(true);

    for (const call of server.calls.filter(isTagShelves)) {
      expect(Object.fromEntries(["per_shelf", "shelf_limit", "sort", "order", "origin"].map((k) => [k, q(call).get(k)]))).toEqual({
        per_shelf: "12", shelf_limit: "12", sort: "created_at", order: "desc", origin: "webclip",
      });
      expect(q(call).getAll("type")).toEqual(["text"]);
    }
  });

  it("SPEC-ADDON-139 asks more tag shelves from offset 12 as the viewer scrolls, and a failed ask keeps the drawn shelves with Try again", async () => {
    nav.set(LIBRARY);
    const tags = Array.from({ length: 14 }, (_, i) => tagged(`tag${String(i + 1).padStart(2, "0")}`, 20 - i, `t${i + 1}x`)).flat();
    serve([...tags, ...NOT_CLIPS]);
    let failing = true;
    server.override = (call) => (isTagShelves(call) && q(call).get("offset") === "12" && failing ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    await screen.findByRole("heading", { level: 2, name: "tag12" });
    expect(heading("tag13")).toBeNull();
    await reachEnd();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(heading("tag01")).not.toBeNull();

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "tag14" })).toBeInTheDocument();
    const offsets = server.calls.filter(isTagShelves).map((c) => q(c).get("offset") ?? "0");
    expect(offsets.filter((o) => o === "12")).toHaveLength(2);
    expect(offsets.every((o) => o === "0" || o === "12")).toBe(true);
  });

  it("SPEC-ADDON-139 a failed first By tag request says Couldn't load with Try again in place of the shelves", async () => {
    nav.set(LIBRARY);
    serve([...tagged("curry", 2, "k"), ...NOT_CLIPS]);
    let failing = true;
    server.override = (call) => (isTagShelves(call) && failing ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    expect(await screen.findByText(/Couldn't load/)).toBeInTheDocument();
    expect(heading("curry")).toBeNull();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "curry" })).toBeInTheDocument();
  });

  it.each([
    ["Title", "title", "title", "asc"],
    ["Oldest clipped", "oldest", "created_at", "asc"],
  ])("SPEC-ADDON-139 sorting by %s pushes sort=%s and asks the shelves in that order", async (item, value, sort, order) => {
    nav.set(LIBRARY);
    serve([...tagged("curry", 3, "k"), ...NOT_CLIPS]);
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "curry" });
    const asked = server.calls.length;

    await choose(/Newest clipped/, item);

    expect(nav.last()?.kind).toBe("push");
    expect([nav.params.get("view"), nav.params.get("sort")]).toEqual(["all", value]);
    await waitFor(() => expect(server.calls.slice(asked).filter(isTagShelves).length).toBeGreaterThan(0));
    for (const call of server.calls.slice(asked).filter(isTagShelves)) expect([q(call).get("sort"), q(call).get("order")]).toEqual([sort, order]);
  });

  it("SPEC-ADDON-139 the Library tab links to view=all with the default menus", async () => {
    nav.set(`${LIBRARY}&group=none&sort=title`);
    serve([...clips(2), ...NOT_CLIPS]);
    render(<Page />);

    const library = hrefOf(await screen.findByRole("link", { name: "Library" }));
    expect(library.searchParams.get("view")).toBe("all");
    expect(library.searchParams.get("group") ?? "tags").toBe("tags");
    expect(library.searchParams.get("sort") ?? "newest").toBe("newest");
    expect(await screen.findByRole("button", { name: /No grouping/ })).toBeInTheDocument();
  });

  it("SPEC-ADDON-139 an unknown group or sort is read as the default and replaced in the URL", async () => {
    nav.set(`${LIBRARY}&group=shelves&sort=size`);
    serve([...tagged("curry", 2, "k"), ...NOT_CLIPS]);
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 2, name: "curry" })).toBeInTheDocument();
    expect(menuButton(/By tag/)).toBeInTheDocument();
    expect(menuButton(/Newest clipped/)).toBeInTheDocument();
    await waitFor(() => expect(nav.log.some((n) => n.kind === "replace")).toBe(true));
    expect(nav.params.get("view")).toBe("all");
    expect(nav.params.get("group") ?? "tags").toBe("tags");
    expect(nav.params.get("sort") ?? "newest").toBe("newest");
  });
});

describe("SPEC-ADDON-139 step 10: Library with no grouping (SPEC-ADDON-100 I29 as revised)", () => {
  it("SPEC-ADDON-139 I3 choosing No grouping pushes group=none and pages every clip in 60s as a grid", async () => {
    nav.set(LIBRARY);
    serve([...clips(65), ...NOT_CLIPS]);
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "Untagged" });

    await choose(/By tag/, "No grouping");

    expect(nav.last()?.kind).toBe("push");
    expect(nav.params.get("group")).toBe("none");
    expect(await screen.findByText("C clip 60")).toBeInTheDocument();
    expect(screen.queryByText("C clip 61")).toBeNull();
    await reachEnd();
    expect(await screen.findByText("C clip 65")).toBeInTheDocument();
    expect(screen.getByText("C clip 1")).toBeInTheDocument();
    const pages = server.calls.filter((c) => isNewShelf(c) && q(c).get("per_shelf") === "60");
    expect(pages.map((c) => q(c).get("page") ?? "1")).toEqual(["1", "2"]);
    for (const call of pages) expect([q(call).get("by"), q(call).get("key"), q(call).get("sort"), q(call).get("order")]).toEqual(["all", "all", "created_at", "desc"]);
    expect(screen.queryByText("picture")).toBeNull();
  });

  it("SPEC-ADDON-139 a failed first page says Couldn't load with Try again; a failed later page keeps the cards with Try again for that page", async () => {
    nav.set(`${LIBRARY}&group=none`);
    serve([...clips(65), ...NOT_CLIPS]);
    let failPage: string | null = "1";
    server.override = (call) => (isNewShelf(call) && (q(call).get("page") ?? "1") === failPage ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    expect(await screen.findByText(/Couldn't load/)).toBeInTheDocument();
    expect(screen.queryByText("C clip 1")).toBeNull();
    failPage = "2";
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("C clip 1")).toBeInTheDocument();

    await reachEnd();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("C clip 1")).toBeInTheDocument();
    failPage = null;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("C clip 65")).toBeInTheDocument();
    const pages = server.calls.filter((c) => isNewShelf(c) && q(c).get("per_shelf") === "60").map((c) => q(c).get("page") ?? "1");
    expect(pages).toEqual(["1", "1", "2", "2"]);
  });
});

describe("SPEC-ADDON-139 step 11: shelf pages", () => {
  it("SPEC-ADDON-139 I2 I3 a tag shelf page asks its tag with the Library's sort, 60 a page, shows its title and count, and links back to the Library", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=tag:curry&sort=title`);
    serve([...tagged("curry", 62, "k"), ...clips(2), ...NOT_CLIPS]);
    render(<Page />);

    // Title order is text order, so "K clip 7" closes page 1 and "K clip 8", "K clip 9" are page 2.
    expect(await screen.findByText("K clip 7")).toBeInTheDocument();
    expect(screen.queryByText("K clip 9")).toBeNull();
    expect(textNodes("curry").length).toBeGreaterThan(0);
    expect(metaNodes(/^(?![A-Z] clip)(\D*\s)?62$/).length).toBeGreaterThan(0);
    const asks = () => server.calls.filter((c) => isTagShelves(c) && q(c).get("key") === "curry");
    expect(Object.fromEntries(["per_shelf", "page", "sort", "order"].map((k) => [k, k === "page" ? (q(asks()[0]).get(k) ?? "1") : q(asks()[0]).get(k)]))).toEqual({
      per_shelf: "60", page: "1", sort: "title", order: "asc",
    });
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
    const backLink = screen.getAllByRole("link").find((a) => /‹\s*Library/.test(a.textContent ?? ""))!;
    expect(backLink).toBeDefined();
    const target = hrefOf(backLink);
    expect([target.searchParams.get("view"), target.searchParams.get("group"), target.searchParams.get("sort")]).toEqual(["all", "tags", "title"]);

    await reachEnd();
    expect(await screen.findByText("K clip 9")).toBeInTheDocument();
    expect(asks().map((c) => q(c).get("page") ?? "1")).toEqual(["1", "2"]);
    await reachEnd();
    await act(() => settle());
    expect(asks()).toHaveLength(2);
  });

  it("SPEC-ADDON-139 the Untagged shelf page asks no_tag and is titled Untagged", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=untagged`);
    serve([...tagged("curry", 2, "k"), ...clips(2, "u"), ...NOT_CLIPS]);
    render(<Page />);

    expect(await screen.findByText("U clip 1")).toBeInTheDocument();
    expect(screen.queryByText("K clip 1")).toBeNull();
    expect(textNodes("Untagged").length).toBeGreaterThan(0);
    expect(server.calls.filter((c) => isTagShelves(c) && q(c).get("key") === "no_tag").length).toBeGreaterThan(0);
  });

  it("SPEC-ADDON-139 the Unread shelf page asks opened=false 60 a page, Home is its tab, and it links back to Home", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=unread`);
    serve([...clips(3), ...NOT_CLIPS], { history: ["c3"] });
    render(<Page />);

    expect(await screen.findByText("C clip 1")).toBeInTheDocument();
    expect(screen.queryByText("C clip 3")).toBeNull();
    const ask = server.calls.filter(isUnreadShelf)[0];
    expect([q(ask).get("per_shelf"), q(ask).get("page") ?? "1"]).toEqual(["60", "1"]);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    const backLink = screen.getAllByRole("link").find((a) => /‹\s*Home/.test(a.textContent ?? ""))!;
    const target = hrefOf(backLink);
    expect([target.pathname, target.searchParams.get("view")]).toEqual([CLIPS, null]);
  });

  it("SPEC-ADDON-139 the Recently opened shelf page asks watch-history for 50, shows no count, and asks no further page", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=recent`);
    serve([...clips(3), ...NOT_CLIPS], { history: ["c2", "c1"] });
    render(<Page />);

    expect(await screen.findByText("C clip 2")).toBeInTheDocument();
    const asked = server.calls.filter(isWatchHistory);
    expect(asked.map((c) => q(c).get("limit"))).toEqual(["50"]);
    expect(textNodes("2")).toHaveLength(0);
    await reachEnd();
    await act(() => settle());
    expect(server.calls.filter(isWatchHistory)).toHaveLength(1);
  });

  it("SPEC-ADDON-139 the New clips shelf page is shown without a profile", async () => {
    profile.nickname = null;
    nav.set(`${CLIPS}?view=shelf&shelf=new`);
    serve([...clips(3), ...NOT_CLIPS]);
    render(<Page />);

    expect(await screen.findByText("C clip 3")).toBeInTheDocument();
    expect(textNodes("New clips").length).toBeGreaterThan(0);
    const ask = server.calls.filter(isNewShelf)[0];
    expect([q(ask).get("per_shelf"), q(ask).get("page") ?? "1"]).toEqual(["60", "1"]);
    expect(nav.log.filter((n) => n.kind === "replace")).toHaveLength(0);
  });

  it.each(["unread", "recent"])("SPEC-ADDON-139 without a profile the %s shelf page goes to Home (replace)", async (id) => {
    profile.nickname = null;
    nav.set(`${CLIPS}?view=shelf&shelf=${id}`);
    serve([...clips(3), ...NOT_CLIPS]);
    render(<Page />);

    await waitFor(() => expect(nav.log.some((n) => n.kind === "replace")).toBe(true));
    expect([nav.pathname, nav.params.get("view")]).toEqual([CLIPS, null]);
    expect(await screen.findByRole("heading", { level: 2, name: "New clips" })).toBeInTheDocument();
  });

  it("SPEC-ADDON-139 when the profile goes while the Unread shelf page is shown it goes to Home (replace)", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=unread`);
    serve([...clips(3), ...NOT_CLIPS]);
    render(<Page />);
    await screen.findByText("C clip 1");

    setNickname(null);

    await waitFor(() => expect(nav.last()?.kind).toBe("replace"));
    expect([nav.pathname, nav.params.get("view")]).toEqual([CLIPS, null]);
  });

  it.each([
    ["an unknown shelf id", "view=shelf&shelf=bogus"],
  ])("SPEC-ADDON-139 %s goes to Home (replace)", async (_n, query) => {
    nav.set(`${CLIPS}?${query}`);
    serve([...clips(3), ...NOT_CLIPS]);
    render(<Page />);

    await waitFor(() => expect(nav.log.some((n) => n.kind === "replace")).toBe(true));
    expect(nav.params.get("view")).toBeNull();
  });

  it("SPEC-ADDON-139 an unknown view is Home", async () => {
    nav.set(`${CLIPS}?view=gallery`);
    serve([...clips(3), ...NOT_CLIPS]);
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 2, name: "Unread" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Library" })).not.toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: /By tag/ })).toBeNull();
  });

  it("SPEC-ADDON-139 a shelf page whose first page has no clip says No clips here", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=tag:gone`);
    serve([...clips(3), ...NOT_CLIPS]);
    render(<Page />);

    expect(await screen.findByText("No clips here")).toBeInTheDocument();
    expect(screen.queryByText("No clips yet")).toBeNull();
  });

  it("SPEC-ADDON-139 a shelf page in a drive with no clip says No clips yet instead", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=tag:gone`);
    serve([...NOT_CLIPS]);
    render(<Page />);

    expect(await screen.findByText("No clips yet")).toBeInTheDocument();
    expect(screen.queryByText("No clips here")).toBeNull();
  });

  it("SPEC-ADDON-139 I3 the Unverified shelf page is a list of rows whose count drops on Mark as verified, and paging after it reaches every unverified clip", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=unverified`);
    const rows = clips(61, "v", { trust: "unverified" });
    serve([...rows, ...NOT_CLIPS], { history: rows.map((c) => c.id) });
    render(<Page />);

    expect(await screen.findByText("V clip 60")).toBeInTheDocument();
    expect(screen.queryByText("V clip 61")).toBeNull();
    expect(metaNodes(/^(?![A-Z] clip)(\D*\s)?61$/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Mark as verified" })).toHaveLength(60);

    fireEvent.click(screen.getAllByRole("button", { name: "Mark as verified" })[0]);
    await waitFor(() => expect(screen.queryByText("V clip 1")).toBeNull());
    await waitFor(() => expect(metaNodes(/^(?![A-Z] clip)(\D*\s)?60$/).length).toBeGreaterThan(0));
    expect(metaNodes(/^(?![A-Z] clip)(\D*\s)?61$/)).toHaveLength(0);

    await reachEnd();
    expect(await screen.findByText("V clip 61")).toBeInTheDocument();
    const pages = server.calls.filter((c) => isUnverifiedShelf(c)).map((c) => [q(c).get("per_shelf"), q(c).get("page") ?? "1"]);
    expect(pages).toEqual([["60", "1"], ["60", "1"]]);
    expect(screen.getAllByText(/^V clip \d+$/)).toHaveLength(60);

    await reachEnd();
    await act(() => settle());
    expect(server.calls.filter(isUnverifiedShelf)).toHaveLength(2);
    expect(server.calls.filter(isTrustWrite)).toHaveLength(1);
  });
});

describe("SPEC-ADDON-139 step 12: Library cards", () => {
  it("SPEC-ADDON-139 a Library card shows site and reading time without the age", async () => {
    nav.set(`${LIBRARY}&group=none`);
    serve([{ id: "c1", title: "Curry", size: 4500, created: "2026-11-10T00:00:00Z" }, ...NOT_CLIPS], {
      covers: { c1: { image_id: null, image_url: null, site: "cooking.example" } },
    });
    render(<Page />);

    await waitFor(() => expect(metaNodes(/^cooking\.example · 3 min$/)).toHaveLength(1));
  });
});

describe("SPEC-ADDON-139 review r1: Target conditions, Target change, refresh on the Library and shelf pages", () => {
  const TRIP_CLIPS = () => [...clips(2, "t", { tags: ["trip"] }), ...clips(2, "w", { tags: ["work"] }), ...NOT_CLIPS];
  const listing = (c: { url: URL }) => isTagShelves(c as never) || isNewShelf(c as never);

  it.each([
    ["By tag", LIBRARY],
    ["No grouping", `${LIBRARY}&group=none`],
  ])("SPEC-ADDON-139 I1 %s asks with the Target's conditions", async (_name, url) => {
    localStorage.setItem(CLIPS_TARGET_KEY, "sf-trip");
    nav.set(url);
    serve(TRIP_CLIPS());
    render(<Page />);

    await findText(`${DRIVE} · 2 clips`);
    await act(() => settle());
    const asks = server.calls.filter(listing);
    expect(asks.length).toBeGreaterThan(0);
    for (const call of asks) expect(q(call).getAll("tag")).toEqual(["trip"]);
    expect(screen.queryByText("W clip 1")).toBeNull();
  });

  it("SPEC-ADDON-139 step 4 a Target change starts the By tag shelves over under the new Target", async () => {
    localStorage.setItem(CLIPS_TARGET_KEY, "sf-trip");
    nav.set(LIBRARY);
    serve(TRIP_CLIPS());
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "trip" });

    fireEvent.click(screen.getByRole("button", { name: /Target/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Work/ }));

    expect(await screen.findByRole("heading", { level: 2, name: "work" })).toBeInTheDocument();
    await waitFor(() => expect(heading("trip")).toBeNull());
  });

  it("SPEC-ADDON-139 step 4 a Target change starts the No grouping grid over under the new Target", async () => {
    localStorage.setItem(CLIPS_TARGET_KEY, "sf-trip");
    nav.set(`${LIBRARY}&group=none`);
    serve(TRIP_CLIPS());
    render(<Page />);
    await screen.findByText("T clip 1");

    fireEvent.click(screen.getByRole("button", { name: /Target/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Work/ }));

    expect(await screen.findByText("W clip 1")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("T clip 1")).toBeNull());
  });

  it("SPEC-ADDON-138 step 5 a refresh asks every page a shelf page has drawn again, so a later page is refreshed too", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=tag:curry`);
    serve([...tagged("curry", 65, "k"), ...NOT_CLIPS]);
    render(<Page />);
    await screen.findByText("K clip 1");
    await reachEnd();
    await screen.findByText("K clip 65");
    const firstPages = () => server.calls.filter((c) => isTagShelves(c) && (q(c).get("page") ?? "1") === "1").length;
    const asked = firstPages();

    server.files = server.files.map((c) => (c.id === "k65" ? { ...c, title: "Renamed 65" } : c));

    emit("knowledge.clip.ready", { file_id: "k1", job_id: 1 });
    await waitFor(() => expect(firstPages()).toBeGreaterThan(asked));
    await act(() => settle());

    expect(screen.getByText("K clip 1")).toBeInTheDocument();
    expect(await screen.findByText("Renamed 65")).toBeInTheDocument();
    const secondPages = server.calls.filter((c) => isTagShelves(c) && q(c).get("page") === "2");
    expect(secondPages.length).toBeGreaterThanOrEqual(2);
  });
});
