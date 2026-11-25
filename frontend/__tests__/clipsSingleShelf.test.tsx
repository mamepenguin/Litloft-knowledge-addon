/**
 * SPEC-ADDON-184: a Clips Library grouping whose shelves answer reports a
 * single shelf draws the None grid instead.
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
  isNewShelf,
  isShelves,
  metaNodes,
  nav,
  profile,
  q,
  reachEnd,
  resetSocket,
  setViewport,
  settle,
  smartFolder,
  type Call,
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

const Page = (await import("../pages/clips")).default;

const LIBRARY = `${CLIPS}?view=all`;
const TARGET_KEY = `litloft.addon.knowledge-clips.target.${DRIVE}`;
const VIEW_KEY = `litloft.addon.knowledge-clips.view.${DRIVE}`;
const TRIP = smartFolder("sf-trip", "Trip", "tag:trip");
const WORK = smartFolder("sf-work", "Work", "tag:work");

let server: Server;

function serve(files: Clip[]) {
  server = installClipsServer({ files, smartFolders: [TRIP, WORK] });
  return server;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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

const isGridAsk = (c: Call) => isNewShelf(c) && q(c).get("per_shelf") === "60" && q(c).get("key") === "all";
const isGroupedAsk = (c: Call) => isShelves(c) && ["tag", "folder", "month"].includes(q(c).get("by") ?? "");
const gridAsks = (from = 0) => server.calls.slice(from).filter(isGridAsk);
const groupedAsks = (from = 0) => server.calls.slice(from).filter(isGroupedAsk);
const pageOf = (c: Call) => q(c).get("page") ?? "1";
const headings = () => screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const seeAllLinks = () => screen.queryAllByRole("link", { name: /See all/ });
const cardTitles = () => screen.queryAllByText(/^[A-Z] clip \d+$/).map((n) => n.textContent);
const groupButton = () => screen.getByRole("button", { name: /Group By/ });
const storedViews = () => JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
const fail = () => new Response("{}", { status: 500 });
/** Every query parameter, order-free, plus the body: what a grid ask asks for. */
const askShape = (c: Call) => JSON.stringify([[...q(c).entries()].sort(), c.body ?? null]);

async function choose(button: RegExp, option: string | RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: button }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: option }));
}

/** 65 clips, so the grid's first page ends at 60 while a shelf shows only its first 12. */
const untagged = (n = 65) => clips(n);
const inTwoFolders = () => clips(65).map((c, i) => (i < 40 ? c : { ...c, folder: "news" }));

/** The grid is drawn: a card no shelf draws (the 13th) is on screen and no shelf heading is. */
async function gridDrawn(thirteenth = "C clip 13") {
  expect(await screen.findByText(thirteenth)).toBeInTheDocument();
  expect(headings()).toEqual([]);
}

