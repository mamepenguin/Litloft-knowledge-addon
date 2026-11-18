/**
 * SPEC-ADDON-131: Notes Home — Continue writing, Notes with sources, Recently
 * updated. Invariant ids are those of docs/specs/notes-app.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import type { WireCall } from "@/__tests__/helpers/wireFetch";
import {
  BASE,
  DRIVE,
  captureHistory,
  installNotesServer,
  isFiles,
  isOpenings,
  isSources,
  isWatchHistory,
  isWithSources,
  nav,
  router,
  setViewport,
  settle,
  type Note,
  type Server,
} from "./notesAppHarness";

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
const flags = vi.hoisted(() => ({ inline: true }));
vi.mock("@/lib/featureFlags", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/featureFlags");
  return { ...actual, isInlineKnowledgeEditorEnabled: () => flags.inline };
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
const member = vi.hoisted(() => ({ evaluation: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/memberTarget", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/memberTarget");
  return {
    ...actual,
    evaluateMemberTarget: (...a: unknown[]) =>
      member.evaluation ? member.evaluation() : (actual.evaluateMemberTarget as (...b: unknown[]) => unknown)(...a),
  };
});

const Page = (await import("../Page")).default;

const TARGET_KEY = `litloft.addon.knowledge.target.${DRIVE}`;

const at = (day: number) => `2026-11-${String(day).padStart(2, "0")}T09:00:00Z`;

function notes(count: number, prefix = "n"): Note[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    title: `${prefix.toUpperCase()} note ${i + 1}`,
    folder: i % 2 ? "Journal" : "",
    updated: new Date(Date.UTC(2026, 10, 30) - i * 3_600_000).toISOString(),
  }));
}

let server: Server;

beforeEach(() => {
  localStorage.clear();
  nav.set(BASE);
  router.push.mockClear();
  router.replace.mockClear();
  profile.nickname = "alice";
  flags.inline = true;
  member.evaluation = null;
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const section = (heading: string) => {
  const h = screen.getByText(heading);
  return (h.closest("section") ?? h.parentElement!.parentElement!) as HTMLElement;
};
/** The innermost elements whose whole text is `text`. */
const deepest = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("*")].filter(
    (el) => el.textContent?.trim() === text && ![...el.children].some((c) => c.textContent?.trim() === text),
  );
const fileHref = (a: Element) => new URL(a.getAttribute("href")!, "http://localhost");
const walkCalls = () => server.calls.filter((c) => isFiles(c) && c.url.searchParams.get("limit") === "60");

