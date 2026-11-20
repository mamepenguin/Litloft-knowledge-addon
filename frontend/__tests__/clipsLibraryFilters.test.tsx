/**
 * SPEC-ADDON-151: the Clips Library's tag and state filters, held in the URL
 * as `tag` (repeated) and `trust`, and carried by every Library request and
 * Library-origin shelf page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import {
  CLIPS,
  DRIVE,
  captureHistory,
  installClipsServer,
  isDotAsk,
  isNewShelf,
  isShelves,
  nav,
  profile,
  q,
  resetSocket,
  setViewport,
  settle,
  smartFolder,
  type Call,
  type Clip,
  type Server,
} from "./clipsAppHarness";
import { json } from "@/__tests__/helpers/wireFetch";

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
const WORK = smartFolder("sf-work", "Work", "tag:work");

const FILES: Clip[] = [
  { id: "w1", title: "Web one", folder: "web", created: "2026-11-10T09:00:00Z", tags: ["trip"], trust: "verified" },
  { id: "w2", title: "Web two", folder: "web", created: "2026-11-09T09:00:00Z", tags: ["trip"], trust: "unverified" },
  { id: "w3", title: "Recipe one", folder: "web/recipes", created: "2026-10-09T09:00:00Z", tags: ["food"], trust: "verified" },
  { id: "n1", title: "News one", folder: "news", created: "2026-10-08T09:00:00Z", tags: ["work", "trip"], trust: "verified" },
  { id: "r1", title: "Root one", folder: "", created: "2026-11-01T09:00:00Z", trust: "unverified" },
];

let server: Server;
let tagCounts: Call[];

const isTagCounts = (c: Call) => c.url.pathname.startsWith(`/api/drives/${DRIVE}/tag-counts`);

function serve(files: Clip[] = FILES, extra: Parameters<typeof installClipsServer>[0] = {}) {
  server = installClipsServer({ files, smartFolders: [WORK], ...extra });
  tagCounts = [];
  server.override = (call) => {
    if (!isTagCounts(call)) return null;
    tagCounts.push(call);
    return json([
      { name: "trip", count: 3 },
      { name: "food", count: 1 },
      { name: "work", count: 1 },
    ]);
  };
  return server;
}

const hrefOf = (a: Element) => new URL(a.getAttribute("href")!, "http://localhost");
const tagButton = () => screen.getByRole("button", { name: /^Tag/ });
const stateButton = () => screen.getByRole("button", { name: /^State/ });
const groupButton = () => screen.getByRole("button", { name: /Group By/ });
const sortButton = () => screen.getByRole("button", { name: /Sort By/ });
const listing = (c: Call) =>
  (isShelves(c) && ["tag", "folder", "month"].includes(q(c).get("by") ?? "")) ||
  (isNewShelf(c) && q(c).get("per_shelf") === "60");
const backLink = (to: "Library" | "Home") =>
  screen.getAllByRole("link").find((a) => new RegExp(`‹\\s*${to}`).test(a.textContent ?? ""))!;

async function libraryDrawn() {
  await waitFor(() => expect(server.calls.some(listing)).toBe(true));
  await act(() => settle());
}

/** The Library under the same URL filters applies them; the Home-side tests contrast against it. */
async function libraryApplies(filters: string) {
  nav.set(`${LIBRARY}&group=tags&sort=newest&${filters}`);
  serve();
  const view = render(<Page />);
  await libraryDrawn();
  const asks = server.calls.filter(listing);
  expect(asks.length).toBeGreaterThan(0);
  for (const call of asks) expect(q(call).getAll("tag")).toEqual(["trip"]);
  view.unmount();
}

async function choose(button: () => HTMLElement, option: string) {
  await waitFor(() => expect(button()).toBeInTheDocument());
  fireEvent.click(button());
  fireEvent.click(await screen.findByRole("menuitemradio", { name: option }));
}

async function chooseTarget(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /Target/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: new RegExp(name) }));
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

