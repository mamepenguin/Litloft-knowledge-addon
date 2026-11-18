/**
 * SPEC-ADDON-138: the Clips page's frame — header, scope line, Target, tabs,
 * the clip form and refresh. Invariant ids are those of docs/specs/clips-frame.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import {
  CLIPS,
  DRIVE,
  NOT_CLIPS,
  captureHistory,
  clips,
  coverIds,
  deferred,
  emit,
  findText,
  installClipsServer,
  isCount,
  isCovers,
  isDotAsk,
  isFiles,
  isShelves,
  isUnreadShelf,
  isWatchHistory,
  nav,
  profile,
  q,
  resetSocket,
  setViewport,
  settle,
  smartFolder,
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

const tab = (name: string) => screen.getByRole("link", { name });
const hrefOf = (a: Element) => new URL(a.getAttribute("href")!, "http://localhost");
const before = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const urlField = () => screen.queryByLabelText("URL to clip") as HTMLInputElement | null;
/** Requests that list, count or shelve clips under the Target; the unread-dot question carries none. */
const targeted = () => server.calls.filter((c) => (isFiles(c) || isShelves(c)) && !isDotAsk(c));

describe("SPEC-ADDON-138 step 1, step 3: the header", () => {
  it("SPEC-ADDON-138 draws Clips, the scope line over text clips only, the Target, then Clip a web page, and the tabs Home and Library", async () => {
    serve();
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 1, name: "Clips" })).toBeInTheDocument();
    expect(await findText(`${DRIVE} · 3 clips`)).toBeInTheDocument();
    const target = screen.getByRole("button", { name: /Target/ });
    expect(target).toHaveTextContent("All clips");
    const action = screen.getByRole("button", { name: "Clip a web page" });
    expect(before(target, action)).toBe(true);
    expect(hrefOf(tab("Home")).pathname).toBe(CLIPS);
    expect(hrefOf(tab("Home")).searchParams.get("view")).toBeNull();
    const library = hrefOf(tab("Library"));
    expect([library.pathname, library.searchParams.get("view")]).toEqual([CLIPS, "all"]);
    expect(tab("Home")).toHaveAttribute("aria-current", "page");
  });

  it("SPEC-ADDON-138 the page does not ask for an overlay sidebar", async () => {
    serve();
    render(<Page />);

    await screen.findByRole("link", { name: "Library" });
    expect(sidebar.overlay).not.toHaveBeenCalled();
  });

  it("SPEC-ADDON-138 I1 I2 every request that lists, counts or shelves clips carries type=text and origin=webclip", async () => {
    serve();
    render(<Page />);

    await findText(`${DRIVE} · 3 clips`);
    await act(() => settle());
    expect(targeted().length).toBeGreaterThan(0);
    for (const call of targeted()) {
      expect([q(call).getAll("type"), q(call).get("origin")]).toEqual([["text"], "webclip"]);
    }
    const count = server.calls.filter(isCount)[0];
    expect(count).toBeDefined();
  });

  it("SPEC-ADDON-138 I2 when the count fails the scope line names the drive alone and the shelves still load, with no empty state", async () => {
    serve();
    server.override = (call) => (isCount(call) ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    await screen.findByRole("link", { name: "Library" });
    expect(await screen.findByRole("heading", { level: 2, name: "Unread" })).toBeInTheDocument();
    await act(() => settle());
    expect(document.body.textContent).not.toMatch(/\d+ clips/);
    expect(textNodes(DRIVE).length).toBeGreaterThan(0);
    expect(screen.queryByText("No clips yet")).toBeNull();
    expect(screen.queryByText("No clips in this Target")).toBeNull();
  });
});

