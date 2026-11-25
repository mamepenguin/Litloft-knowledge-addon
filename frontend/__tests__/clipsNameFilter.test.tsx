/**
 * SPEC-ADDON-159: the name filter in the Clips Library and its Library-origin
 * shelf pages, held in the URL as `q` and sent as `search`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import {
  CLIPS,
  DRIVE,
  captureHistory,
  installClipsServer,
  isCount,
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
const TARGET_KEY = `litloft.addon.knowledge-clips.target.${DRIVE}`;

/** "Web" matches Web one and Web two by title and Recipe one by its folder web/recipes. */
const NAME = "Web";
const MATCHES = ["Web one", "Web two", "Recipe one"];
const MISSES = ["News one", "Root one"];

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
  server.matchSearch = true;
  tagCounts = [];
  server.override = (call) => {
    if (!isTagCounts(call)) return null;
    tagCounts.push(call);
    return json([
      { name: "trip", count: 3 },
      { name: "food", count: 1 },
    ]);
  };
  return server;
}

const hrefOf = (a: Element) => new URL(a.getAttribute("href")!, "http://localhost");
const nameIcon = () => screen.getByRole("button", { name: "Filter by name" });
const queryNameIcon = () => screen.queryByRole("button", { name: "Filter by name" });
const nameInput = () => screen.getByRole("searchbox", { name: "Filter by name" }) as HTMLInputElement;
const queryNameInput = () => screen.queryByRole("searchbox", { name: "Filter by name" });
const groupButton = () => screen.getByRole("button", { name: /Group By/ });
const sortButton = () => screen.getByRole("button", { name: /Sort By/ });
const listing = (c: Call) =>
  (isShelves(c) && ["tag", "folder", "month"].includes(q(c).get("by") ?? "")) ||
  (isNewShelf(c) && q(c).get("per_shelf") === "60");
const pageAsk = (c: Call) => isShelves(c) && !isDotAsk(c) && q(c).get("per_shelf") === "60";
const backLink = (to: "Library" | "Home") =>
  screen.getAllByRole("link").find((a) => new RegExp(`‹\\s*${to}`).test(a.textContent ?? ""))!;

async function libraryDrawn() {
  await waitFor(() => expect(server.calls.some(listing)).toBe(true));
  await act(() => settle());
}

/** The Library under the same `q` sends it; the Home-side tests contrast against it. */
async function libraryApplies() {
  nav.set(`${LIBRARY}&group=tags&sort=newest&q=${NAME}`);
  serve();
  const view = render(<Page />);
  await libraryDrawn();
  const asks = server.calls.filter(listing);
  expect(asks.length).toBeGreaterThan(0);
  for (const call of asks) expect(q(call).get("search")).toBe(NAME);
  view.unmount();
}

async function typeName(text: string) {
  if (!queryNameInput()) fireEvent.click(await screen.findByRole("button", { name: "Filter by name" }));
  fireEvent.change(nameInput(), { target: { value: text } });
}