describe("SPEC-ADDON-151 the Library's filter menus", () => {
  it.each([
    ["with a profile", "alice"],
    ["without a profile", null],
  ])("SPEC-ADDON-151 draws Tag and State before Group By and Sort By, %s", async (_label, nickname) => {
    profile.nickname = nickname;
    nav.set(`${LIBRARY}&group=tags&sort=newest`);
    serve();
    render(<Page />);
    await libraryDrawn();

    const order = [tagButton(), stateButton(), groupButton(), sortButton()];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("SPEC-ADDON-151 I11 the State menu offers All, Unverified and Verified", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest`);
    serve();
    render(<Page />);
    await libraryDrawn();

    fireEvent.click(stateButton());

    expect((await screen.findAllByRole("menuitemradio")).map((o) => o.textContent?.trim())).toEqual([
      "All",
      "Unverified",
      "Verified",
    ]);
  });

  it.each([
    ["Unverified", "unverified"],
    ["Verified", "verified"],
  ])("SPEC-ADDON-151 I11 I5 choosing %s replaces the URL with trust=%s and every listing request carries it", async (label, trust) => {
    nav.set(`${LIBRARY}&group=tags&sort=newest`);
    serve();
    render(<Page />);
    await libraryDrawn();
    const before = server.calls.length;

    await choose(stateButton, label);

    await waitFor(() => expect(nav.params.get("trust")).toBe(trust));
    expect(nav.log.map((n) => n.kind)).toEqual(["replace"]);
    expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["tags", "newest"]);
    await waitFor(() => expect(server.calls.slice(before).some(listing)).toBe(true));
    await act(() => settle());
    for (const call of server.calls.filter(listing).slice(-1)) expect(q(call).get("trust")).toBe(trust);
  });

  it("SPEC-ADDON-151 I5 All removes trust from the URL by replace", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&trust=verified`);
    serve();
    render(<Page />);
    await libraryDrawn();

    await choose(stateButton, "All");

    await waitFor(() => expect(nav.params.has("trust")).toBe(false));
    expect(nav.log.every((n) => n.kind === "replace")).toBe(true);
  });

  it("SPEC-ADDON-151 I5 choosing tags appends them to the URL in choice order by replace, with no push", async () => {
    nav.set(`${LIBRARY}&group=folder&sort=newest`);
    serve();
    render(<Page />);
    await libraryDrawn();

    fireEvent.click(tagButton());
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: /food/ }));
    await waitFor(() => expect(nav.params.getAll("tag")).toEqual(["food"]));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: /trip/ }));
    await waitFor(() => expect(nav.params.getAll("tag")).toEqual(["food", "trip"]));

    expect(nav.log.filter((n) => n.kind === "push")).toEqual([]);
    expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["folder", "newest"]);
  });

  it("SPEC-ADDON-151 the tag-counts request carries the clip conditions, the state and the chosen tags", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&trust=verified&tag=trip`);
    serve();
    render(<Page />);
    await libraryDrawn();

    fireEvent.click(tagButton());
    await waitFor(() => expect(tagCounts).toHaveLength(1));

    const sent = q(tagCounts[0]);
    expect(sent.get("trust")).toBe("verified");
    expect(sent.getAll("tag")).toEqual(["trip"]);
    expect(sent.get("origin")).toBe("webclip");
    expect(sent.getAll("type")).toEqual(["text"]);
  });
});

describe("SPEC-ADDON-151 I12 tag-counts under a member Target", () => {
  it("SPEC-ADDON-151 I12 posts the Target's members to tag-counts/query, the same members the Library posts", async () => {
    localStorage.setItem(`litloft.addon.knowledge-clips.target.${DRIVE}`, "sf-cats");
    nav.set(`${LIBRARY}&group=tags&sort=newest&trust=verified`);
    serve(FILES, { smartFolders: [WORK, smartFolder("sf-cats", "Cats", "cats")] });
    render(<Page />);
    const libraryPost = (c: Call) => listing(c) && c.url.pathname.endsWith("/shelves/query");
    await waitFor(() => expect(server.calls.some(libraryPost)).toBe(true));
    await act(() => settle());

    fireEvent.click(tagButton());
    await waitFor(() => expect(tagCounts).toHaveLength(1));

    const members = (server.calls.find(libraryPost)!.body as { file_ids: string[] }).file_ids;
    const sent = tagCounts[0];
    expect(sent.method).toBe("POST");
    expect(sent.url.pathname).toBe(`/api/drives/${DRIVE}/tag-counts/query`);
    expect(new Set((sent.body as { file_ids: string[] }).file_ids)).toEqual(new Set(members));
    expect(q(sent).get("trust")).toBe("verified");
  });
});

describe("SPEC-ADDON-151 I4 every Library request carries the URL's filters", () => {
  it.each(["tags", "folder", "month", "none"])("SPEC-ADDON-151 I4 group=%s", async (group) => {
    nav.set(`${LIBRARY}&group=${group}&sort=newest&tag=trip&tag=web&trust=verified`);
    serve();
    render(<Page />);
    await libraryDrawn();

    const asks = server.calls.filter(listing);
    expect(asks.length).toBeGreaterThan(0);
    for (const call of asks) {
      expect(q(call).getAll("tag")).toEqual(["trip", "web"]);
      expect(q(call).get("trust")).toBe("verified");
    }
  });

  it("SPEC-ADDON-151 I4 every item shown carries the tags and matches the state", async () => {
    nav.set(`${LIBRARY}&group=none&sort=newest&tag=trip&trust=verified`);
    serve();
    render(<Page />);

    expect(await screen.findByText("Web one")).toBeInTheDocument();
    expect(screen.getByText("News one")).toBeInTheDocument();
    for (const title of ["Web two", "Recipe one", "Root one"]) expect(screen.queryByText(title)).toBeNull();
  });

  it.each(["tags", "folder", "month"])("SPEC-ADDON-151 I4 every See all link under group=%s carries tag and trust", async (group) => {
    nav.set(`${LIBRARY}&group=${group}&sort=newest&tag=trip&trust=verified`);
    serve();
    render(<Page />);
    await libraryDrawn();

    const links = (await screen.findAllByRole("link", { name: /See all/ })).map(hrefOf);
    expect(links.length).toBeGreaterThan(0);
    for (const url of links) {
      expect(url.searchParams.getAll("tag")).toEqual(["trip"]);
      expect(url.searchParams.get("trust")).toBe("verified");
    }
  });
});

describe("SPEC-ADDON-151 I4 Library-origin shelf pages", () => {
  it.each([
    ["tag:trip", "tags"],
    ["untagged", "tags"],
    ["folder:web", "folder"],
    ["month:2026-11", "month"],
  ])("SPEC-ADDON-151 I4 the %s page asks with tag and trust and links back with them", async (shelf, group) => {
    nav.set(`${CLIPS}?view=shelf&shelf=${encodeURIComponent(shelf)}&sort=title&tag=trip&trust=verified`);
    serve();
    render(<Page />);
    const pageAsk = (c: Call) => isShelves(c) && !isDotAsk(c) && q(c).get("per_shelf") === "60";
    await waitFor(() => expect(server.calls.some(pageAsk)).toBe(true));
    await act(() => settle());

    const asks = server.calls.filter(pageAsk);
    for (const call of asks) {
      expect(q(call).getAll("tag")).toEqual(["trip"]);
      expect(q(call).get("trust")).toBe("verified");
    }
    const back = hrefOf(backLink("Library"));
    expect(["view", "group", "sort"].map((k) => back.searchParams.get(k))).toEqual(["all", group, "title"]);
    expect(back.searchParams.getAll("tag")).toEqual(["trip"]);
    expect(back.searchParams.get("trust")).toBe("verified");
  });

  it("SPEC-ADDON-151 I5 a shelf page's sort filled in keeps tag and trust", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=tag%3Atrip&tag=work&trust=verified`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.get("sort")).not.toBeNull());
    expect(nav.params.getAll("tag")).toEqual(["work"]);
    expect(nav.params.get("trust")).toBe("verified");
  });
});

