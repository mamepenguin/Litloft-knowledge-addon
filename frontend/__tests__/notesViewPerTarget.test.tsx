/**
 * SPEC-ADDON-148: the Notes rail's 分類 menu, the segment and sort remembered
 * per Target, and the Library URL always naming its sort.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import { dirtyRegistry } from "@/lib/dirtyRegistry";
import { navigationGuard } from "@/lib/navigationGuard";
import {
  BASE,
  DRIVE,
  captureHistory,
  installNotesServer,
  isCountsGet,
  isCountsQuery,
  isFiles,
  isFilesQuery,
  isShelvesGet,
  isShelvesQuery,
  nav,
  router,
  setViewport,
  settle,
  smartFolder,
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
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname: "alice", setNickname: vi.fn(), clearNickname: vi.fn() }),
}));
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => ({ enabled: true, isLoading: false }) }));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => null }));
vi.mock("@/components/quick-note", () => ({ useQuickNote: () => ({ open: vi.fn() }) }));
vi.mock("@/components/SidebarProvider", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/SidebarProvider");
  return { ...actual, useOverlaySidebar: () => undefined };
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
vi.mock("@/components/appshell/useNearEnd", () => ({ useNearEnd: () => () => {} }));
type Outcome = "saved" | "failed" | "conflict";
const edit = vi.hoisted(() => ({ flush: null as null | (() => Promise<Outcome>) }));
vi.mock("../KnowledgeEditSection", async () => {
  const { useEffect } = await import("react");
  const Stub = (props: Record<string, unknown>) => {
    const handle = props.saveHandle as { current: unknown } | undefined;
    useEffect(() => {
      if (!handle) return;
      handle.current = { dirty: () => true, flush: () => edit.flush!() };
      dirtyRegistry.set("stub-editor", "knowledge-editor", true);
      return () => {
        handle.current = null;
        dirtyRegistry.set("stub-editor", "knowledge-editor", false);
      };
    }, [handle]);
    return <div data-testid="pane-editor" />;
  };
  return { default: Stub, KnowledgeEditSection: Stub };
});
vi.mock("@/lib/featureFlags", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/featureFlags");
  return { ...actual, isInlineKnowledgeEditorEnabled: () => true };
});
vi.mock("@/components/FileDetail/hooks/usePlainTextDocument", () => ({
  usePlainTextDocument: () => ({ decided: true, plainTextDocument: false }),
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

const VIEW_KEY = `litloft.addon.knowledge.view.${DRIVE}`;
const OLD_KEY = `litloft.addon.knowledge.classification.${DRIVE}`;
const TARGET_KEY = `litloft.addon.knowledge.target.${DRIVE}`;

const NOTES: Note[] = [
  { id: "n1", title: "Alpha", folder: "Journal", tags: ["trip"], updated: "2026-11-10T09:00:00Z", created: "2026-10-01T09:00:00Z", body: "Body of Alpha" },
  { id: "n2", title: "Beta", folder: "", tags: [], updated: "2026-11-09T09:00:00Z", created: "2026-10-03T09:00:00Z", body: "Body of Beta" },
  { id: "n3", title: "Gamma", folder: "Work", tags: ["trip", "food"], updated: "2026-11-08T09:00:00Z", created: "2026-10-02T09:00:00Z", body: "Body of Gamma" },
  { id: "n4", title: "Delta", folder: "Journal", tags: ["food"], updated: "2026-11-07T09:00:00Z", created: "2026-10-04T09:00:00Z", body: "Body of Delta" },
];

let server: Server;

function open(url = `${BASE}?view=all`) {
  nav.set(url);
  server = installNotesServer({
    notes: NOTES,
    smartFolders: [smartFolder("sf-trip", "Trip", "tag:trip"), smartFolder("sf-food", "Food", "tag:food")],
  });
  return render(<Page />);
}

beforeEach(() => {
  localStorage.clear();
  member.evaluation = null;
  edit.flush = async () => "saved";
  navigationGuard.reset();
  router.push.mockClear();
  router.replace.mockClear();
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  navigationGuard.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const listCalls = () => server.calls.filter((c) => (isFiles(c) || isFilesQuery(c)) && c.url.searchParams.get("limit") === "60");
const railCalls = () => server.calls.filter((c) => isCountsGet(c) || isCountsQuery(c) || isShelvesGet(c) || isShelvesQuery(c));
const tagRail = (c: { url: URL }) => c.url.pathname.includes("/shelves");
const storedViews = () => JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null");
const segmentMenu = () => screen.getByRole("button", { name: /^Group By: / });
const sortMenu = () => screen.getByRole("button", { name: /Date Modified|Title|Date Created/ });

async function chooseSegment(name: "Folders" | "Tags") {
  await waitFor(() => expect(segmentMenu()).toBeInTheDocument());
  fireEvent.click(segmentMenu());
  fireEvent.click(await screen.findByRole("menuitemradio", { name }));
}

async function chooseTarget(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /Target/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: new RegExp(name) }));
}

describe("SPEC-ADDON-148 the rail's 分類 menu at 1280px and wider", () => {
  it("SPEC-ADDON-148 I10 I12 the switch is a Group By menu named for the segment shown, with the entries below it", async () => {
    open(`${BASE}?view=all&sort=updated`);

    const menu = await screen.findByRole("button", { name: "Group By: Folders" });
    expect(menu.querySelector("svg")?.getAttribute("class")).toContain("lucide-layout-list");
    expect(screen.queryByRole("button", { name: /^Tags$/ })).toBeNull();
    const journal = await waitFor(() => {
      const found = ["button", "link", "option", "radio", "treeitem"].flatMap((role) =>
        screen.queryAllByRole(role as "button", { name: /^Journal/ }),
      );
      expect(found.length).toBeGreaterThan(0);
      return found[0];
    });
    expect(menu.compareDocumentPosition(journal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(menu);
    expect((await screen.findAllByRole("menuitemradio")).map((o) => o.textContent?.trim())).toEqual(["Folders", "Tags"]);
  });

  it("SPEC-ADDON-148 I1 I2 choosing Tags pushes without folder, tag and note, and writes the view for the Target in force only", async () => {
    open(`${BASE}?view=all&folder=Journal&note=n4&sort=updated`);
    await screen.findByRole("button", { name: "Group By: Folders" });

    await chooseSegment("Tags");

    await waitFor(() => expect(nav.params.has("folder")).toBe(false));
    expect(nav.last()?.kind).toBe("push");
    expect(nav.params.has("note")).toBe(false);
    expect(nav.params.has("tag")).toBe(false);
    expect(await screen.findByRole("button", { name: "Group By: Tags" })).toBeInTheDocument();
    expect(storedViews()).toEqual({ default: { group: "tag" } });
    expect(localStorage.getItem(OLD_KEY)).toBeNull();
  });

  it("SPEC-ADDON-148 I19 choosing the segment already shown writes the view, pushes nothing and keeps the selection", async () => {
    open(`${BASE}?view=all&folder=Journal&note=n4&sort=updated`);
    await screen.findByRole("button", { name: "Group By: Folders" });
    await act(() => settle());
    const before = nav.log.length;

    await chooseSegment("Folders");

    await waitFor(() => expect(storedViews()).toEqual({ default: { group: "folder" } }));
    expect(nav.log.slice(before).filter((n) => n.kind === "push")).toEqual([]);
    expect([nav.params.get("folder"), nav.params.get("note")]).toEqual(["Journal", "n4"]);
  });

  it("SPEC-ADDON-148 below 1280px the rail menu's segment group is headed Group By", async () => {
    setViewport(1100);
    open(`${BASE}?view=all&sort=updated`);

    fireEvent.click(await screen.findByRole("button", { name: /^Folders/ }));

    expect(await screen.findByText("Group By")).toBeInTheDocument();
    expect(screen.queryByText("Classify by")).toBeNull();
  });
});

describe("SPEC-ADDON-148 the segment in force", () => {
  it("SPEC-ADDON-148 I3 the default Target inherits the old per-drive segment, other Targets open on Folders", async () => {
    localStorage.setItem(OLD_KEY, "tag");
    localStorage.setItem(TARGET_KEY, "sf-food");
    open(`${BASE}?view=all&sort=updated`);

    expect(await screen.findByRole("button", { name: "Group By: Folders" })).toBeInTheDocument();
    await chooseTarget("All notes");

    expect(await screen.findByRole("button", { name: "Group By: Tags" })).toBeInTheDocument();
    expect(localStorage.getItem(OLD_KEY)).toBe("tag");
  });

  it("SPEC-ADDON-148 I8 a Target's stored segment and sort are the first rail and list requests", async () => {
    localStorage.setItem(TARGET_KEY, "sf-trip");
    localStorage.setItem(VIEW_KEY, JSON.stringify({ "sf-trip": { group: "tag", sort: "title" } }));
    open(`${BASE}?view=all`);

    expect(await screen.findByRole("button", { name: "Group By: Tags" })).toBeInTheDocument();
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    await act(() => settle());
    expect(railCalls().length).toBeGreaterThan(0);
    expect(railCalls().every(tagRail)).toBe(true);
    for (const call of listCalls()) expect(call.url.searchParams.get("sort")).toBe("title");
  });

  it("SPEC-ADDON-148 I3 a folder or tag in the URL implies the segment over the stored one", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ default: { group: "folder" } }));
    open(`${BASE}?view=all&tag=food&sort=updated`);

    expect(await screen.findByRole("button", { name: "Group By: Tags" })).toBeInTheDocument();
    expect(storedViews()).toEqual({ default: { group: "folder" } });
  });

  it("SPEC-ADDON-148 I4 each Target shows its own segment after switching back and forth", async () => {
    open(`${BASE}?view=all&sort=updated`);
    await chooseSegment("Tags");
    await screen.findByRole("button", { name: "Group By: Tags" });

    await chooseTarget("Trip");
    expect(await screen.findByRole("button", { name: "Group By: Folders" })).toBeInTheDocument();

    await chooseTarget("All notes");
    expect(await screen.findByRole("button", { name: "Group By: Tags" })).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-148 the sort in force and the URL", () => {
  it("SPEC-ADDON-148 I11 I13 a Library URL without sort is filled in by replace with the Target's stored sort, before any list request", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ default: { sort: "created" } }));
    open(`${BASE}?view=all&folder=Journal`);

    await waitFor(() => expect(nav.params.get("sort")).toBe("created"));
    expect(nav.log.every((n) => n.kind === "replace")).toBe(true);
    expect(nav.params.get("folder")).toBe("Journal");
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    for (const call of listCalls()) expect(call.url.searchParams.get("sort")).toBe("created_at");
  });

  it("SPEC-ADDON-148 I11 with nothing stored the URL is completed with sort=updated", async () => {
    open(`${BASE}?view=all`);

    await waitFor(() => expect(nav.params.get("sort")).toBe("updated"));
    expect(nav.last()?.kind).toBe("replace");
    expect(localStorage.getItem(VIEW_KEY)).toBeNull();
  });

  it("SPEC-ADDON-148 I13 a readable sort in the URL wins, is left as it is, and writes nothing", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ default: { sort: "title" } }));
    open(`${BASE}?view=all&sort=created`);

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    await act(() => settle());
    expect(nav.log.filter((n) => n.url.searchParams.get("sort") !== "created")).toEqual([]);
    for (const call of listCalls()) expect(call.url.searchParams.get("sort")).toBe("created_at");
    expect(sortMenu()).toHaveTextContent("Date Created");
    expect(storedViews()).toEqual({ default: { sort: "title" } });
  });

  it.each([
    ["a saved Target", "sf-trip"],
    ["a saved Target that is gone", "sf-gone"],
  ])("SPEC-ADDON-148 I13 on first load under %s a readable sort in the URL is left as it is and followed", async (_name, target) => {
    localStorage.setItem(TARGET_KEY, target);
    localStorage.setItem(VIEW_KEY, JSON.stringify({ [target]: { sort: "title" }, default: { sort: "title" } }));
    open(`${BASE}?view=all&sort=created`);

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    await act(() => settle());
    expect(nav.log.filter((n) => n.url.searchParams.get("sort") !== "created")).toEqual([]);
    for (const call of listCalls()) expect(call.url.searchParams.get("sort")).toBe("created_at");
    expect(sortMenu()).toHaveTextContent("Date Created");
  });

  it("SPEC-ADDON-148 I1 I12 choosing a sort pushes it and writes it; the sort menu shows ArrowDownUp and the value without a label", async () => {
    open(`${BASE}?view=all&sort=updated`);
    await waitFor(() => expect(sortMenu()).toBeInTheDocument());
    const menu = sortMenu();
    expect(menu.textContent?.trim()).toBe("Date Modified");
    expect(menu.querySelector("svg")?.getAttribute("class")).toContain("lucide-arrow-down-up");

    fireEvent.click(menu);
    expect((await screen.findAllByRole("menuitemradio")).map((o) => o.textContent?.trim())).toEqual([
      "Date Modified",
      "Title",
      "Date Created",
    ]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Title" }));

    await waitFor(() => expect(nav.log.some((n) => n.url.searchParams.get("sort") === "title")).toBe(true));
    expect(nav.log.find((n) => n.url.searchParams.get("sort") === "title")!.kind).toBe("push");
    expect(storedViews()).toEqual({ default: { sort: "title" } });
  });

  it("SPEC-ADDON-148 I4 a Target change replaces sort with the new Target's, keeps folder and q, and drops note", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ "sf-trip": { sort: "title" } }));
    open(`${BASE}?view=all&folder=Journal&q=Al&note=n1&sort=created`);
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    const before = nav.log.length;

    await chooseTarget("Trip");

    await waitFor(() => expect(nav.params.get("sort")).toBe("title"));
    expect([nav.params.get("folder"), nav.params.get("q"), nav.params.has("note")]).toEqual(["Journal", "Al", false]);
    expect(nav.log.slice(before).filter((n) => n.kind === "push")).toEqual([]);
  });

  it("SPEC-ADDON-148 I6 a saved Target that is gone reads and writes the default Target's view and stays stored", async () => {
    localStorage.setItem(TARGET_KEY, "sf-gone");
    localStorage.setItem(VIEW_KEY, JSON.stringify({ "sf-gone": { sort: "title" }, default: { sort: "created" } }));
    open(`${BASE}?view=all`);

    await waitFor(() => expect(nav.params.get("sort")).toBe("created"));
    fireEvent.click(sortMenu());
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Title" }));

    await waitFor(() => expect(storedViews()).toEqual({ "sf-gone": { sort: "title" }, default: { sort: "title" } }));
    expect(localStorage.getItem(TARGET_KEY)).toBe("sf-gone");
  });
});

describe("SPEC-ADDON-148 Targets that cannot be used, the save gate and failing storage", () => {
  it.each(["tooLarge", "failed"])("SPEC-ADDON-148 I6 a member Target that answers %s reads and writes the default Target's view", async (status) => {
    localStorage.setItem(TARGET_KEY, "sf-beach");
    localStorage.setItem(VIEW_KEY, JSON.stringify({ "sf-beach": { group: "tag", sort: "created" }, default: { sort: "title" } }));
    member.evaluation = async () => ({ status });
    nav.set(`${BASE}?view=all`);
    server = installNotesServer({ notes: NOTES, smartFolders: [smartFolder("sf-beach", "Beach", "beach")] });
    render(<Page />);

    expect(await screen.findByRole("button", { name: "Group By: Folders" })).toBeInTheDocument();
    await waitFor(() => expect(nav.params.get("sort")).toBe("title"));
    await chooseSegment("Tags");

    await waitFor(() =>
      expect(storedViews()).toEqual({ "sf-beach": { group: "tag", sort: "created" }, default: { sort: "title", group: "tag" } }),
    );
    expect(localStorage.getItem(TARGET_KEY)).toBe("sf-beach");
  });

  it.each([
    ["saved", true],
    ["failed", false],
  ] as const)("SPEC-ADDON-148 I19 a segment choice behind the save gate, with the save %s, writes the view only if the gate passes", async (outcome, writes) => {
    edit.flush = async () => outcome;
    open(`${BASE}?view=all&folder=Journal&note=n1&sort=updated`);
    await waitFor(() => expect(screen.queryByText("Body of Alpha")).not.toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await waitFor(() => expect(screen.queryByTestId("pane-editor")).not.toBeNull());

    await chooseSegment("Tags");

    if (writes) {
      await waitFor(() => expect(storedViews()).toEqual({ default: { group: "tag" } }));
      expect(nav.params.has("folder")).toBe(false);
    } else {
      await waitFor(() => expect(navigationGuard.getPending()).not.toBeNull());
      act(() => navigationGuard.cancel());
      await act(() => settle(50));
      expect(localStorage.getItem(VIEW_KEY)).toBeNull();
      expect(nav.params.get("folder")).toBe("Journal");
    }
    expect(localStorage.getItem(OLD_KEY)).toBeNull();
  });

  it("SPEC-ADDON-148 I5 with storage throwing, the Library opens on Folders and Date Modified and a choice stays shown", async () => {
    nav.set(`${BASE}?view=all`);
    server = installNotesServer({ notes: NOTES });
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
      expect(await screen.findByRole("button", { name: "Group By: Folders" })).toBeInTheDocument();
      await waitFor(() => expect(nav.params.get("sort")).toBe("updated"));

      await chooseSegment("Tags");

      expect(await screen.findByRole("button", { name: "Group By: Tags" })).toBeInTheDocument();
    } finally {
      Storage.prototype.getItem = getItem;
      Storage.prototype.setItem = setItem;
    }
  });
});

describe("SPEC-ADDON-148 I17 Home's Recently updated", () => {
  it("SPEC-ADDON-148 I17 See all opens the Library sorted by Date Modified whatever the stored sort", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ default: { sort: "title" } }));
    nav.set(BASE);
    server = installNotesServer({ notes: NOTES });
    render(<Page />);

    const heading = await screen.findByText("Recently updated");
    const section = (heading.closest("section") ?? heading.parentElement!.parentElement!) as HTMLElement;
    await within(section).findByText("Alpha");
    const link = within(section)
      .getAllByRole("link")
      .find((a) => new URL(a.getAttribute("href")!, "http://localhost").searchParams.get("view") === "all");
    expect(link).toBeDefined();
    const url = new URL(link!.getAttribute("href")!, "http://localhost");
    expect([url.searchParams.get("view"), url.searchParams.get("sort")]).toEqual(["all", "updated"]);
  });
});