async function choose(button: () => HTMLElement, option: string) {
  await waitFor(() => expect(button()).toBeInTheDocument());
  fireEvent.click(button());
  fireEvent.click(await screen.findByRole("menuitemradio", { name: option }));
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

describe("SPEC-ADDON-159 I2 I6 where the field is drawn", () => {
  it("SPEC-ADDON-159 I6 the Library draws the icon in the tab row, and Home draws none", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest`);
    serve();
    const library = render(<Page />);
    await libraryDrawn();
    expect(nameIcon()).toBeInTheDocument();
    library.unmount();

    nav.set(CLIPS);
    serve();
    render(<Page />);
    await waitFor(() => expect(server.calls.some(isShelves)).toBe(true));
    await act(() => settle());
    expect(queryNameIcon()).toBeNull();
    expect(queryNameInput()).toBeNull();
  });

  it.each(["tag%3Atrip", "untagged", "folder%3Aweb", "month%3A2026-11"])(
    "SPEC-ADDON-159 I6 the Library-origin shelf page %s draws the field open with q",
    async (shelf) => {
      nav.set(`${CLIPS}?view=shelf&shelf=${shelf}&sort=newest&q=${NAME}`);
      serve();
      render(<Page />);

      await waitFor(() => expect(nameInput().value).toBe(NAME));
    },
  );

  it.each(["unread", "recent", "new", "unverified"])(
    "SPEC-ADDON-159 I2 the Home-origin shelf page %s draws no field",
    async (shelf) => {
      await libraryApplies();
      nav.set(`${CLIPS}?view=shelf&shelf=${shelf}&sort=newest&q=${NAME}`);
      serve();
      render(<Page />);
      await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
      await act(() => settle());

      expect(queryNameIcon()).toBeNull();
      expect(queryNameInput()).toBeNull();
    },
  );
});

describe("SPEC-ADDON-159 I1 the Library and its shelf pages carry the name", () => {
  it.each(["tags", "folder", "month", "none"])("SPEC-ADDON-159 I1 group=%s sends search=q on every listing request", async (group) => {
    nav.set(`${LIBRARY}&group=${group}&sort=newest&q=${NAME}`);
    serve();
    render(<Page />);
    await libraryDrawn();

    const asks = server.calls.filter(listing);
    expect(asks.length).toBeGreaterThan(0);
    for (const call of asks) expect(q(call).get("search")).toBe(NAME);
    expect(nameInput().value).toBe(NAME);
  });

  it("SPEC-ADDON-159 I1 every item shown has the name in its title or folder path", async () => {
    nav.set(`${LIBRARY}&group=none&sort=newest&q=${NAME}`);
    serve();
    render(<Page />);

    for (const title of MATCHES) expect(await screen.findByText(title)).toBeInTheDocument();
    for (const title of MISSES) expect(screen.queryByText(title)).toBeNull();
  });

  it("SPEC-ADDON-159 I1 the tag menu's tag-counts sends search=q", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${NAME}`);
    serve();
    render(<Page />);
    await libraryDrawn();

    fireEvent.click(screen.getByRole("button", { name: /^Tag/ }));
    await waitFor(() => expect(tagCounts.length).toBeGreaterThan(0));

    expect(q(tagCounts[0]).get("search")).toBe(NAME);
  });

  it.each(["tags", "folder", "month"])("SPEC-ADDON-159 I6 every See all link under group=%s carries q", async (group) => {
    nav.set(`${LIBRARY}&group=${group}&sort=newest&q=${NAME}`);
    serve([...FILES, { id: "n2", title: "Web news", folder: "news", created: "2026-10-07T09:00:00Z" }]);
    render(<Page />);
    await libraryDrawn();

    const links = (await screen.findAllByRole("link", { name: /See all/ })).map(hrefOf);
    expect(links.length).toBeGreaterThan(0);
    for (const url of links) expect(url.searchParams.get("q")).toBe(NAME);
  });

  it.each([
    ["tag:trip", "tags"],
    ["untagged", "tags"],
    ["folder:web", "folder"],
    ["month:2026-11", "month"],
  ])("SPEC-ADDON-159 I1 I6 the %s page asks with search=q and links back with q", async (shelf, group) => {
    nav.set(`${CLIPS}?view=shelf&shelf=${encodeURIComponent(shelf)}&sort=title&q=${NAME}`);
    serve();
    render(<Page />);
    await waitFor(() => expect(server.calls.some(pageAsk)).toBe(true));
    await act(() => settle());

    for (const call of server.calls.filter(pageAsk)) expect(q(call).get("search")).toBe(NAME);
    const back = hrefOf(backLink("Library"));
    expect(["view", "group", "sort"].map((k) => back.searchParams.get(k))).toEqual(["all", group, "title"]);
    expect(back.searchParams.get("q")).toBe(NAME);
  });
});