describe("SPEC-ADDON-151 I4 Home and its shelf pages ignore the filters", () => {
  it("SPEC-ADDON-151 I4 Clips Home sends neither tag nor a verified trust", async () => {
    await libraryApplies("tag=trip&trust=verified");
    nav.set(`${CLIPS}?tag=trip&trust=verified`);
    serve();
    render(<Page />);
    await waitFor(() => expect(server.calls.some(isShelves)).toBe(true));
    await act(() => settle());

    for (const call of server.calls.filter((c) => isShelves(c) || c.url.pathname.endsWith("/files"))) {
      expect(q(call).getAll("tag")).toEqual([]);
      expect(q(call).get("trust")).not.toBe("verified");
    }
  });

  it.each(["unread", "recent", "new", "unverified"])(
    "SPEC-ADDON-151 I4 the %s shelf page applies neither and its back link to Home drops them",
    async (shelf) => {
      await libraryApplies("tag=trip&trust=verified");
      nav.set(`${CLIPS}?view=shelf&shelf=${shelf}&sort=newest&tag=trip&trust=verified`);
      serve();
      render(<Page />);
      await waitFor(() => expect(server.calls.some(isShelves) || server.calls.some((c) => c.url.pathname.endsWith("/watch-history"))).toBe(true));
      await act(() => settle());

      for (const call of server.calls.filter((c) => isShelves(c) || c.url.pathname.endsWith("/files"))) {
        expect(q(call).getAll("tag")).toEqual([]);
        expect(q(call).get("trust")).not.toBe("verified");
      }
      const back = hrefOf(backLink("Home"));
      expect(back.searchParams.has("tag")).toBe(false);
      expect(back.searchParams.has("trust")).toBe(false);
    },
  );

  it("SPEC-ADDON-151 I4 Home's See all links carry no filter", async () => {
    await libraryApplies("tag=trip&trust=verified");
    nav.set(`${CLIPS}?tag=trip&trust=verified`);
    serve();
    render(<Page />);

    const links = (await screen.findAllByRole("link", { name: /See all/ })).map(hrefOf);
    for (const url of links) {
      expect(url.searchParams.has("tag")).toBe(false);
      expect(url.searchParams.has("trust")).toBe(false);
    }
  });
});