describe("SPEC-ADDON-138 step 2: the Target", () => {
  it("SPEC-ADDON-138 reads its saved target under knowledge-clips, not Notes' key, and sends it with type and origin", async () => {
    localStorage.setItem(CLIPS_TARGET_KEY, "sf-trip");
    localStorage.setItem(NOTES_TARGET_KEY, "sf-work");
    serve([...clips(2, "t", { tags: ["trip"] }), ...clips(2, "w", { tags: ["work"] }), ...NOT_CLIPS]);
    render(<Page />);

    expect(await findText(`${DRIVE} · 2 clips`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Target/ })).toHaveTextContent("Trip");
    await act(() => settle());
    for (const call of targeted().filter((c) => !(isCount(c) && q(c).getAll("tag").length === 0))) {
      expect(q(call).getAll("tag")).toEqual(["trip"]);
      expect([q(call).getAll("type"), q(call).get("origin")]).toEqual([["text"], "webclip"]);
    }
  });

  it("SPEC-ADDON-138 SPEC-CORE-136 I1 the menu counts All clips as text clips only", async () => {
    localStorage.setItem(CLIPS_TARGET_KEY, "sf-trip");
    serve([...clips(2, "t", { tags: ["trip"] }), ...clips(3), ...NOT_CLIPS]);
    render(<Page />);

    await findText(`${DRIVE} · 2 clips`);
    fireEvent.click(screen.getByRole("button", { name: /Target/ }));
    await waitFor(() => expect(server.calls.filter((c) => isCount(c) && q(c).getAll("tag").length === 0).length).toBeGreaterThan(0));
    for (const call of server.calls.filter((c) => isCount(c) && q(c).getAll("tag").length === 0)) {
      expect([q(call).getAll("type"), q(call).get("origin")]).toEqual([["text"], "webclip"]);
    }
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: /All clips/ })).toHaveTextContent("5"));
  });

  it("SPEC-ADDON-138 step 4 choosing a Target writes Clips' key only, adds no history entry, and asks every shelf again under it", async () => {
    localStorage.setItem(NOTES_TARGET_KEY, "sf-work");
    serve([...clips(2, "t", { tags: ["trip"] }), ...clips(2, "w", { tags: ["work"] }), ...NOT_CLIPS]);
    render(<Page />);
    await findText(`${DRIVE} · 4 clips`);
    const pushes = () => nav.log.length;
    const logged = pushes();
    const asked = server.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /Target/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Trip/ }));

    expect(await findText(`${DRIVE} · 2 clips`)).toBeInTheDocument();
    expect(localStorage.getItem(CLIPS_TARGET_KEY)).toBe("sf-trip");
    expect(localStorage.getItem(NOTES_TARGET_KEY)).toBe("sf-work");
    expect(nav.log.length).toBe(logged);
    await waitFor(() =>
      expect(server.calls.slice(asked).filter((c) => isUnreadShelf(c) && q(c).getAll("tag").includes("trip"))).toHaveLength(1),
    );
  });
});