describe("SPEC-ADDON-159 I1 under a member Target", () => {
  it("SPEC-ADDON-159 I1 the Library posts the members with search=q alone, and tag-counts/query carries it too", async () => {
    localStorage.setItem(TARGET_KEY, "sf-cats");
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${NAME}`);
    serve(FILES, { smartFolders: [WORK, smartFolder("sf-cats", "Cats", "cats")] });
    // The member evaluation is a listing carrying the Target's own free text as `search`.
    server.matchSearch = false;
    render(<Page />);
    const libraryPost = (c: Call) => listing(c) && c.url.pathname.endsWith("/shelves/query");
    await waitFor(() => expect(server.calls.some(libraryPost)).toBe(true));
    await act(() => settle());

    for (const call of server.calls.filter(libraryPost)) {
      expect(call.method).toBe("POST");
      expect(q(call).getAll("search")).toEqual([NAME]);
    }

    fireEvent.click(screen.getByRole("button", { name: /^Tag/ }));
    await waitFor(() => expect(tagCounts).toHaveLength(1));
    expect(tagCounts[0].url.pathname).toBe(`/api/drives/${DRIVE}/tag-counts/query`);
    expect(q(tagCounts[0]).getAll("search")).toEqual([NAME]);
  });
});

describe("SPEC-ADDON-159 I2 what never carries the name", () => {
  it("SPEC-ADDON-159 I2 the header count never carries it", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${NAME}`);
    serve();
    render(<Page />);
    await libraryDrawn();

    expect(server.calls.filter(listing).every((c) => q(c).get("search") === NAME)).toBe(true);
    const counts = server.calls.filter(isCount);
    expect(counts.length).toBeGreaterThan(0);
    for (const call of counts) expect(q(call).has("search")).toBe(false);
  });

  it("SPEC-ADDON-159 I2 Clips Home sends no search and leaves q in its URL", async () => {
    await libraryApplies();
    nav.set(`${CLIPS}?q=${NAME}`);
    serve();
    render(<Page />);
    await waitFor(() => expect(server.calls.some(isShelves)).toBe(true));
    await act(() => settle());

    for (const call of server.calls) expect(q(call).has("search")).toBe(false);
    expect(nav.params.get("q")).toBe(NAME);
  });

  it.each(["unread", "recent", "new", "unverified"])(
    "SPEC-ADDON-159 I2 the %s shelf page sends no search and its back link to Home carries no q",
    async (shelf) => {
      await libraryApplies();
      nav.set(`${CLIPS}?view=shelf&shelf=${shelf}&sort=newest&q=${NAME}`);
      serve();
      render(<Page />);
      await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
      await act(() => settle());

      for (const call of server.calls) expect(q(call).has("search")).toBe(false);
      expect(hrefOf(backLink("Home")).searchParams.has("q")).toBe(false);
    },
  );
});

describe("SPEC-ADDON-159 I6 a name change", () => {
  it("SPEC-ADDON-159 I3 I6 typing replaces the URL's q with the last text only, and adds no history entry", async () => {
    nav.set(`${LIBRARY}&group=folder&sort=newest`);
    serve();
    render(<Page />);
    await libraryDrawn();

    await typeName("W");
    await typeName("We");
    await typeName(NAME);

    await waitFor(() => expect(nav.params.get("q")).toBe(NAME));
    expect(nav.log.filter((n) => n.kind === "push")).toEqual([]);
    const named = nav.log.filter((n) => n.url.searchParams.has("q"));
    expect(named.length).toBeGreaterThan(0);
    for (const n of named) expect(n.url.searchParams.get("q")).toBe(NAME);
    expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["folder", "newest"]);
    await waitFor(() => expect(server.calls.filter(listing).at(-1)!.url.searchParams.get("search")).toBe(NAME));
  });

  it("SPEC-ADDON-159 I6 I7 × removes q by replace, and later requests carry no search", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${NAME}`);
    serve();
    render(<Page />);
    await libraryDrawn();
    const before = server.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Clear input" }));

    await waitFor(() => expect(nav.params.has("q")).toBe(false));
    expect(nav.log.every((n) => n.kind === "replace")).toBe(true);
    await waitFor(() => expect(server.calls.slice(before).some(listing)).toBe(true));
    await act(() => settle(400));
    for (const call of server.calls.slice(before).filter(listing)) expect(q(call).has("search")).toBe(false);
  });
});

describe("SPEC-ADDON-159 I6 rewrites that keep q", () => {
  it("SPEC-ADDON-159 I6 filling in the group and sort keeps it", async () => {
    nav.set(`${LIBRARY}&q=${NAME}`);
    serve();
    render(<Page />);

    await waitFor(() => expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["tags", "newest"]));
    expect(nav.params.get("q")).toBe(NAME);
    await libraryDrawn();
    for (const call of server.calls.filter(listing)) expect(q(call).get("search")).toBe(NAME);
  });

  it("SPEC-ADDON-159 I6 the unreadable-trust rewrite keeps it", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&trust=bogus&q=${NAME}`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.has("trust")).toBe(false));
    expect(nav.params.get("q")).toBe(NAME);
    await libraryDrawn();
    for (const call of server.calls.filter(listing)) expect(q(call).get("search")).toBe(NAME);
  });

  it("SPEC-ADDON-159 I6 filling in a shelf page's sort keeps it", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=tag%3Atrip&q=${NAME}`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.get("sort")).not.toBeNull());
    expect(nav.params.get("q")).toBe(NAME);
    await waitFor(() => expect(server.calls.some(pageAsk)).toBe(true));
    for (const call of server.calls.filter(pageAsk)) expect(q(call).get("search")).toBe(NAME);
  });

  it("SPEC-ADDON-159 I6 a Group By choice pushes and keeps it", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${NAME}`);
    serve();
    render(<Page />);
    await libraryDrawn();

    await choose(groupButton, "Folder");

    await waitFor(() => expect(nav.params.get("group")).toBe("folder"));
    expect(nav.last()?.kind).toBe("push");
    expect(nav.params.get("q")).toBe(NAME);
    expect(nameInput().value).toBe(NAME);
  });

  it("SPEC-ADDON-159 I6 a Sort By choice keeps it", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${NAME}`);
    serve();
    render(<Page />);
    await libraryDrawn();

    await choose(sortButton, "Title");

    await waitFor(() => expect(nav.params.get("sort")).toBe("title"));
    expect(nav.params.get("q")).toBe(NAME);
    expect(nameInput().value).toBe(NAME);
  });

  it("SPEC-ADDON-159 I6 removing target after a Home-shortcut landing on the Target in force keeps it", async () => {
    localStorage.setItem(TARGET_KEY, "sf-work");
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${NAME}&target=sf-work`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.has("target")).toBe(false));
    expect(nav.params.get("q")).toBe(NAME);
    await libraryDrawn();
    for (const call of server.calls.filter(listing)) expect(q(call).get("search")).toBe(NAME);
  });
});