describe("SPEC-ADDON-184 I1 one shelf draws the None grid", () => {
  type Row = [string, string, () => Clip[], string | null, string];
  const rows: Row[] = [
    ["Tag, every clip untagged", "group=tags", () => [...untagged(), ...NOT_CLIPS], null, "C clip 13"],
    ["Tag, every clip under one tag", "group=tags", () => [...clips(65, "c", { tags: ["trip"] }), ...NOT_CLIPS], null, "C clip 13"],
    ["Folder, every clip in one folder", "group=folder", () => [...untagged(), ...NOT_CLIPS], null, "C clip 13"],
    ["Date Added, every clip in one month", "group=month", () => [...untagged(), ...NOT_CLIPS], null, "C clip 13"],
    [
      "Tag under a Target, tag, state and name filters and the oldest-first sort",
      "group=tags&sort=oldest&tag=trip&trust=unverified&q=clip",
      () => [...clips(65, "c", { tags: ["trip"], trust: "unverified" }), ...clips(3, "w", { tags: ["work"] }), ...NOT_CLIPS],
      "sf-trip",
      "C clip 53",
    ],
  ];

  it.each(rows)(
    "SPEC-ADDON-184 I1 I5 %s: the same cards in the same order and the same grid asks as None, 60 then the rest on scroll",
    async (_label, query, files, target, thirteenth) => {
      const none = query.replace(/group=\w+/, "group=none");
      if (target) localStorage.setItem(TARGET_KEY, target);
      nav.set(`${LIBRARY}&${none}`);
      serve(files());
      const first = render(<Page />);
      await screen.findByText(thirteenth);
      await act(() => settle());
      const nonePage = cardTitles();
      await reachEnd();
      await waitFor(() => expect(cardTitles().length).toBe(65));
      const noneAll = cardTitles();
      const noneAsks = gridAsks().map(askShape);
      first.unmount();

      localStorage.clear();
      if (target) localStorage.setItem(TARGET_KEY, target);
      nav.set(`${LIBRARY}&${query}`);
      serve(files());
      render(<Page />);

      await gridDrawn(thirteenth);
      await act(() => settle());
      expect(nonePage).toHaveLength(60);
      expect(cardTitles()).toEqual(nonePage);
      expect(seeAllLinks()).toEqual([]);
      expect(metaNodes(/^(?![A-Z] clip)(\D*\s)?65$/)).toHaveLength(0);
      const firstGridAt = server.calls.findIndex(isGridAsk);
      const firstGroupedAt = server.calls.findIndex(isGroupedAsk);
      expect(firstGroupedAt).toBeGreaterThanOrEqual(0);
      expect(firstGroupedAt).toBeLessThan(firstGridAt);

      await reachEnd();
      await waitFor(() => expect(cardTitles().length).toBe(65));
      expect(cardTitles()).toEqual(noneAll);
      expect(gridAsks().map(askShape)).toEqual(noneAsks);
      expect(gridAsks().map(pageOf)).toEqual(["1", "2"]);
    },
  );

  it("SPEC-ADDON-184 I1 a single clip under Tag is drawn as a one-card grid with no heading or See all", async () => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...clips(1), ...NOT_CLIPS]);
    render(<Page />);

    await waitFor(() => expect(gridAsks()).toHaveLength(1));
    expect(await screen.findByText("C clip 1")).toBeInTheDocument();
    await act(() => settle());
    expect(headings()).toEqual([]);
    expect(seeAllLinks()).toEqual([]);
    expect(cardTitles()).toEqual(["C clip 1"]);
  });
});

describe("SPEC-ADDON-184 I4 the chosen grouping is kept", () => {
  it.each([
    ["tags", "Tag"],
    ["folder", "Folder"],
    ["month", "Date Added"],
  ])("SPEC-ADDON-184 I4 group=%s keeps the menu, the URL and the stored grouping while the grid is drawn", async (group, label) => {
    nav.set(`${LIBRARY}&group=${group}`);
    serve([...untagged(), ...NOT_CLIPS]);
    render(<Page />);

    await gridDrawn();
    await act(() => settle());
    expect(groupButton()).toHaveTextContent(label);
    expect(nav.params.get("group") ?? "tags").toBe(group);
    expect(nav.log.every((n) => (n.url.searchParams.get("group") ?? group) === group)).toBe(true);
    expect([undefined, group]).toContain(storedViews()?.default?.group);
    expect(server.calls.filter((c) => !["GET", "POST"].includes(c.method))).toEqual([]);
  });
});