describe("SPEC-ADDON-151 I5 what keeps and what drops the filters", () => {
  it("SPEC-ADDON-151 I5 a Target choice drops them without a push", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&tag=trip&trust=verified`);
    serve();
    render(<Page />);
    await libraryDrawn();
    expect(tagButton()).toHaveAccessibleName("Tag: trip");
    const before = nav.log.length;

    await chooseTarget("Work");

    await waitFor(() => expect(nav.params.has("tag")).toBe(false));
    await act(() => settle());
    const after = nav.log.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((n) => n.kind === "push")).toEqual([]);
    expect(after.filter((n) => n.url.searchParams.has("tag") || n.url.searchParams.has("trust"))).toEqual([]);
    expect(after[0].url.searchParams.has("group")).toBe(true);
  });

  it("SPEC-ADDON-151 I5 a Group By choice pushes and keeps them", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&tag=trip&trust=verified`);
    serve();
    render(<Page />);
    await libraryDrawn();

    await choose(groupButton, "Folder");

    await waitFor(() => expect(nav.params.get("group")).toBe("folder"));
    expect(nav.last()?.kind).toBe("push");
    expect(nav.params.getAll("tag")).toEqual(["trip"]);
    expect(nav.params.get("trust")).toBe("verified");
  });

  it("SPEC-ADDON-151 I5 a Sort By choice keeps them", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&tag=trip&trust=verified`);
    serve();
    render(<Page />);
    await libraryDrawn();

    await choose(sortButton, "Title");

    await waitFor(() => expect(nav.params.get("sort")).toBe("title"));
    expect(nav.params.getAll("tag")).toEqual(["trip"]);
    expect(nav.params.get("trust")).toBe("verified");
  });

  it("SPEC-ADDON-151 I5 the group and sort filled in keeps them", async () => {
    nav.set(`${LIBRARY}&tag=trip&trust=verified`);
    serve();
    render(<Page />);

    await waitFor(() => expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["tags", "newest"]));
    expect(nav.params.getAll("tag")).toEqual(["trip"]);
    expect(nav.params.get("trust")).toBe("verified");
  });

  it("SPEC-ADDON-151 I5 rewriting an unknown group keeps them", async () => {
    nav.set(`${LIBRARY}&group=shelves&sort=title&tag=trip&trust=verified`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.get("group")).toBe("tags"));
    expect(nav.params.getAll("tag")).toEqual(["trip"]);
    expect(nav.params.get("trust")).toBe("verified");
  });

  it("SPEC-ADDON-151 I5 the Home and Library tab links carry none", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&tag=trip&trust=verified`);
    serve();
    render(<Page />);
    await libraryDrawn();
    expect(tagButton()).toHaveAccessibleName("Tag: trip");

    for (const name of ["Home", "Library"]) {
      const url = hrefOf(screen.getByRole("link", { name }));
      expect(url.searchParams.has("tag")).toBe(false);
      expect(url.searchParams.has("trust")).toBe(false);
    }
  });

  it("SPEC-ADDON-151 I5 writes no filter value to localStorage or sessionStorage", async () => {
    const writes: string[] = [];
    for (const store of [localStorage, sessionStorage]) {
      const original = store.setItem.bind(store);
      vi.spyOn(store, "setItem").mockImplementation((key, value) => {
        writes.push(`${key}=${value}`);
        original(key, value);
      });
    }
    nav.set(`${LIBRARY}&group=tags&sort=newest`);
    serve();
    render(<Page />);
    await libraryDrawn();

    await choose(stateButton, "Unverified");
    fireEvent.click(tagButton());
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: /food/ }));
    await waitFor(() => expect(nav.params.getAll("tag")).toEqual(["food"]));

    expect(writes.filter((w) => w.includes("food") || w.includes("unverified"))).toEqual([]);
  });
});