describe("SPEC-ADDON-131 Home step 1: Continue writing", () => {
  const HISTORY: Note[] = [
    { id: "h1", title: "Draft one", folder: "Journal", updated: at(10) },
    { id: "h2", title: "Draft two", folder: "", updated: at(9) },
    { id: "h3", title: "Draft three", folder: "Work", updated: at(8) },
    { id: "h4", title: "Draft four", folder: "Work", updated: at(7) },
    { id: "h5", title: "Draft five", folder: "Work", updated: at(6) },
  ];

  it("SPEC-ADDON-131 asks watch-history for the viewer's text notes, clips out, 4 at most, and draws them as cards with their opening", async () => {
    server = installNotesServer({
      notes: [...notes(3), ...HISTORY],
      history: HISTORY,
      openings: { h1: "Opening of draft one", h2: "Opening of draft two" },
    });
    render(<Page />);

    await screen.findByText("Continue writing");
    const asked = server.calls.filter(isWatchHistory);
    expect(asked.length).toBeGreaterThan(0);
    for (const call of asked) {
      const q = call.url.searchParams;
      expect([q.get("filter"), q.getAll("type"), q.get("exclude_origin"), q.get("limit")]).toEqual([
        "all",
        ["text"],
        "webclip",
        "4",
      ]);
    }
    const cards = section("Continue writing");
    expect(await within(cards).findByText("Opening of draft one")).toBeInTheDocument();
    expect(within(cards).getByText("Draft four")).toBeInTheDocument();
    expect(within(cards).queryByText("Draft five")).toBeNull();
    const link = within(cards).getByText("Draft one").closest("a")!;
    expect(fileHref(link).searchParams.get("file")).toBe("h1");
    expect(fileHref(link).pathname.startsWith(`/drive/${DRIVE}`)).toBe(true);
  });

  it("SPEC-ADDON-131 does not follow the Target", async () => {
    localStorage.setItem(TARGET_KEY, "sf-trip");
    server = installNotesServer({
      notes: notes(3).map((n, i) => (i === 0 ? { ...n, tags: ["trip"] } : n)),
      history: HISTORY.slice(0, 1),
    });
    const base = server.override;
    server.override = (call: WireCall) =>
      call.url.pathname === `/api/drives/${DRIVE}/smart-folders`
        ? new Response(
            JSON.stringify([{ id: "sf-trip", drive: DRIVE, name: "Trip", query: "tag:trip", file_type: null, sort_by: null, sort_order: null, created_at: at(1), updated_at: null }]),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        : base(call);
    render(<Page />);

    await screen.findByText("Continue writing");
    for (const call of server.calls.filter(isWatchHistory)) {
      expect(call.url.searchParams.getAll("tag")).toEqual([]);
      expect(call.method).toBe("GET");
    }
    expect(screen.getByRole("button", { name: /Target/ })).toHaveTextContent("Trip");
  });

  it.each([
    ["without a profile", () => (profile.nickname = null), () => null],
    ["with no rows", () => undefined, () => null],
    ["when watch-history fails", () => undefined, (c: WireCall) => (isWatchHistory(c) ? new Response("{}", { status: 500 }) : null)],
  ])("SPEC-ADDON-131 the section is not drawn %s", async (_label, arrange, override) => {
    arrange();
    server = installNotesServer({ notes: notes(3), history: [] });
    server.override = override as (c: WireCall) => Response | null;
    render(<Page />);

    expect(await screen.findByText("Recently updated")).toBeInTheDocument();
    await act(() => settle());
    expect(screen.queryByText("Continue writing")).toBeNull();
  });
});

describe("SPEC-ADDON-131 Home step 3: Recently updated", () => {
  it("SPEC-ADDON-131 lists the five newest notes under the Target, clips out, with their opening, folder and link", async () => {
    server = installNotesServer({
      notes: [...notes(7), { id: "c1", title: "A clip", folder: "", origin: "webclip", updated: at(30) }],
      openings: { n1: "First line of n1" },
    });
    render(<Page />);

    const recent = await waitFor(() => section("Recently updated"));
    await within(recent).findByText("N note 1");
    const asked = server.calls.filter((c) => isFiles(c) && c.url.searchParams.get("limit") === "5");
    expect(asked.length).toBeGreaterThan(0);
    const q = asked[0].url.searchParams;
    expect([q.getAll("type"), q.get("exclude_origin"), q.get("sort"), q.get("order")]).toEqual([
      ["text"],
      "webclip",
      "updated_at",
      "desc",
    ]);
    const titles = within(recent).getAllByText(/^N note \d$/).map((e) => e.textContent);
    expect(titles).toEqual(["N note 1", "N note 2", "N note 3", "N note 4", "N note 5"]);
    expect(within(recent).queryByText("A clip")).toBeNull();
    expect(await within(recent).findByText("First line of n1")).toBeInTheDocument();
    expect(recent.textContent).toContain("Journal");
    const row = within(recent).getByText("N note 2").closest("a")!;
    expect(fileHref(row).searchParams.get("file")).toBe("n2");
    const seeAll = within(recent).getByRole("link", { name: /See in Library/ });
    expect(fileHref(seeAll).pathname).toBe(BASE);
    expect(fileHref(seeAll).searchParams.get("view")).toBe("all");
  });

  it("SPEC-ADDON-131 a failure shows Try again where the rows go, and Try again loads them", async () => {
    server = installNotesServer({ notes: notes(3) });
    let fail = true;
    server.override = (c) =>
      fail && isFiles(c) && c.url.searchParams.get("limit") === "5" ? new Response("{}", { status: 500 }) : null;
    render(<Page />);

    await screen.findByText("Recently updated");
    const retry = await within(section("Recently updated")).findByRole("button", { name: "Try again" });
    fail = false;
    fireEvent.click(retry);

    expect(await within(section("Recently updated")).findByText("N note 1")).toBeInTheDocument();
  });

  it("SPEC-ADDON-131 when note-openings fails the rows are drawn without an opening", async () => {
    server = installNotesServer({ notes: notes(2), openings: { n1: "Never shown" } });
    server.override = (c) => (isOpenings(c) ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    const recent = await waitFor(() => section("Recently updated"));
    expect(await within(recent).findByText("N note 1")).toBeInTheDocument();
    await act(() => settle());
    expect(screen.queryByText("Never shown")).toBeNull();
  });
});

function src(id: string, extra: Record<string, unknown> = {}) {
  return {
    source_file_id: id,
    title: `Source ${id}`,
    filename: `${id}.mp4`,
    folder_path: "Lectures",
    mime_type: "video/mp4",
    has_thumbnail: true,
    locator: null,
    ...extra,
  };
}

describe("SPEC-ADDON-131 Home step 2: Notes with sources", () => {
  it("SPEC-ADDON-131 walks the newest notes, keeps those with sources, and draws them in walk order with their source", async () => {
    server = installNotesServer({
      notes: notes(8),
      withSources: ["n7", "n2", "n5"],
      openings: { n2: "Opening two" },
      sources: {
        n2: [src("s1", { locator: { t: 3725 } }), src("s9")],
        n5: [src("s2", { folder_path: "", mime_type: "application/pdf", has_thumbnail: false, locator: { page: 12 } })],
        n7: [src("s3", { folder_path: "Docs", locator: null })],
      },
    });
    render(<Page />);

    await screen.findByText("Notes with sources");
    const walk = walkCalls();
    expect(walk.length).toBeGreaterThan(0);
    const q = walk[0].url.searchParams;
    expect([q.getAll("type"), q.get("exclude_origin"), q.get("sort"), q.get("order")]).toEqual([
      ["text"],
      "webclip",
      "updated_at",
      "desc",
    ]);
    const asked = server.calls.filter(isSources);
    expect(asked.length).toBeGreaterThan(0);
    for (const call of asked) expect((call.body as { file_ids: string[] }).file_ids).toEqual(["n2", "n5", "n7"]);

    const box = section("Notes with sources");
    const titles = (await within(box).findAllByText(/^N note \d$/)).map((e) => e.textContent);
    expect(titles).toEqual(["N note 2", "N note 5", "N note 7"]);
    expect(within(box).getAllByText("1:02:05").length).toBeGreaterThan(0);
    expect(deepest(box, "Lectures · 1:02:05")).toHaveLength(1);
    expect(within(box).getAllByText("p. 12").length).toBeGreaterThan(0);
    expect(deepest(box, "Drive root · p. 12")).toHaveLength(1);
    expect(deepest(box, "Docs")).toHaveLength(1);
    expect(within(box).getByText("Opening two")).toBeInTheDocument();
    const thumbs = [...box.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
    expect(thumbs.some((s) => s.includes("/api/files/s1/thumbnail"))).toBe(true);
    expect(thumbs.some((s) => s.includes("/api/files/s2/thumbnail"))).toBe(false);
    const row = within(box).getByText("N note 5").closest("a")!;
    expect(fileHref(row).searchParams.get("file")).toBe("n5");
    expect(within(box).queryByRole("link", { name: /See all/ })).toBeNull();
  });

  it("SPEC-ADDON-131 a candidate with no source in the answer is dropped", async () => {
    server = installNotesServer({
      notes: notes(4),
      withSources: ["n1", "n3"],
      sources: { n1: [], n3: [src("s3", { locator: { t: 65 } })] },
    });
    render(<Page />);

    const box = await waitFor(() => section("Notes with sources"));
    expect(await within(box).findByText("N note 3")).toBeInTheDocument();
    expect(within(box).queryByText("N note 1")).toBeNull();
    expect(within(box).getAllByText("1:05").length).toBeGreaterThan(0);
  });

  it("SPEC-ADDON-131 stops at five candidates", async () => {
    server = installNotesServer({
      notes: notes(10),
      withSources: ["n1", "n2", "n3", "n4", "n5", "n6", "n7"],
      sources: Object.fromEntries(["n1", "n2", "n3", "n4", "n5"].map((id) => [id, [src(`s-${id}`)]])),
    });
    render(<Page />);

    await screen.findByText("Notes with sources");
    const asked = server.calls.filter(isSources);
    expect(asked.length).toBeGreaterThan(0);
    for (const call of asked) expect((call.body as { file_ids: string[] }).file_ids).toEqual(["n1", "n2", "n3", "n4", "n5"]);
  });

  it("SPEC-ADDON-131 I20 walks at most 3 pages of 60", async () => {
    server = installNotesServer({ notes: notes(400), withSources: ["n399"], sources: { n399: [src("s1")] } });
    render(<Page />);

    await waitFor(() => expect(walkCalls().length).toBeGreaterThan(0));
    await act(() => settle(200));
    const pages = walkCalls().map((c) => c.url.searchParams.get("page") ?? "1");
    expect(pages).toEqual(["1", "2", "3"]);
    expect(screen.queryByText("Notes with sources")).toBeNull();
    expect(screen.getByText("Recently updated")).toBeInTheDocument();
  });

  it.each([
    ["with-sources fails", (c: WireCall) => (isWithSources(c) ? new Response("{}", { status: 500 }) : null)],
    ["notes/sources fails", (c: WireCall) => (isSources(c) ? new Response("{}", { status: 503 }) : null)],
    ["the walk fails", (c: WireCall) => (isFiles(c) && c.url.searchParams.get("limit") === "60" ? new Response("{}", { status: 500 }) : null)],
  ])("SPEC-ADDON-131 the section is not drawn when %s, and the others are unaffected", async (_l, override) => {
    server = installNotesServer({ notes: notes(3), withSources: ["n1"], sources: { n1: [src("s1")] } });
    server.override = override;
    render(<Page />);

    const recent = await waitFor(() => section("Recently updated"));
    expect(await within(recent).findByText("N note 1")).toBeInTheDocument();
    await act(() => settle(150));
    expect(screen.queryByText("Notes with sources")).toBeNull();
  });
});