describe("SPEC-ADDON-184 I5 the grid is asked only after a shelves answer of one", () => {
  it("SPEC-ADDON-184 I5 while the first shelves answer is on the way no grid page is asked", async () => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...untagged(), ...NOT_CLIPS]);
    const held = deferred<Response>();
    let heldCall: Call | null = null;
    server.override = (c) => {
      if (!isGroupedAsk(c) || heldCall) return null;
      heldCall = c;
      return held.promise;
    };
    render(<Page />);

    await waitFor(() => expect(heldCall).not.toBeNull());
    await act(() => settle(50));
    expect(gridAsks()).toEqual([]);

    await act(async () => held.resolve(server.answer(heldCall!)));
    await gridDrawn();
    expect(gridAsks().map(pageOf)).toEqual(["1"]);
  });

  it("SPEC-ADDON-184 I2 I5 from the grid, a grouping with two shelves draws them with their titles and counts and asks no grid page", async () => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...inTwoFolders(), ...NOT_CLIPS]);
    render(<Page />);
    await gridDrawn();
    const from = server.calls.length;

    await choose(/Group By/, "Folder");

    await waitFor(() => expect(headings()).toEqual(["web", "news"]));
    const web = screen.getByRole("heading", { level: 2, name: "web" });
    const news = screen.getByRole("heading", { level: 2, name: "news" });
    expect(within(web.closest("section") ?? web.parentElement!.parentElement!).getByText("40")).toBeInTheDocument();
    expect(within(news.closest("section") ?? news.parentElement!.parentElement!).getByText("25")).toBeInTheDocument();
    expect(seeAllLinks()).toHaveLength(2);
    await act(() => settle());
    expect(groupedAsks(from).length).toBeGreaterThan(0);
    expect(gridAsks(from)).toEqual([]);
  });

  it("SPEC-ADDON-184 I3 I5 from the grid, a state that leaves nothing draws the filtered empty state and asks no grid page", async () => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...clips(65, "c", { trust: "unverified" }), ...NOT_CLIPS]);
    render(<Page />);
    await gridDrawn();
    const from = server.calls.length;

    await choose(/^State/, "Verified");

    expect(await screen.findByText("Nothing matches these filters")).toBeInTheDocument();
    await act(() => settle());
    expect(groupedAsks(from).length).toBeGreaterThan(0);
    expect(gridAsks(from)).toEqual([]);
    expect(cardTitles()).toEqual([]);
  });

  it("SPEC-ADDON-184 I5 I7 from the grid, a failed shelves answer shows Try again and asks no grid page; Try again re-asks the shelves, then the grid", async () => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...untagged(), ...NOT_CLIPS]);
    render(<Page />);
    await gridDrawn();
    let failing = true;
    server.override = (c) => (isGroupedAsk(c) && q(c).get("sort") === "title" && failing ? fail() : null);
    const from = server.calls.length;

    await choose(/Sort By/, "Title");

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    await act(() => settle());
    expect(gridAsks(from)).toEqual([]);
    const asked = groupedAsks(from).length;

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(gridAsks(from)).toHaveLength(1));
    expect(groupedAsks(from).length).toBe(asked + 1);
    expect(q(gridAsks(from)[0]).get("sort")).toBe("title");
    const retriedAt = server.calls.indexOf(groupedAsks(from)[asked]);
    expect(server.calls.indexOf(gridAsks(from)[0])).toBeGreaterThan(retriedAt);
    expect(headings()).toEqual([]);
  });
});

describe("SPEC-ADDON-184 changed conditions ask the shelves first", () => {
  it.each<[string, () => Promise<void>, (c: Call) => boolean]>([
    ["the sort", () => choose(/Sort By/, "Title"), (c) => q(c).get("sort") === "title"],
    ["the grouping", () => choose(/Group By/, "Date Added"), (c) => q(c).get("by") === "month" || isGridAsk(c)],
    ["the Target", () => choose(/Target/, /Trip/), (c) => q(c).getAll("tag").includes("trip")],
  ])("SPEC-ADDON-184 I5 a change of %s under a single shelf asks the shelves, and the grid only after they answer", async (_label, change, carriesNew) => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...clips(65, "c", { tags: ["trip"] }), ...NOT_CLIPS]);
    render(<Page />);
    await gridDrawn();
    const from = server.calls.length;
    const held = deferred<Response>();
    let heldCall: Call | null = null;
    server.override = (c) => {
      if (!isGroupedAsk(c) || !carriesNew(c) || heldCall) return null;
      heldCall = c;
      return held.promise;
    };

    await change();

    await waitFor(() => expect(heldCall).not.toBeNull());
    await act(() => settle(50));
    expect(gridAsks(from).filter(carriesNew)).toEqual([]);

    await act(async () => held.resolve(server.answer(heldCall!)));
    await waitFor(() => expect(gridAsks(from).filter(carriesNew)).toHaveLength(1));
    expect(server.calls.indexOf(gridAsks(from).filter(carriesNew)[0])).toBeGreaterThan(server.calls.indexOf(heldCall!));
    await gridDrawn();
  });
});