describe("SPEC-ADDON-151 I11 an unreadable trust", () => {
  it.each(["unreviewed", "bogus", ""])("SPEC-ADDON-151 I11 trust=%s is removed from the Library URL by replace, the tags kept", async (trust) => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&tag=trip&trust=${trust}`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.has("trust")).toBe(false));
    expect(nav.log.length).toBeGreaterThan(0);
    expect(nav.log.every((n) => n.kind === "replace")).toBe(true);
    expect(nav.params.getAll("tag")).toEqual(["trip"]);
    await libraryDrawn();
    for (const call of server.calls.filter(listing)) expect(q(call).has("trust")).toBe(false);
  });

  it("SPEC-ADDON-151 I11 trust=unreviewed is removed from a shelf page URL by replace", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=tag%3Atrip&sort=newest&trust=unreviewed`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.has("trust")).toBe(false));
    expect(nav.params.get("shelf")).toBe("tag:trip");
    expect(nav.log.every((n) => n.kind === "replace")).toBe(true);
  });
});

describe("SPEC-ADDON-151 I10 the filtered empty state", () => {
  it("SPEC-ADDON-151 I10 says Nothing matches these filters, not No clips here, when the filters leave nothing", async () => {
    nav.set(`${LIBRARY}&group=none&sort=newest&tag=nowhere`);
    serve();
    render(<Page />);

    expect(await screen.findByText("Nothing matches these filters")).toBeInTheDocument();
    expect(screen.queryByText("No clips here")).toBeNull();
  });

  it("SPEC-ADDON-151 I10 a state that leaves nothing says the same", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&trust=unverified&tag=food`);
    serve();
    render(<Page />);

    expect(await screen.findByText("Nothing matches these filters")).toBeInTheDocument();
  });
});