describe("SPEC-ADDON-159 I6 what drops q", () => {
  it("SPEC-ADDON-159 I6 a Target choice drops it with tag and trust in one replace, and no later request carries it", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&tag=trip&trust=verified&q=${NAME}`);
    serve();
    render(<Page />);
    await libraryDrawn();
    expect(nameInput().value).toBe(NAME);
    const before = nav.log.length;
    const calls = server.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /Target/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Work/ }));

    await waitFor(() => expect(nav.params.has("q")).toBe(false));
    await act(() => settle());
    const after = nav.log.slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((n) => n.kind === "push")).toEqual([]);
    expect(after.filter((n) => n.url.searchParams.has("q"))).toEqual([]);
    expect(after[0].url.searchParams.has("tag")).toBe(false);
    for (const call of server.calls.slice(calls)) expect(q(call).has("search")).toBe(false);
  });

  it("SPEC-ADDON-159 I6 a Home-shortcut landing on a Target other than the one in force drops q, and no request carries it", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${NAME}&target=sf-work`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.has("target")).toBe(false));
    await waitFor(() => expect(nav.params.has("q")).toBe(false));
    await waitFor(() => expect(server.calls.some(listing)).toBe(true));
    await act(() => settle());

    expect(nav.log.every((n) => n.kind === "replace")).toBe(true);
    expect(server.calls.filter((c) => q(c).get("search") === NAME)).toEqual([]);
    for (const call of server.calls.filter(listing)) expect(q(call).has("search")).toBe(false);
  });

  it("SPEC-ADDON-159 I6 the Home and Library tab links carry none, while the Library's See all links do", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${NAME}`);
    serve();
    render(<Page />);
    await libraryDrawn();

    const seeAll = (await screen.findAllByRole("link", { name: /See all/ })).map(hrefOf);
    expect(seeAll.every((u) => u.searchParams.get("q") === NAME)).toBe(true);
    for (const name of ["Home", "Library"]) {
      expect(hrefOf(screen.getByRole("link", { name })).searchParams.has("q")).toBe(false);
    }
  });
});

describe("SPEC-ADDON-159 I10 normalising q", () => {
  it("SPEC-ADDON-159 I10 an untrimmed q is replaced by its trimmed form and no request carries the spaces", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${encodeURIComponent(`  ${NAME}  `)}`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.get("q")).toBe(NAME));
    expect(nav.log.every((n) => n.kind === "replace")).toBe(true);
    await libraryDrawn();
    for (const call of server.calls.filter((c) => q(c).has("search"))) expect(q(call).get("search")).toBe(NAME);
    expect(server.calls.filter(listing).every((c) => q(c).get("search") === NAME)).toBe(true);
  });

  it("SPEC-ADDON-159 I10 an empty q is removed by replace", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.has("q")).toBe(false));
    expect(nav.log.every((n) => n.kind === "replace")).toBe(true);
  });

  it("SPEC-ADDON-159 I10 a q over 200 characters is cut to 200, and no request carries more", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${"x".repeat(250)}`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.get("q")).toBe("x".repeat(200)));
    await libraryDrawn();
    for (const call of server.calls.filter((c) => q(c).has("search"))) expect(q(call).get("search")).toBe("x".repeat(200));
    expect(server.calls.filter(listing).every((c) => q(c).get("search") === "x".repeat(200))).toBe(true);
  });

  it("SPEC-ADDON-159 I10 q is trimmed, cut to 200 and trimmed again before it is replaced and requested", async () => {
    const raw = `  ${"a".repeat(199)}  b  `;
    nav.set(`${LIBRARY}&group=tags&sort=newest&q=${encodeURIComponent(raw)}`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.get("q")).toBe("a".repeat(199)));
    expect(nav.log.every((n) => n.kind === "replace")).toBe(true);
    await libraryDrawn();
    for (const call of server.calls.filter((c) => q(c).has("search"))) {
      expect(q(call).get("search")).toBe("a".repeat(199));
    }
    expect(server.calls.filter(listing).every((c) => q(c).get("search") === "a".repeat(199))).toBe(true);
  });
});

describe("SPEC-ADDON-159 I9 the filtered empty state", () => {
  it("SPEC-ADDON-159 I9 a q that leaves nothing in the Library says Nothing matches these filters, not No clips here", async () => {
    nav.set(`${LIBRARY}&group=none&sort=newest&q=nowhere`);
    serve();
    render(<Page />);

    expect(await screen.findByText("Nothing matches these filters")).toBeInTheDocument();
    expect(screen.queryByText("No clips here")).toBeNull();
  });

  it("SPEC-ADDON-159 I9 a q that leaves nothing on a folder shelf page says the same", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=folder%3Aweb&sort=newest&q=nowhere`);
    serve();
    render(<Page />);

    expect(await screen.findByText("Nothing matches these filters")).toBeInTheDocument();
    expect(screen.queryByText("No clips here")).toBeNull();
  });
});