describe("SPEC-ADDON-138 step 4, step 5, I11: tabs and the clip form", () => {
  it("SPEC-ADDON-138 the tabs push history", async () => {
    serve();
    render(<Page />);

    fireEvent.click(await screen.findByRole("link", { name: "Library" }));
    expect(nav.last()?.kind).toBe("push");
    expect(nav.params.get("view")).toBe("all");
    expect(await screen.findByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(tab("Home"));
    expect(nav.last()?.kind).toBe("push");
    expect(nav.params.get("view")).toBeNull();
  });

  it("SPEC-ADDON-138 I11 the open clip form keeps what was typed across Home, Library and a shelf page", async () => {
    serve();
    render(<Page />);

    fireEvent.click(await screen.findByRole("button", { name: "Clip a web page" }));
    const field = await waitFor(() => urlField()!);
    fireEvent.change(field, { target: { value: "https://example.com/recipe" } });

    fireEvent.click(tab("Library"));
    await screen.findByRole("button", { name: /By tag/ });
    expect(urlField()?.value).toBe("https://example.com/recipe");

    fireEvent.click(tab("Home"));
    const seeAll = await screen.findByRole("link", { name: /See all.*Unread/ });
    fireEvent.click(seeAll);
    await waitFor(() => expect(nav.params.get("view")).toBe("shelf"));
    expect(urlField()?.value).toBe("https://example.com/recipe");
  });

  it("SPEC-ADDON-138 Clip a web page opens and closes the form", async () => {
    serve();
    render(<Page />);
    await screen.findByRole("link", { name: "Library" });

    fireEvent.click(screen.getByRole("button", { name: "Clip a web page" }));
    await waitFor(() => expect(urlField()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Clip a web page" }));
    // Closing hides the region: the form stays mounted so a draft survives (SPEC-ADDON-138 I11).
    await waitFor(() => expect(urlField()).not.toBeVisible());
  });
});

describe("SPEC-ADDON-138 step 5: refresh on knowledge.clip.ready (SPEC-ADDON-100 I25 as revised)", () => {
  it("SPEC-ADDON-138 a new clip raises the count, joins Unread first without blanking the drawn cards, and its cover is asked", async () => {
    serve();
    render(<Page />);
    await findText(`${DRIVE} · 3 clips`);
    await screen.findByText("C clip 1");
    await waitFor(() => expect(server.calls.filter(isCovers).length).toBeGreaterThan(0));

    const gate = deferred<void>();
    server.files = [{ id: "fresh", title: "Fresh clip", created: "2026-11-20T00:00:00Z" }, ...server.files];
    server.override = (call) => (isUnreadShelf(call) ? gate.promise.then(() => server.answer(call)) : null);
    emit("knowledge.clip.ready", { file_id: "fresh", job_id: 1 });

    await act(() => settle());
    expect(screen.getByText("C clip 1")).toBeInTheDocument();
    expect(await findText(`${DRIVE} · 4 clips`)).toBeInTheDocument();

    await act(async () => gate.resolve());
    const fresh = await screen.findByText("Fresh clip");
    expect(before(fresh, screen.getByText("C clip 1"))).toBe(true);
    await waitFor(() => expect(server.calls.filter(isCovers).some((c) => coverIds(c).includes("fresh"))).toBe(true));
  });

  it("SPEC-ADDON-138 a refresh asks the cover of the clip it names again even when it was asked before", async () => {
    serve();
    render(<Page />);
    await screen.findByText("C clip 1");
    await waitFor(() => expect(server.calls.filter(isCovers).some((c) => coverIds(c).includes("c1"))).toBe(true));
    const before1 = server.calls.filter((c) => isCovers(c) && coverIds(c).includes("c1")).length;

    emit("knowledge.clip.ready", { file_id: "c1", job_id: 2 });

    await waitFor(() =>
      expect(server.calls.filter((c) => isCovers(c) && coverIds(c).includes("c1")).length).toBe(before1 + 1),
    );
  });
});

describe("SPEC-ADDON-138 States, Empty (SPEC-ADDON-100 I28 as revised)", () => {
  it.each([
    ["Home", CLIPS],
    ["Library", `${CLIPS}?view=all`],
  ])("SPEC-ADDON-138 a drive with no clip draws the header and No clips yet, without tabs or shelves, on %s", async (_n, url) => {
    nav.set(url);
    serve([...NOT_CLIPS]);
    render(<Page />);

    expect(await screen.findByText("No clips yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clip a web page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Target/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    expect(screen.queryByText("Unverified")).toBeNull();
  });

  it("SPEC-ADDON-138 a Target with no clip in a drive with clips keeps the tabs, says No clips in this Target, and keeps Recently opened on Home", async () => {
    localStorage.setItem(CLIPS_TARGET_KEY, "sf-trip");
    serve([...clips(3), ...NOT_CLIPS], { history: ["c2"] });
    render(<Page />);

    expect(await screen.findByText("No clips in this Target")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
    expect(await screen.findByText("Recently opened")).toBeInTheDocument();
    expect(screen.getByText("C clip 2")).toBeInTheDocument();
    expect(screen.queryByText("No clips yet")).toBeNull();
    const driveWide = server.calls.filter((c) => isCount(c) && q(c).getAll("tag").length === 0);
    expect(driveWide.length).toBeGreaterThan(0);
    for (const call of driveWide) expect([q(call).getAll("type"), q(call).get("origin")]).toEqual([["text"], "webclip"]);

    fireEvent.click(tab("Library"));
    expect(await screen.findByText("No clips in this Target")).toBeInTheDocument();
    expect(screen.queryByText("Recently opened")).toBeNull();
  });

  it("SPEC-ADDON-138 when the drive-wide count fails no empty state is drawn", async () => {
    localStorage.setItem(CLIPS_TARGET_KEY, "sf-trip");
    serve([...clips(3), ...NOT_CLIPS]);
    server.override = (call) => (isCount(call) && q(call).getAll("tag").length === 0 ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    expect(await findText(`${DRIVE} · 0 clips`)).toBeInTheDocument();
    await waitFor(() => expect(server.calls.filter((c) => isCount(c) && q(c).getAll("tag").length === 0).length).toBeGreaterThan(0));
    await act(() => settle());
    expect(screen.queryByText("No clips yet")).toBeNull();
    expect(screen.queryByText("No clips in this Target")).toBeNull();
  });

  it("SPEC-ADDON-138 Recently opened does not follow the Target", async () => {
    localStorage.setItem(CLIPS_TARGET_KEY, "sf-trip");
    serve([...clips(2, "t", { tags: ["trip"] }), ...clips(2)], { history: ["c1"] });
    render(<Page />);

    await screen.findByText("Recently opened");
    const asked = server.calls.filter(isWatchHistory);
    expect(asked.length).toBeGreaterThan(0);
    for (const call of asked) {
      expect(q(call).getAll("tag")).toEqual([]);
      expect([q(call).get("filter"), q(call).getAll("type"), q(call).get("origin"), q(call).get("limit")]).toEqual([
        "all",
        ["text"],
        "webclip",
        "12",
      ]);
    }
    expect(await screen.findByText("C clip 1")).toBeInTheDocument();
  });
});
