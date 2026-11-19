/**
 * SPEC-ADDON-147: the Clips Library's 分類 (Tag, Folder, Date Added, None),
 * the folder and month shelf pages, and the grouping and sort remembered per
 * Target with the URL stating the view in force.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import ja from "@/messages/ja.json";
import {
  CLIPS,
  DRIVE,
  NOT_CLIPS,
  captureHistory,
  clips,
  installClipsServer,
  isShelves,
  isTagShelves,
  isNewShelf,
  nav,
  profile,
  q,
  reachEnd,
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
vi.mock("@/components/SidebarProvider", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/SidebarProvider");
  return { ...actual, useOverlaySidebar: () => undefined };
});
const member = vi.hoisted(() => ({ evaluation: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/memberTarget", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/memberTarget");
  return {
    ...actual,
    evaluateMemberTarget: (...a: unknown[]) =>
      member.evaluation ? member.evaluation() : (actual.evaluateMemberTarget as (...b: unknown[]) => unknown)(...a),
  };
});

const Page = (await import("../pages/clips")).default;

const VIEW_KEY = `litloft.addon.knowledge-clips.view.${DRIVE}`;
const TARGET_KEY = `litloft.addon.knowledge-clips.target.${DRIVE}`;
const LIBRARY = `${CLIPS}?view=all`;
const TRIP = smartFolder("sf-trip", "Trip", "tag:trip");
const WORK = smartFolder("sf-work", "Work", "tag:work");

let server: Server;

function serve(files: Clip[], extra: Parameters<typeof installClipsServer>[0] = {}) {
  server = installClipsServer({ files, smartFolders: [TRIP, WORK], ...extra });
  return server;
}

/** Clips in three folders and two months: web (3, one in web/recipes), news (2), the root (1). */
const SPREAD: Clip[] = [
  { id: "w1", title: "Web one", folder: "web", created: "2026-11-10T09:00:00Z", tags: ["trip"] },
  { id: "w2", title: "Web two", folder: "web", created: "2026-11-09T09:00:00Z" },
  { id: "w3", title: "Recipe one", folder: "web/recipes", created: "2026-10-09T09:00:00Z", tags: ["trip"] },
  { id: "n1", title: "News one", folder: "news", created: "2026-10-08T09:00:00Z", tags: ["work"] },
  { id: "n2", title: "News two", folder: "news", created: "2026-10-07T09:00:00Z" },
  { id: "r1", title: "Root one", folder: "", created: "2026-11-01T09:00:00Z" },
];

beforeEach(() => {
  localStorage.clear();
  member.evaluation = null;
  nav.set(CLIPS);
  profile.nickname = "alice";
  resetSocket();
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const hrefOf = (a: Element) => new URL(a.getAttribute("href")!, "http://localhost");
const shelfHeadings = () => screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const groupButton = () => screen.getByRole("button", { name: /Group By/ });
const sortButton = () => screen.getByRole("button", { name: /Sort By/ });
const storedViews = () => JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
const byShelves = (by: string) => (c: Parameters<typeof isShelves>[0]) => isShelves(c) && q(c).get("by") === by;
const listing = (c: Parameters<typeof isShelves>[0]) =>
  (isShelves(c) && ["tag", "folder", "month"].includes(q(c).get("by") ?? "")) || (isNewShelf(c) && q(c).get("per_shelf") === "60");

async function choose(button: () => HTMLElement, option: string) {
  await waitFor(() => expect(button()).toBeInTheDocument());
  fireEvent.click(button());
  fireEvent.click(await screen.findByRole("menuitemradio", { name: option }));
}

async function chooseTarget(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /Target/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: new RegExp(name) }));
}