describe("SPEC-ADDON-159 I13 a pending name and a page change", () => {
  it("SPEC-ADDON-159 I13 text typed less than 300ms before opening a shelf page reaches neither page", async () => {
    nav.set(`${LIBRARY}&group=tags&sort=newest`);
    serve();
    render(<Page />);
    await libraryDrawn();

    await typeName("osaka");
    fireEvent.click((await screen.findAllByRole("link", { name: /See all/ }))[0]);
    await waitFor(() => expect(nav.params.get("view")).toBe("shelf"));
    await act(() => settle(400));

    expect(nav.params.has("q")).toBe(false);
    expect(nav.log.filter((n) => n.url.searchParams.get("q") === "osaka")).toEqual([]);
    expect(server.calls.filter((c) => q(c).get("search") === "osaka")).toEqual([]);
  });

  it("SPEC-ADDON-159 I13 text typed less than 300ms before going back to the Library reaches neither page", async () => {
    nav.set(`${CLIPS}?view=shelf&shelf=tag%3Atrip&sort=newest&q=${NAME}`);
    serve();
    render(<Page />);
    await waitFor(() => expect(nameInput().value).toBe(NAME));

    fireEvent.change(nameInput(), { target: { value: "osaka" } });
    fireEvent.click(backLink("Library"));
    await waitFor(() => expect(nav.params.get("view")).toBe("all"));
    await act(() => settle(400));

    expect(nav.params.get("q")).toBe(NAME);
    expect(nav.log.filter((n) => n.url.searchParams.get("q") === "osaka")).toEqual([]);
    expect(server.calls.filter((c) => q(c).get("search") === "osaka")).toEqual([]);
  });
});