describe("SPEC-ADDON-184 I6 a late shelves answer for conditions left behind", () => {
  it("SPEC-ADDON-184 I6 a late answer of two shelves does not replace the grid drawn for the current grouping", async () => {
    nav.set(`${LIBRARY}&group=folder`);
    serve([...inTwoFolders(), ...NOT_CLIPS]);
    const late = deferred<Response>();
    let lateCall: Call | null = null;
    server.override = (c) => {
      if (q(c).get("by") !== "folder" || lateCall) return null;
      lateCall = c;
      return late.promise;
    };
    render(<Page />);
    await waitFor(() => expect(lateCall).not.toBeNull());

    await choose(/Group By/, "Tag");
    await gridDrawn();

    await act(async () => late.resolve(server.answer(lateCall!)));
    await act(() => settle());
    expect(headings()).toEqual([]);
    expect(screen.getByText("C clip 13")).toBeInTheDocument();
    expect(groupButton()).toHaveTextContent("Tag");
  });

  it("SPEC-ADDON-184 I6 a late answer of one shelf neither asks the grid nor replaces the shelves drawn for the current grouping, which then reach the grid under a new sort", async () => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...inTwoFolders(), ...NOT_CLIPS]);
    const late = deferred<Response>();
    let lateCall: Call | null = null;
    server.override = (c) => {
      if (q(c).get("by") !== "tag" || lateCall) return null;
      lateCall = c;
      return late.promise;
    };
    render(<Page />);
    await waitFor(() => expect(lateCall).not.toBeNull());

    await choose(/Group By/, "Folder");
    await waitFor(() => expect(headings()).toEqual(["web", "news"]));

    await act(async () => late.resolve(server.answer(lateCall!)));
    await act(() => settle());
    expect(headings()).toEqual(["web", "news"]);
    expect(gridAsks()).toEqual([]);

    // Moving every clip into one folder makes the next answer a single shelf.
    server.files = server.files.map((c) => ({ ...c, folder: "web" }));
    await choose(/Sort By/, "Title");
    await waitFor(() => expect(gridAsks()).toHaveLength(1));
    await waitFor(() => expect(headings()).toEqual([]));
  });
});

describe("SPEC-ADDON-184 I7 the grid's own retry", () => {
  it("SPEC-ADDON-184 I7 a failed first grid page says Couldn't load; Try again re-asks only that page", async () => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...untagged(), ...NOT_CLIPS]);
    let failing = true;
    server.override = (c) => (isGridAsk(c) && pageOf(c) === "1" && failing ? fail() : null);
    render(<Page />);

    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText(/Couldn't load/)).toBeInTheDocument();
    expect(gridAsks().map(pageOf)).toEqual(["1"]);
    const shelvesAsked = groupedAsks().length;

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await gridDrawn();
    expect(gridAsks().map(pageOf)).toEqual(["1", "1"]);
    expect(groupedAsks()).toHaveLength(shelvesAsked);
  });

  it("SPEC-ADDON-184 I7 a failed later grid page keeps the cards with Try again, which re-asks only that page", async () => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...untagged(), ...NOT_CLIPS]);
    let failing = true;
    server.override = (c) => (isGridAsk(c) && pageOf(c) === "2" && failing ? fail() : null);
    render(<Page />);
    await gridDrawn();

    await reachEnd();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("C clip 60")).toBeInTheDocument();
    const shelvesAsked = groupedAsks().length;

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("C clip 65")).toBeInTheDocument();
    expect(gridAsks().map(pageOf)).toEqual(["1", "2", "2"]);
    expect(groupedAsks()).toHaveLength(shelvesAsked);
  });
});