describe("SPEC-ADDON-147 the 分類 and 並び順 menus", () => {
  it("SPEC-ADDON-147 I15 I9 Group By lists Tag, Folder, Date Added and None; Sort By lists the Date Added pair and Title", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest`);
    serve(SPREAD);
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "trip" });

    fireEvent.click(groupButton());
    expect((await screen.findAllByRole("menuitemradio")).map((o) => o.textContent?.trim())).toEqual([
      "Tag",
      "Folder",
      "Date Added",
      "None",
    ]);
    fireEvent.keyDown(groupButton(), { key: "Escape" });
    fireEvent.click(sortButton());
    expect((await screen.findAllByRole("menuitemradio")).map((o) => o.textContent?.trim())).toEqual([
      "Date Added (Newest First)",
      "Date Added (Oldest First)",
      "Title",
    ]);
  });

  it("SPEC-ADDON-147 I12 Group By draws LayoutList and Sort By ArrowDownUp, each with its label, grouping first", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest`);
    serve(SPREAD);
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "trip" });

    const group = groupButton();
    const sort = sortButton();
    expect(group).toHaveTextContent("Group By");
    expect(group).toHaveTextContent("Tag");
    expect(sort).toHaveTextContent("Sort By");
    expect(sort).toHaveTextContent("Date Added (Newest First)");
    expect(group.querySelector("svg")?.getAttribute("class")).toContain("lucide-layout-list");
    expect(sort.querySelector("svg")?.getAttribute("class")).toContain("lucide-arrow-down-up");
    expect(group.compareDocumentPosition(sort) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["knowledge.clips", "knowledge.notesLibrary"])("SPEC-ADDON-147 SPEC-ADDON-148 I9 no %s message in Japanese uses retired wording", (ns) => {
    const retired = ["まとめ方", "並べ替え", "分類の軸", "タグ別", "まとめない", "クリップした順", "最後に開いた順", "追加した月"];
    const tree = ns.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k], ja);
    const flat = (t: unknown, p = ""): Array<[string, string]> =>
      Object.entries(t as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "string" ? [[`${p}${k}`, v] as [string, string]] : flat(v, `${p}${k}.`),
      );
    expect(flat(tree).filter(([, v]) => retired.some((w) => v.includes(w)))).toEqual([]);
  });
});