describe("SPEC-ADDON-184 I8 a refresh never blanks what is drawn", () => {
  it("SPEC-ADDON-184 I8 grid → grid: the cards stay while the shelves and then the pages are asked again, and the new clip is merged in", async () => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...untagged(), ...NOT_CLIPS]);
    render(<Page />);
    await gridDrawn();
    await reachEnd();
    expect(await screen.findByText("C clip 65")).toBeInTheDocument();

    const shelves = deferred<Response>();
    const page = deferred<Response>();
    let shelvesCall: Call | null = null;
    let pageCall: Call | null = null;
    server.override = (c) => {
      if (isGroupedAsk(c) && !shelvesCall) {
        shelvesCall = c;
        return shelves.promise;
      }
      if (isGridAsk(c) && pageOf(c) === "1" && !pageCall) {
        pageCall = c;
        return page.promise;
      }
      return null;
    };
    const from = server.calls.length;
    server.files = [{ id: "n1", title: "N clip 1", created: "2026-11-20T00:00:00Z" }, ...server.files];

    emit("knowledge.clip.ready", { file_id: "n1", job_id: 1 });

    await waitFor(() => expect(shelvesCall).not.toBeNull());
    await act(() => settle(50));
    expect(gridAsks(from)).toEqual([]);
    expect(screen.getByText("C clip 1")).toBeInTheDocument();
    expect(screen.getByText("C clip 65")).toBeInTheDocument();

    await act(async () => shelves.resolve(server.answer(shelvesCall!)));
    await waitFor(() => expect(pageCall).not.toBeNull());
    expect(server.calls.indexOf(pageCall!)).toBeGreaterThan(server.calls.indexOf(shelvesCall!));
    expect(screen.getByText("C clip 1")).toBeInTheDocument();
    expect(screen.getByText("C clip 65")).toBeInTheDocument();
    expect(headings()).toEqual([]);

    await act(async () => page.resolve(server.answer(pageCall!)));
    expect(await screen.findByText("N clip 1")).toBeInTheDocument();
    await act(() => settle());
    expect(screen.getByText("C clip 65")).toBeInTheDocument();
    expect(headings()).toEqual([]);
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });

  it("SPEC-ADDON-184 I8 grid → shelves: an answer of two shelves draws the shelves and asks no grid page", async () => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...untagged(), ...NOT_CLIPS]);
    render(<Page />);
    await gridDrawn();
    const from = server.calls.length;
    server.files = [{ id: "n1", title: "N clip 1", created: "2026-11-20T00:00:00Z", tags: ["trip"] }, ...server.files];

    emit("knowledge.clip.ready", { file_id: "n1", job_id: 1 });

    await waitFor(() => expect(headings()).toEqual(["trip", "Untagged"]));
    await act(() => settle());
    expect(gridAsks(from)).toEqual([]);
    expect(screen.queryByText("C clip 13")).toBeNull();
  });

  it("SPEC-ADDON-184 I8 shelves → shelves: an answer of one keeps the shelves drawn and asks no grid page; the next change of conditions draws the grid", async () => {
    nav.set(`${LIBRARY}&group=tags`);
    serve([...clips(3, "t", { tags: ["trip"] }), ...untagged(), ...NOT_CLIPS]);
    render(<Page />);
    await waitFor(() => expect(headings()).toEqual(["trip", "Untagged"]));

    server.files = server.files.filter((c) => !c.id.startsWith("t"));
    emit("knowledge.clip.ready", { file_id: "c1", job_id: 1 });

    await waitFor(() => expect(groupedAsks().length).toBeGreaterThan(1));
    await act(() => settle());
    expect(headings()).toContain("Untagged");
    expect(gridAsks()).toEqual([]);

    await choose(/Sort By/, "Title");
    await waitFor(() => expect(gridAsks()).toHaveLength(1));
    await waitFor(() => expect(headings()).toEqual([]));
  });
});