describe("SPEC-ADDON-147 Library by Folder and by Date Added", () => {
  it("SPEC-ADDON-147 Folder asks by=folder like By tag, under the clip conditions, in the server's order, the root titled with the drive name", async () => {
    nav.set(`${LIBRARY}&group=folder&sort=newest`);
    serve([...SPREAD, ...NOT_CLIPS]);
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 2, name: "web" })).toBeInTheDocument();
    expect(shelfHeadings()).toEqual(["web", "news", DRIVE]);
    const asks = server.calls.filter(byShelves("folder"));
    expect(asks.length).toBeGreaterThan(0);
    for (const call of asks) {
      expect(["per_shelf", "shelf_limit", "origin", "sort", "order"].map((k) => q(call).get(k))).toEqual([
        "12",
        "12",
        "webclip",
        "created_at",
        "desc",
      ]);
      expect(q(call).getAll("type")).toEqual(["text"]);
    }
    expect(screen.queryByText("A note")).toBeNull();
  });

  it("SPEC-ADDON-147 I14 every Folder shelf's See all opens folder:<key> with the Library's sort", async () => {
    nav.set(`${LIBRARY}&group=folder&sort=title`);
    serve(SPREAD);
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "web" });

    const links = screen.getAllByRole("link", { name: /See all/ }).map(hrefOf);
    expect(links.map((u) => [u.searchParams.get("view"), u.searchParams.get("shelf"), u.searchParams.get("sort")])).toEqual([
      ["shelf", "folder:web", "title"],
      ["shelf", "folder:news", "title"],
      ["shelf", "folder:", "title"],
    ]);
  });

  it("SPEC-ADDON-147 Date Added asks by=month newest first and See all opens month:<YYYY-MM>", async () => {
    nav.set(`${LIBRARY}&group=month&sort=oldest`);
    serve(SPREAD);
    render(<Page />);

    await waitFor(() => expect(shelfHeadings()).toHaveLength(2));
    const asks = server.calls.filter(byShelves("month"));
    expect(asks.length).toBeGreaterThan(0);
    for (const call of asks) expect([q(call).get("sort"), q(call).get("order"), q(call).get("origin")]).toEqual(["created_at", "asc", "webclip"]);
    const links = screen.getAllByRole("link", { name: /See all/ }).map(hrefOf);
    expect(links.map((u) => [u.searchParams.get("shelf"), u.searchParams.get("sort")])).toEqual([
      ["month:2026-11", "oldest"],
      ["month:2026-10", "oldest"],
    ]);
  });

  it("SPEC-ADDON-147 Folder under a Target asks with the Target's conditions", async () => {
    localStorage.setItem(TARGET_KEY, "sf-trip");
    nav.set(`${LIBRARY}&group=folder&sort=newest`);
    serve(SPREAD);
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 2, name: "web" })).toBeInTheDocument();
    await act(() => settle());
    expect(shelfHeadings()).toEqual(["web"]);
    for (const call of server.calls.filter(byShelves("folder"))) expect(q(call).getAll("tag")).toEqual(["trip"]);
  });

  it("SPEC-ADDON-147 I7 every clip is reached through the page of exactly one Folder shelf", async () => {
    nav.set(`${LIBRARY}&group=folder&sort=newest`);
    serve(SPREAD);
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "web" });

    const seeAll = screen.getAllByRole("link", { name: /See all/ }).map((a) => hrefOf(a).search);
    const reached: string[] = [];
    for (const search of seeAll) {
      cleanup();
      nav.set(`${CLIPS}${search}`);
      render(<Page />);
      await act(() => settle());
      await reachEnd();
      await act(() => settle());
      reached.push(...SPREAD.filter((c) => screen.queryByText(c.title) !== null).map((c) => c.id));
    }
    expect([...reached].sort()).toEqual(SPREAD.map((c) => c.id).sort());
  });

  it("SPEC-ADDON-147 a failed first Folder request shows Couldn't load with Try again", async () => {
    nav.set(`${LIBRARY}&group=folder&sort=newest`);
    serve(SPREAD);
    let failing = true;
    server.override = (call) => (byShelves("folder")(call) && failing ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    expect(await screen.findByText(/Couldn't load/)).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "web" })).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-147 I14 the folder and month shelf pages", () => {
  it("SPEC-ADDON-147 a folder shelf page asks its key with the URL sort, 60 a page, titled by the last segment, back to group=folder", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=folder:web%2Frecipes&sort=title`);
    serve(SPREAD);
    render(<Page />);

    expect(await screen.findByText("Recipe one")).toBeInTheDocument();
    expect(screen.queryByText("Web one")).toBeNull();
    expect(screen.getByRole("heading", { name: /recipes/ })).toBeInTheDocument();
    const ask = server.calls.find((c) => byShelves("folder")(c) && q(c).get("key") === "web/recipes")!;
    expect(["per_shelf", "sort", "order"].map((k) => q(ask).get(k))).toEqual(["60", "title", "asc"]);
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
    const back = screen.getAllByRole("link").find((a) => /‹\s*Library/.test(a.textContent ?? ""))!;
    expect(["view", "group", "sort"].map((k) => hrefOf(back).searchParams.get(k))).toEqual(["all", "folder", "title"]);
  });

  it("SPEC-ADDON-147 a trailing slash key reaches only the clips directly in that folder", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=folder:web%2F&sort=newest`);
    serve(SPREAD);
    render(<Page />);

    expect(await screen.findByText("Web one")).toBeInTheDocument();
    expect(screen.queryByText("Recipe one")).toBeNull();
    expect(server.calls.some((c) => byShelves("folder")(c) && q(c).get("key") === "web/")).toBe(true);
  });

  it("SPEC-ADDON-147 folder: with an empty key opens the drive root's shelf page", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=folder:&sort=newest`);
    serve(SPREAD);
    render(<Page />);

    expect(await screen.findByText("Root one")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: new RegExp(`^${DRIVE}`) })).toBeInTheDocument();
    expect(server.calls.some((c) => byShelves("folder")(c) && q(c).get("key") === "")).toBe(true);
  });

  it("SPEC-ADDON-147 a month shelf page carries the Library shelf's heading and links back to group=month", async () => {
    nav.set(`${LIBRARY}&group=month&sort=newest`);
    serve(SPREAD);
    render(<Page />);
    await waitFor(() => expect(shelfHeadings()).toHaveLength(2));
    const libraryTitle = shelfHeadings()[0]!;
    const link = hrefOf(screen.getAllByRole("link", { name: /See all/ })[0]);
    cleanup();

    nav.set(`${CLIPS}${link.search}`);
    render(<Page />);

    expect(await screen.findByText("Web one")).toBeInTheDocument();
    expect(screen.queryByText("News one")).toBeNull();
    expect(screen.getByRole("heading", { name: new RegExp(`^${libraryTitle}`) })).toBeInTheDocument();
    const back = screen.getAllByRole("link").find((a) => /‹\s*Library/.test(a.textContent ?? ""))!;
    expect(["view", "group", "sort"].map((k) => hrefOf(back).searchParams.get(k))).toEqual(["all", "month", "newest"]);
  });

  it.each(["month:2026-3", "month:", "month:soon"])("SPEC-ADDON-147 I14 shelf=%s is an unknown shelf and goes to Home by replace, while a YYYY-MM key opens", async (shelf) => {
    nav.set(`${CLIPS}?view=shelf&shelf=month:2026-11&sort=newest`);
    serve(SPREAD);
    render(<Page />);
    expect(await screen.findByText("Web one")).toBeInTheDocument();
    expect(screen.queryByText("News one")).toBeNull();
    expect(nav.params.get("shelf")).toBe("month:2026-11");
    cleanup();

    nav.set(`${CLIPS}?view=shelf&shelf=${encodeURIComponent(shelf)}&sort=newest`);
    server.calls.length = 0;
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 2, name: "Unread" })).toBeInTheDocument();
    expect(nav.log.some((n) => n.kind === "replace")).toBe(true);
    expect(nav.params.get("view")).not.toBe("shelf");
    expect(server.calls.some(byShelves("month"))).toBe(false);
  });

  it.each(["folder:gone", "month:2020-01"])("SPEC-ADDON-147 I14 %s with no clip says No clips here", async (shelf) => {
    nav.set(`${CLIPS}?view=shelf&shelf=${encodeURIComponent(shelf)}&sort=newest`);
    serve(SPREAD);
    render(<Page />);

    expect(await screen.findByText("No clips here")).toBeInTheDocument();
    expect(server.calls.some((c) => byShelves(shelf.split(":")[0])(c) && q(c).get("key") === shelf.split(":")[1])).toBe(true);
  });
});

describe("SPEC-ADDON-147 the view in force and the URL", () => {
  it("SPEC-ADDON-147 I11 I13 a Library URL without group or sort is filled in by replace with the Target's stored view, before any listing request", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ default: { group: "folder", sort: "title" } }));
    nav.set(LIBRARY);
    serve(SPREAD);
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 2, name: "web" })).toBeInTheDocument();
    await waitFor(() => expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["folder", "title"]));
    expect(nav.log.every((n) => n.kind === "replace")).toBe(true);
    expect(nav.log).toHaveLength(1);
    const listings = server.calls.filter(listing);
    expect(listings.length).toBeGreaterThan(0);
    for (const call of listings) expect([q(call).get("by"), q(call).get("sort")]).toEqual(["folder", "title"]);
    expect(storedViews()).toEqual({ default: { group: "folder", sort: "title" } });
  });

  it("SPEC-ADDON-147 I11 with nothing stored the URL is completed with the app defaults", async () => {
    nav.set(LIBRARY);
    serve(SPREAD);
    render(<Page />);

    await screen.findByRole("heading", { level: 2, name: "trip" });
    await waitFor(() => expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["tags", "newest"]));
    expect(nav.last()?.kind).toBe("replace");
    expect(localStorage.getItem(VIEW_KEY)).toBeNull();
  });

  it("SPEC-ADDON-147 I3 I13 a readable URL wins over the stored view, is left as it is, and writes nothing", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ default: { group: "folder", sort: "title" } }));
    nav.set(`${LIBRARY}&group=none&sort=oldest`);
    serve(SPREAD);
    render(<Page />);

    expect(await screen.findByText("News two")).toBeInTheDocument();
    await act(() => settle());
    expect(groupButton()).toHaveTextContent("None");
    expect(nav.log).toEqual([]);
    expect(server.calls.some(byShelves("folder"))).toBe(false);
    expect(storedViews()).toEqual({ default: { group: "folder", sort: "title" } });
  });

  it("SPEC-ADDON-147 an unknown group is replaced by the Target's stored grouping, not the app default", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ default: { group: "month" } }));
    nav.set(`${LIBRARY}&group=shelves&sort=title`);
    serve(SPREAD);
    render(<Page />);

    await waitFor(() => expect(nav.params.get("group")).toBe("month"));
    expect(nav.params.get("sort")).toBe("title");
    expect(nav.log.every((n) => n.kind === "replace")).toBe(true);
    expect(server.calls.some((c) => q(c).get("by") === "shelves")).toBe(false);
  });

  it("SPEC-ADDON-147 I1 choosing a grouping pushes it and writes it for the Target in force only", async () => {
    localStorage.setItem(VIEW_KEY, '{"sf-work":{"sort":"title"}}');
    nav.set(`${LIBRARY}&group=tags&sort=newest`);
    serve(SPREAD);
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "trip" });

    await choose(groupButton, "Folder");

    expect(nav.last()?.kind).toBe("push");
    expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["folder", "newest"]);
    expect(await screen.findByRole("heading", { level: 2, name: "web" })).toBeInTheDocument();
    expect(storedViews()).toEqual({ "sf-work": { sort: "title" }, default: { group: "folder" } });
    expect(localStorage.getItem(`litloft.addon.knowledge.view.${DRIVE}`)).toBeNull();
    expect(localStorage.getItem(`litloft.addon.knowledge.classification.${DRIVE}`)).toBeNull();
  });

  it("SPEC-ADDON-147 choosing the value already shown stores it and pushes nothing", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest`);
    serve(SPREAD);
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "trip" });

    await choose(groupButton, "Tag");
    await choose(sortButton, "Date Added (Newest First)");

    await waitFor(() => expect(storedViews()).toEqual({ default: { group: "tags", sort: "newest" } }));
    expect(nav.log.filter((n) => n.kind === "push")).toEqual([]);
  });

  it("SPEC-ADDON-147 I4 I13 a Target change replaces the Library URL with the new Target's view, and each Target keeps its own", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest`);
    serve(SPREAD);
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "trip" });
    await choose(groupButton, "Date Added");
    await waitFor(() => expect(nav.params.get("group")).toBe("month"));

    const before = nav.log.length;
    await chooseTarget("Work");
    await waitFor(() => expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["tags", "newest"]));
    expect(nav.log.slice(before).map((n) => n.kind)).toEqual(["replace"]);
    await choose(groupButton, "None");
    await waitFor(() => expect(nav.params.get("group")).toBe("none"));

    await chooseTarget("All clips");
    await waitFor(() => expect(nav.params.get("group")).toBe("month"));

    await chooseTarget("Work");
    await waitFor(() => expect(nav.params.get("group")).toBe("none"));
    expect(storedViews()).toEqual({ default: { group: "month" }, "sf-work": { group: "none" } });
  });

  it("SPEC-ADDON-147 a Target change on a shelf page keeps the shelf and takes the new Target's sort, adding no history entry", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ "sf-work": { sort: "oldest" } }));
    nav.set(`${CLIPS}?view=shelf&shelf=tag:trip&sort=title`);
    serve(SPREAD);
    render(<Page />);
    await screen.findByText("Web one");

    await chooseTarget("Work");

    await waitFor(() => expect(nav.params.get("sort")).toBe("oldest"));
    expect(nav.params.get("shelf")).toBe("tag:trip");
    expect(nav.log.filter((n) => n.kind === "push")).toEqual([]);
    expect(storedViews()).toEqual({ "sf-work": { sort: "oldest" } });
  });

  it("SPEC-ADDON-147 I19 choosing the Target already in force leaves the URL and the view", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ default: { group: "folder", sort: "title" } }));
    nav.set(`${LIBRARY}&group=folder&sort=title`);
    serve(SPREAD);
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "web" });

    await chooseTarget("All clips");
    await act(() => settle());

    expect(nav.log).toEqual([]);
    expect(groupButton()).toHaveTextContent("Folder");
  });

  it("SPEC-ADDON-147 I6 a saved Target that is gone reads and writes the default Target's view and stays stored", async () => {
    localStorage.setItem(TARGET_KEY, "sf-gone");
    localStorage.setItem(VIEW_KEY, JSON.stringify({ "sf-gone": { group: "none" }, default: { group: "folder" } }));
    nav.set(LIBRARY);
    serve(SPREAD);
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 2, name: "web" })).toBeInTheDocument();
    await waitFor(() => expect(nav.params.get("group")).toBe("folder"));
    await choose(sortButton, "Title");

    await waitFor(() =>
      expect(storedViews()).toEqual({ "sf-gone": { group: "none" }, default: { group: "folder", sort: "title" } }),
    );
    expect(localStorage.getItem(TARGET_KEY)).toBe("sf-gone");
  });

  it.each([
    ["a saved Target", "sf-work"],
    ["a saved Target that is gone", "sf-gone"],
  ])("SPEC-ADDON-147 I13 on first load under %s a readable group and sort are left as they are and followed", async (_name, target) => {
    localStorage.setItem(TARGET_KEY, target);
    localStorage.setItem(VIEW_KEY, JSON.stringify({ [target]: { group: "month", sort: "title" }, default: { group: "none" } }));
    nav.set(`${LIBRARY}&group=folder&sort=oldest`);
    serve(SPREAD);
    render(<Page />);

    await waitFor(() => expect(server.calls.some(byShelves("folder"))).toBe(true));
    await act(() => settle());
    expect(nav.log).toEqual([]);
    for (const call of server.calls.filter(listing)) {
      expect([q(call).get("by"), q(call).get("sort"), q(call).get("order")]).toEqual(["folder", "created_at", "asc"]);
    }
    expect(groupButton()).toHaveTextContent("Folder");
  });

  it.each(["tooLarge", "failed"])("SPEC-ADDON-147 I6 a member Target that answers %s reads and writes the default Target's view", async (status) => {
    localStorage.setItem(TARGET_KEY, "sf-beach");
    localStorage.setItem(VIEW_KEY, JSON.stringify({ "sf-beach": { group: "none" }, default: { group: "month", sort: "title" } }));
    member.evaluation = async () => ({ status });
    nav.set(LIBRARY);
    serve(SPREAD, { smartFolders: [smartFolder("sf-beach", "Beach", "beach")] });
    render(<Page />);

    await waitFor(() => expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["month", "title"]));
    await choose(sortButton, "Date Added (Oldest First)");

    await waitFor(() =>
      expect(storedViews()).toEqual({ "sf-beach": { group: "none" }, default: { group: "month", sort: "oldest" } }),
    );
    expect(localStorage.getItem(TARGET_KEY)).toBe("sf-beach");
  });

  it("SPEC-ADDON-147 I2 a shelf page's sort and opening a link write no view", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ default: { sort: "title" } }));
    nav.set(`${CLIPS}?view=shelf&shelf=folder:web&sort=oldest`);
    serve(SPREAD);
    render(<Page />);

    expect(await screen.findByText("Web one")).toBeInTheDocument();
    await act(() => settle());
    expect(localStorage.getItem(VIEW_KEY)).toBe('{"default":{"sort":"title"}}');
    expect(server.calls.some((c) => byShelves("folder")(c) && q(c).get("sort") === "created_at" && q(c).get("order") === "asc")).toBe(true);
  });

  it("SPEC-ADDON-147 I5 with storage throwing, the Library opens on the defaults and a choice stays shown", async () => {
    nav.set(LIBRARY);
    serve(SPREAD);
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      render(<Page />);
      await screen.findByRole("heading", { level: 2, name: "trip" });
      await waitFor(() => expect(nav.params.get("group")).toBe("tags"));

      await choose(groupButton, "Folder");

      expect(await screen.findByRole("heading", { level: 2, name: "web" })).toBeInTheDocument();
      expect(groupButton()).toHaveTextContent("Folder");
    } finally {
      Storage.prototype.getItem = getItem;
      Storage.prototype.setItem = setItem;
    }
  });

  it("SPEC-ADDON-147 the Library tab, without group or sort, opens on the Target's stored view", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ default: { group: "month", sort: "oldest" } }));
    nav.set(CLIPS);
    serve(SPREAD);
    render(<Page />);

    fireEvent.click(await screen.findByRole("link", { name: "Library" }));

    await waitFor(() => expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["month", "oldest"]));
    await waitFor(() => expect(server.calls.some(byShelves("month"))).toBe(true));
    expect(server.calls.filter(isTagShelves)).toEqual([]);
  });
});
