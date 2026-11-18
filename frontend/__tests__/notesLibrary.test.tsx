/**
 * SPEC-ADDON-132: the Notes Library — rail, list and reading pane, the pane's
 * editor and the gate in front of every change while it is mounted.
 * Invariant ids are those of docs/specs/notes-app.md.
 *
 * The pane's editor is replaced by a stand-in that publishes a `saveHandle`
 * the test controls, so the gate is driven by `flush()` outcomes directly.
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
  findText,
  installNotesServer,
  isContentRead,
  isCountsGet,
  isCountsQuery,
  isFiles,
  isFilesQuery,
  isMeta,
  listsOrCounts as listsOrCountsCall,
  isShelvesGet,
  isShelvesQuery,
  isProgress,
  isRelations,
  isSources,
  nav,
  router,
  setViewport,
  settle,
  smartFolder,
  textNodes,
  type Note,
  type Server,
} from "./notesAppHarness";

type Outcome = "saved" | "failed" | "conflict";
const edit = vi.hoisted(() => ({
  props: [] as Record<string, unknown>[],
  renderNothing: false,
  dirty: true,
  flush: null as null | ReturnType<typeof vi.fn>,
}));
vi.mock("../KnowledgeEditSection", async () => {
  const { useEffect } = await import("react");
  const Stub = (props: Record<string, unknown>) => {
    edit.props.push(props);
    const handle = props.saveHandle as { current: unknown } | undefined;
    useEffect(() => {
      if (edit.renderNothing || !handle) return;
      handle.current = { dirty: () => edit.dirty, flush: () => edit.flush!() };
      // The real editor publishes unsaved text here, and the guard asks for it.
      dirtyRegistry.set("stub-editor", "knowledge-editor", edit.dirty);
      return () => {
        handle.current = null;
        dirtyRegistry.set("stub-editor", "knowledge-editor", false);
      };
    }, [handle]);
    if (edit.renderNothing) return null;
    const strings = Object.values(props).filter((v) => typeof v === "string" || typeof v === "object");
    return <div data-testid="pane-editor" data-props={JSON.stringify(strings, (_k, v) => (typeof v === "function" ? undefined : v))} />;
  };
  return { default: Stub, KnowledgeEditSection: Stub };
});

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
const policy = vi.hoisted(() => ({ enabled: true as boolean | undefined, isLoading: false }));
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => ({ enabled: policy.enabled, isLoading: policy.isLoading }) }));
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
const nearEnd = vi.hoisted(() => ({ enabled: false, load: () => {} }));
vi.mock("@/components/appshell/useNearEnd", () => ({
  useNearEnd: (enabled: boolean, load: () => void) => {
    nearEnd.enabled = enabled;
    nearEnd.load = load;
    return () => {};
  },
}));
const plain = vi.hoisted(() => ({ state: { decided: true, plainTextDocument: false } }));
vi.mock("@/components/FileDetail/hooks/usePlainTextDocument", () => ({
  usePlainTextDocument: () => plain.state,
}));
vi.mock("@/components/TextPreview", () => ({
  TextPreview: ({ fileId }: { fileId: string }) => <div data-testid="text-preview">{fileId}</div>,
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

const CLASSIFICATION_KEY = `litloft.addon.knowledge.classification.${DRIVE}`;
const TARGET_KEY = `litloft.addon.knowledge.target.${DRIVE}`;

async function chooseTarget(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /Target/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: new RegExp(name) }));
}

const NOTES: Note[] = [
  { id: "n1", title: "Alpha", folder: "Journal", tags: ["trip"], updated: "2026-11-10T09:00:00Z", created: "2026-10-01T09:00:00Z", body: "Body of Alpha" },
  { id: "n2", title: "Beta", folder: "", tags: [], updated: "2026-11-09T09:00:00Z", created: "2026-10-03T09:00:00Z", body: "Body of Beta" },
  { id: "n3", title: "Gamma", folder: "Work", tags: ["trip", "food"], updated: "2026-11-08T09:00:00Z", created: "2026-10-02T09:00:00Z", body: "Body of Gamma" },
  { id: "n4", title: "Delta", folder: "Journal", tags: ["food"], updated: "2026-11-07T09:00:00Z", created: "2026-10-04T09:00:00Z", body: "Body of Delta" },
  { id: "c1", title: "Clipped", folder: "Journal", origin: "webclip", updated: "2026-11-11T09:00:00Z" },
];

let server: Server;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function open(url = `${BASE}?view=all`, notes: Note[] = NOTES, extra: Parameters<typeof installNotesServer>[0] = {}) {
  nav.set(url);
  server = installNotesServer({ notes, smartFolders: [smartFolder("sf-trip", "Trip", "tag:trip")], ...extra });
  return render(<Page />);
}

beforeEach(() => {
  localStorage.clear();
  router.push.mockClear();
  router.replace.mockClear();
  quickNote.open.mockReset();
  profile.nickname = "alice";
  flags.inline = true;
  policy.enabled = true;
  policy.isLoading = false;
  member.evaluation = null;
  plain.state = { decided: true, plainTextDocument: false };
  nearEnd.enabled = false;
  edit.props = [];
  edit.renderNothing = false;
  edit.dirty = true;
  edit.flush = vi.fn(async (): Promise<Outcome> => "saved");
  navigationGuard.reset();
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  navigationGuard.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ROLES = ["link", "button", "option", "radio", "tab", "menuitemradio", "treeitem"] as const;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every control whose accessible name starts with `name` and then, if given, shows `count`. */
function controls(name: string, count?: number): HTMLElement[] {
  const re = new RegExp(`^${escape(name)}${count === undefined ? "(\\b|$)" : `\\s*${count}$`}`);
  return ROLES.flatMap((role) => screen.queryAllByRole(role, { name: re }));
}
const control = (name: string, count?: number) => {
  const found = controls(name, count);
  if (found.length === 0) throw new Error(`no control named ${name}${count === undefined ? "" : ` ${count}`}`);
  return found[0];
};
const shown = (body: string) => screen.queryByText(body) !== null;
const paneEditor = () => screen.queryByTestId("pane-editor");
const editButton = () => screen.queryByRole("button", { name: "Edit" });
const listCalls = () => server.calls.filter((c) => (isFiles(c) || isFilesQuery(c)) && c.url.searchParams.get("limit") === "60");
const lastListParams = () => listCalls()[listCalls().length - 1]?.url.searchParams ?? new URLSearchParams("none=1");

async function chooseSort(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /Sort/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name }));
}

async function startEditing() {
  await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  await waitFor(() => expect(paneEditor()).not.toBeNull());
  await act(() => settle(10));
}

describe("SPEC-ADDON-132 Library step 1: the rail, Folders", () => {
  it("SPEC-ADDON-132 lists All with the total, then each folder with its count, ordered by path, the root as Drive root", async () => {
    open();

    await waitFor(() => expect(controls("Journal", 2)).toHaveLength(1));
    expect(control("Folders")).toBeInTheDocument();
    expect(control("Tags")).toBeInTheDocument();
    expect(control("All", 4)).toBeInTheDocument();
    expect(control("Drive root", 1)).toBeInTheDocument();
    expect(control("Work", 1)).toBeInTheDocument();
    const order = ["Drive root", "Journal", "Work"].map((n) => control(n));
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const counted = server.calls.filter((c) => isCountsGet(c) || isCountsQuery(c));
    expect(counted.length).toBeGreaterThan(0);
    for (const call of counted) {
      expect(call.url.searchParams.getAll("type")).toEqual(["text"]);
      expect(call.url.searchParams.get("exclude_origin")).toBe("webclip");
    }
  });

  it("SPEC-ADDON-132 a folder in the URL selects it; folder= (empty) is the drive root", async () => {
    open(`${BASE}?view=all&folder=`);

    await waitFor(() => expect(shown("Body of Beta")).toBe(true));
    expect(lastListParams().get("path")).toBe("");
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("SPEC-ADDON-132 a selected folder that has no note is drawn after the entries with the list's total, 0", async () => {
    open(`${BASE}?view=all&folder=Gone`);

    expect(await screen.findByText("No notes here")).toBeInTheDocument();
    await waitFor(() => expect(controls("Gone", 0)).toHaveLength(1));
    const work = control("Work");
    expect(work.compareDocumentPosition(control("Gone")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("SPEC-ADDON-132 when the counts fail the rail shows All and the selected entry without counts, and Try again; the list is unaffected", async () => {
    nav.set(`${BASE}?view=all&folder=Journal`);
    server = installNotesServer({ notes: NOTES });
    server.override = (c) => (isCountsGet(c) || isCountsQuery(c) ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
    expect(await screen.findAllByRole("button", { name: "Try again" })).toHaveLength(1);
    expect(control("All").textContent).toBe("All");
    expect(control("Journal").textContent).toBe("Journal");
    expect(controls("Work")).toEqual([]);
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-132 Library step 1: the rail, Tags and the segment", () => {
  it("SPEC-ADDON-132 I9 with neither folder nor tag the stored segment is shown", async () => {
    localStorage.setItem(CLASSIFICATION_KEY, "tag");
    open();

    await waitFor(() => expect(controls("trip", 2)).toHaveLength(1));
    expect(control("food", 2)).toBeInTheDocument();
    expect(controls("no_tag")).toEqual([]);
    const shelves = server.calls.filter((c) => c.url.pathname.includes("/shelves"));
    expect(shelves.length).toBeGreaterThan(0);
    for (const call of shelves) {
      expect(call.url.searchParams.get("by")).toBe("tag");
      expect(call.url.searchParams.get("shelf_limit")).toBe("24");
      expect(call.url.searchParams.getAll("type")).toEqual(["text"]);
      expect(call.url.searchParams.get("exclude_origin")).toBe("webclip");
    }
  });

  it("SPEC-ADDON-132 I9 choosing a segment writes the stored choice and removes folder, tag and note (push)", async () => {
    open(`${BASE}?view=all&folder=Journal&note=n4`);
    await waitFor(() => expect(shown("Body of Delta")).toBe(true));

    fireEvent.click(control("Tags"));

    await waitFor(() => expect(localStorage.getItem(CLASSIFICATION_KEY)).toBe("tag"));
    await waitFor(() => expect(nav.params.has("folder")).toBe(false));
    expect(nav.last()?.kind).toBe("push");
    expect(nav.params.has("tag")).toBe(false);
    expect(nav.params.has("note")).toBe(false);
    expect(nav.params.get("view")).toBe("all");
  });

  it("SPEC-ADDON-132 a tag in the URL shows Tags; with folder too, folder is removed (replace)", async () => {
    localStorage.setItem(CLASSIFICATION_KEY, "folder");
    open(`${BASE}?view=all&folder=Journal&tag=food`);

    await waitFor(() => expect(nav.params.has("folder")).toBe(false));
    expect(nav.last()?.kind).toBe("replace");
    expect(nav.params.get("tag")).toBe("food");
    await waitFor(() => expect(controls("trip", 2)).toHaveLength(1));
    expect(lastListParams().getAll("tag")).toEqual(["food"]);
    expect(lastListParams().has("path")).toBe(false);
  });

  it("SPEC-ADDON-132 I20 tags are requested 24 shelves at a time, one after another, and at most 200 are drawn", async () => {
    localStorage.setItem(CLASSIFICATION_KEY, "tag");
    const many: Note[] = Array.from({ length: 230 }, (_, i) => ({
      id: `t${i}`,
      title: `Tagged ${i}`,
      folder: "",
      tags: [`tag${String(i).padStart(3, "0")}`],
      updated: new Date(Date.UTC(2026, 10, 1) - i * 60_000).toISOString(),
    }));
    open(`${BASE}?view=all`, many);

    await waitFor(() => expect(screen.queryAllByText(/^tag199\b/)).toHaveLength(1), { timeout: 5000 });
    await act(() => settle(100));
    const shelves = server.calls.filter((c) => c.url.pathname.includes("/shelves"));
    expect(shelves.map((c) => c.url.searchParams.get("offset") ?? "0")).toEqual(
      ["0", "24", "48", "72", "96", "120", "144", "168", "192"],
    );
    expect(screen.queryAllByText(/^tag200\b/)).toEqual([]);
    expect(controls("tag000")).toHaveLength(1);
  });

  it("SPEC-ADDON-132 a later tag page that fails keeps the entries drawn and follows them with Try again", async () => {
    localStorage.setItem(CLASSIFICATION_KEY, "tag");
    const many: Note[] = Array.from({ length: 30 }, (_, i) => ({
      id: `t${i}`,
      title: `Tagged ${i}`,
      folder: "",
      tags: [`tag${String(i).padStart(3, "0")}`],
    }));
    nav.set(`${BASE}?view=all`);
    server = installNotesServer({ notes: many });
    server.override = (c) =>
      c.url.pathname.includes("/shelves") && c.url.searchParams.get("offset") === "24"
        ? new Response("{}", { status: 500 })
        : null;
    render(<Page />);

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(control("tag000", 1)).toBeInTheDocument();
    expect(control("tag023", 1)).toBeInTheDocument();
    expect(controls("tag024")).toEqual([]);
    expect(control("tag023").compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("SPEC-ADDON-132 Library step 2: the list", () => {
  it("SPEC-ADDON-132 asks for the selection under the Target, 60 a page, newest update first by default", async () => {
    open(`${BASE}?view=all&folder=Journal`);

    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
    const q = lastListParams();
    expect([q.get("path"), q.getAll("type"), q.get("exclude_origin"), q.get("sort"), q.get("order"), q.get("limit")]).toEqual([
      "Journal",
      ["text"],
      "webclip",
      "updated_at",
      "desc",
      "60",
    ]);
    expect(screen.getByText("Delta")).toBeInTheDocument();
    expect(screen.queryByText("Clipped")).toBeNull();
    expect(screen.getByPlaceholderText("Search Journal")).toBeInTheDocument();
  });

  it.each([
    ["title", "title", "asc"],
    ["created", "created_at", "desc"],
  ])("SPEC-ADDON-132 sort=%s asks for %s %s", async (sort, field, order) => {
    open(`${BASE}?view=all&sort=${sort}`);

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    await waitFor(() => expect(lastListParams().get("sort")).toBe(field));
    expect(lastListParams().get("order")).toBe(order);
  });

  it("SPEC-ADDON-132 a tag selection asks with tag= and names it in the search placeholder; All says Search notes", async () => {
    open(`${BASE}?view=all&tag=food`);
    await waitFor(() => expect(lastListParams().getAll("tag")).toEqual(["food"]));
    expect(screen.getByPlaceholderText("Search food")).toBeInTheDocument();
    cleanup();

    open(`${BASE}?view=all`);
    expect(await screen.findByPlaceholderText("Search notes")).toBeInTheDocument();
  });

  it("SPEC-ADDON-132 I8 the search applies on submit, sent as search, pushing q and removing note", async () => {
    open(`${BASE}?view=all&note=n3`);
    const field = await screen.findByPlaceholderText("Search notes");
    await waitFor(() => expect(shown("Body of Gamma")).toBe(true));
    const before = listCalls().length;

    fireEvent.change(field, { target: { value: "alp" } });
    await act(() => settle());
    expect(listCalls().length).toBe(before);
    fireEvent.submit(field.closest("form") ?? field);

    await waitFor(() => expect(nav.params.get("q")).toBe("alp"));
    expect(nav.last()?.kind).toBe("push");
    expect(nav.params.has("note")).toBe(false);
    await waitFor(() => expect(lastListParams().get("search")).toBe("alp"));
    expect(lastListParams().has("q")).toBe(false);
  });

  it("SPEC-ADDON-132 I8 ?view=all with folder, sort and q opens the Library with them", async () => {
    open(`${BASE}?view=all&folder=Journal&sort=title&q=del`);

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    const q = lastListParams();
    expect([q.get("path"), q.get("sort"), q.get("search")]).toEqual(["Journal", "title", "del"]);
    expect((await screen.findAllByText("Delta")).length).toBeGreaterThan(0);
  });

  it("SPEC-ADDON-132 an empty answer shows No notes here and no pane", async () => {
    open(`${BASE}?view=all&folder=Nowhere`);

    expect(await screen.findByText("No notes here")).toBeInTheDocument();
    expect(editButton()).toBeNull();
  });

  it("SPEC-ADDON-132 a failed list shows Try again, which asks again", async () => {
    nav.set(`${BASE}?view=all`);
    server = installNotesServer({ notes: NOTES });
    let fail = true;
    server.override = (c) => (fail && (isFiles(c) || isFilesQuery(c)) && c.url.searchParams.get("limit") === "60" ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    const retry = await screen.findByRole("button", { name: "Try again" });
    fail = false;
    fireEvent.click(retry);

    expect(await screen.findByText("Gamma")).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-132 Library step 3, step 4: choosing and reading a note", () => {
  it("SPEC-ADDON-132 with no note the pane shows the first row; choosing a row replaces note and shows it", async () => {
    open();

    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
    fireEvent.click(screen.getByText("Gamma"));

    await waitFor(() => expect(nav.params.get("note")).toBe("n3"));
    expect(nav.last()?.kind).toBe("replace");
    expect(await screen.findByText("Body of Gamma")).toBeInTheDocument();
    expect(shown("Body of Alpha")).toBe(false);
  });

  it("SPEC-ADDON-132 the meta line shows the folder and the tags; the view is recorded once per note shown", async () => {
    open(`${BASE}?view=all&note=n3`);

    await waitFor(() => expect(shown("Body of Gamma")).toBe(true));
    expect(screen.getAllByText("food").length).toBeGreaterThan(0);
    await act(() => settle(100));
    const views = server.calls.filter(isProgress);
    expect(views.map((c) => c.url.pathname)).toEqual(["/api/files/n3/progress"]);
    const body = views[0].body;
    expect(body === null || body === "" || (typeof body === "object" && Object.keys(body as object).length === 0)).toBe(true);
  });

  it("SPEC-ADDON-132 a note not among the rows is checked through files/query without the target and shown", async () => {
    open(`${BASE}?view=all&folder=Work&note=n1`);

    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
    const checks = server.calls.filter((c) => isFilesQuery(c) && JSON.stringify(c.body) === JSON.stringify({ file_ids: ["n1"] }));
    expect(checks.length).toBeGreaterThan(0);
    for (const call of checks) {
      const q = call.url.searchParams;
      expect([q.getAll("type"), q.get("exclude_origin"), q.has("path"), q.has("tag")]).toEqual([["text"], "webclip", false, false]);
    }
    expect(nav.params.get("note")).toBe("n1");
  });

  it("SPEC-ADDON-132 a note that is gone falls back to the first row and replaces note with it", async () => {
    open(`${BASE}?view=all&note=zz`);

    await waitFor(() => expect(nav.params.get("note")).toBe("n1"));
    expect(nav.last()?.kind).toBe("replace");
    expect(await screen.findByText("Body of Alpha")).toBeInTheDocument();
  });

  it("SPEC-ADDON-132 a gone note with an empty list removes note and draws no pane", async () => {
    open(`${BASE}?view=all&folder=Nowhere&note=zz`);

    await waitFor(() => expect(nav.params.has("note")).toBe(false));
    expect(screen.getByText("No notes here")).toBeInTheDocument();
    expect(editButton()).toBeNull();
  });

  it("SPEC-ADDON-132 a failed check shows the pane's error with Try again and keeps the URL", async () => {
    nav.set(`${BASE}?view=all&note=zz`);
    server = installNotesServer({ notes: NOTES });
    server.override = (c) => (isFilesQuery(c) && JSON.stringify(c.body) === JSON.stringify({ file_ids: ["zz"] }) ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    expect(await screen.findByText("Couldn't load this note")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
    expect(nav.params.get("note")).toBe("zz");
  });

  it.each([
    ["metadata", (id: string) => isMeta(id)],
    ["content", (id: string) => isContentRead(id)],
  ])("SPEC-ADDON-132 I5 when the %s fails: Couldn't load this note, Try again, and no Edit", async (_l, match) => {
    nav.set(`${BASE}?view=all&note=n1`);
    server = installNotesServer({ notes: NOTES });
    server.override = (c) => (match("n1")(c) ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    expect(await screen.findByText("Couldn't load this note")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
    expect(editButton()).toBeNull();
    expect(paneEditor()).toBeNull();
  });
});

describe("SPEC-ADDON-132 Library step 5, I6: when Edit is offered", () => {
  it("SPEC-ADDON-132 Edit is drawn for a Markdown note with the policy on and the flag on, and mounts the editor filling the pane", async () => {
    open();
    await startEditing();

    const props = edit.props[edit.props.length - 1];
    expect(JSON.stringify(props)).toContain("n1");
    expect(props.fillHeight).toBe(true);
    expect(props.frameless).toBe(true);
    expect(props.saveHandle).toEqual(expect.objectContaining({ current: expect.anything() }));
    expect(screen.queryByText("Connections")).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it.each([
    ["the policy is off", () => (policy.enabled = false)],
    ["the policy is unknown", () => ((policy.enabled = undefined), (policy.isLoading = true))],
    ["the inline editor flag is off", () => (flags.inline = false)],
  ])("SPEC-ADDON-132 I6 no Edit when %s", async (_l, arrange) => {
    arrange();
    open();

    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
    await act(() => settle());
    expect(editButton()).toBeNull();
    expect(screen.getByRole("link", { name: "Open the file page" })).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-132 Library step 7, I4, I18: Done and the gate", () => {
  it("SPEC-ADDON-132 I18 Done with saved unmounts the editor, loads the note again and asks list and rail again", async () => {
    open();
    await startEditing();
    const before = server.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(paneEditor()).toBeNull());
    expect(edit.flush).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
    const after = server.calls.slice(before);
    expect(after.some(isMeta("n1"))).toBe(true);
    expect(after.some(isContentRead("n1"))).toBe(true);
    expect(after.some(isRelations("n1"))).toBe(true);
    expect(after.some(isSources)).toBe(true);
    expect(after.some((c) => (isFiles(c) || isFilesQuery(c)) && c.url.searchParams.get("limit") === "60")).toBe(true);
    expect(after.some((c) => isCountsGet(c) || isCountsQuery(c))).toBe(true);
  });

  it.each([
    ["failed", "Couldn't save"],
    ["conflict", "Changed elsewhere"],
  ])("SPEC-ADDON-132 Done with %s keeps the editor and shows %s", async (outcome, message) => {
    edit.flush = vi.fn(async () => outcome as Outcome);
    open();
    await startEditing();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(paneEditor()).not.toBeNull();
    expect(navigationGuard.getPending()).toBeNull();
  });

  it("SPEC-ADDON-132 Done with an empty handle returns to reading", async () => {
    edit.renderNothing = true;
    open();
    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await act(() => settle());

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument());
    expect(edit.flush).not.toHaveBeenCalled();
    expect(shown("Body of Alpha")).toBe(true);
  });

  it("SPEC-ADDON-132 I4 while a save is pending Saving… shows and another note waits for it", async () => {
    const pending = deferred<Outcome>();
    edit.flush = vi.fn(() => pending.promise);
    open();
    await startEditing();

    fireEvent.click(screen.getByText("Gamma"));

    expect(await screen.findByText("Saving…")).toBeInTheDocument();
    await act(() => settle(50));
    expect(nav.params.get("note")).not.toBe("n3");
    expect(paneEditor()).not.toBeNull();

    await act(async () => pending.resolve("saved"));

    await waitFor(() => expect(nav.params.get("note")).toBe("n3"));
    expect(await screen.findByText("Body of Gamma")).toBeInTheDocument();
    expect(paneEditor()).toBeNull();
  });

  it("SPEC-ADDON-132 I4 a failed save hands the change to the navigation guard; cancelling keeps the editor on the same note", async () => {
    edit.flush = vi.fn(async () => "failed" as Outcome);
    open();
    await startEditing();

    fireEvent.click(screen.getByText("Gamma"));

    await waitFor(() => expect(navigationGuard.getPending()).not.toBeNull());
    expect(nav.params.get("note")).not.toBe("n3");
    act(() => navigationGuard.cancel());
    await act(() => settle());
    expect(paneEditor()).not.toBeNull();
    expect(nav.params.get("note")).not.toBe("n3");
    expect(JSON.stringify(edit.props[edit.props.length - 1])).toContain("n1");
  });

  it("SPEC-ADDON-132 I4 a conflicting save hands the change to the guard; confirming lets it happen", async () => {
    edit.flush = vi.fn(async () => "conflict" as Outcome);
    open();
    await startEditing();

    fireEvent.click(screen.getByText("Gamma"));

    await waitFor(() => expect(navigationGuard.getPending()).not.toBeNull());
    act(() => navigationGuard.confirm());
    await waitFor(() => expect(nav.params.get("note")).toBe("n3"));
    expect(await screen.findByText("Body of Gamma")).toBeInTheDocument();
  });

  const GATED: Array<[string, () => void, () => boolean]> = [
    ["a tab change", () => fireEvent.click(screen.getByRole("link", { name: "Home" })), () => nav.params.get("view") !== "all"],
    ["a segment change", () => fireEvent.click(control("Tags")), () => localStorage.getItem(CLASSIFICATION_KEY) === "tag"],
    ["a selection change", () => fireEvent.click(control("Work")), () => nav.params.get("folder") === "Work"],
    [
      "a search",
      () => {
        const field = screen.getByPlaceholderText("Search notes");
        fireEvent.change(field, { target: { value: "gam" } });
        fireEvent.submit(field.closest("form") ?? field);
      },
      () => nav.params.get("q") === "gam",
    ],
    ["Open the file page", () => fireEvent.click(screen.getByRole("link", { name: "Open the file page" })), () => nav.pathname !== BASE],
    ["a Target change", () => void chooseTarget("Trip"), () => localStorage.getItem(TARGET_KEY) === "sf-trip"],
    ["a sort change", () => void chooseSort("Title"), () => nav.params.get("sort") === "title"],
  ];

  it.each(GATED)("SPEC-ADDON-132 I4 %s waits for the save and happens on saved", async (_l, act1, happened) => {
    const pending = deferred<Outcome>();
    edit.flush = vi.fn(() => pending.promise);
    open();
    await startEditing();
    await waitFor(() => expect(controls("Work").length).toBeGreaterThan(0));

    act1();
    await act(() => settle(50));

    expect(edit.flush).toHaveBeenCalledTimes(1);
    expect(happened()).toBe(false);
    await act(async () => pending.resolve("saved"));
    await waitFor(() => expect(happened()).toBe(true));
  });

  it.each(GATED)("SPEC-ADDON-132 I4 %s after a failed save goes to the guard, and cancelling lets nothing happen", async (_l, act1, happened) => {
    edit.flush = vi.fn(async () => "failed" as Outcome);
    open();
    await startEditing();
    await waitFor(() => expect(controls("Work").length).toBeGreaterThan(0));

    act1();

    await waitFor(() => expect(navigationGuard.getPending()).not.toBeNull());
    expect(happened()).toBe(false);
    act(() => navigationGuard.cancel());
    await act(() => settle(50));
    expect(happened()).toBe(false);
    expect(paneEditor()).not.toBeNull();
  });

  it.each(GATED)("SPEC-ADDON-132 I4 %s after a conflicting save happens once the guard is confirmed", async (_l, act1, happened) => {
    edit.flush = vi.fn(async () => "conflict" as Outcome);
    open();
    await startEditing();
    await waitFor(() => expect(controls("Work").length).toBeGreaterThan(0));

    act1();

    await waitFor(() => expect(navigationGuard.getPending()).not.toBeNull());
    expect(happened()).toBe(false);
    act(() => navigationGuard.confirm());
    await waitFor(() => expect(happened()).toBe(true));
  });
});

describe("SPEC-ADDON-132 Library step 1, I3: the rail and the list under a Target", () => {
  it("SPEC-ADDON-132 a Target change keeps folder and tag and removes note", async () => {
    open(`${BASE}?view=all&folder=Journal&note=n4`);
    await waitFor(() => expect(shown("Body of Delta")).toBe(true));

    await chooseTarget("Trip");

    await waitFor(() => expect(localStorage.getItem(TARGET_KEY)).toBe("sf-trip"));
    await waitFor(() => expect(nav.params.has("note")).toBe(false));
    expect(nav.params.get("folder")).toBe("Journal");
    await waitFor(() => expect(lastListParams().getAll("tag")).toEqual(["trip"]));
    expect(lastListParams().get("path")).toBe("Journal");
  });

  it.each(["folder", "tag"])(
    "SPEC-ADDON-132 I3 under a member target the %s rail and the list send the same ids through the query routes",
    async (segment) => {
      localStorage.setItem(CLASSIFICATION_KEY, segment);
      localStorage.setItem(TARGET_KEY, "sf-beach");
      member.evaluation = async () => ({ status: "ready", fileIds: ["n1", "n3", "n4"] });
      open(`${BASE}?view=all`, NOTES, { smartFolders: [smartFolder("sf-beach", "Beach", "beach")] });

      if (segment === "folder") {
        await waitFor(() => expect(controls("Journal", 2)).toHaveLength(1));
        expect(control("Work", 1)).toBeInTheDocument();
        expect(controls("Drive root")).toEqual([]);
      } else {
        await waitFor(() => expect(controls("trip", 2)).toHaveLength(1));
        expect(control("food", 2)).toBeInTheDocument();
      }
      expect(control("All", 3)).toBeInTheDocument();
      const rail = server.calls.filter((c) => isCountsGet(c) || isCountsQuery(c) || isShelvesGet(c) || isShelvesQuery(c));
      expect(rail.length).toBeGreaterThan(0);
      expect(rail.filter((c) => isCountsGet(c) || isShelvesGet(c))).toEqual([]);
      const lists = server.calls.filter((c) => isFiles(c) || isFilesQuery(c));
      expect(lists.filter(isFiles)).toEqual([]);
      for (const call of [...rail, ...lists]) {
        expect((call.body as { file_ids: string[] }).file_ids).toEqual(["n1", "n3", "n4"]);
        expect(call.url.searchParams.getAll("type")).toEqual(["text"]);
        expect(call.url.searchParams.get("exclude_origin")).toBe("webclip");
      }
    },
  );
});

describe("SPEC-ADDON-132 Library step 8: Connections", () => {
  const related = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    relation_id: id,
    kind: "related",
    direction: "outgoing",
    origin: "markdown",
    created_at: "2026-01-01T00:00:00Z",
    created_by: null,
    file: { id, drive: DRIVE, filename: `${title}.md`, title, folder_path: "", file_type: "document", mime_type: "text/markdown", thumbnail_url: "", has_thumbnail: false, file_size: 1, duration: null, missing_since: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...extra },
  });
  const source = (id: string, locator: unknown) => ({
    source_file_id: id,
    title: `Source ${id}`,
    filename: `${id}.mp4`,
    folder_path: "Lectures",
    mime_type: "video/mp4",
    has_thumbnail: true,
    locator,
  });

  it("SPEC-ADDON-132 shows Related files and Sources with their counts, sources open at their locator, and the graph centred on the note", async () => {
    open(`${BASE}?view=all`, NOTES, {
      relations: { n1: [related("r1", "Linked note"), related("r2", "Lost note", { missing_since: "2026-02-01T00:00:00Z" })] },
      sources: { n1: [source("s1", { t: 95 }), source("s2", { page: 4 })] },
    });

    expect(await screen.findByText("Connections")).toBeInTheDocument();
    expect(textNodes("Related files 2")).not.toHaveLength(0);
    expect(textNodes("Sources 2")).not.toHaveLength(0);
    expect(screen.getByText("Linked note").closest("a")).not.toBeNull();
    expect(screen.getByText("Lost note").closest("a")).toBeNull();
    const s1 = new URL(screen.getByText("Source s1").closest("a")!.getAttribute("href")!, "http://localhost");
    const s2 = new URL(screen.getByText("Source s2").closest("a")!.getAttribute("href")!, "http://localhost");
    expect([s1.searchParams.get("file"), s1.searchParams.get("t")]).toEqual(["s1", "95"]);
    expect([s2.searchParams.get("file"), s2.searchParams.get("page")]).toEqual(["s2", "4"]);
    const graph = new URL(screen.getByRole("link", { name: /See this note in the graph/ }).getAttribute("href")!, "http://localhost");
    expect([graph.pathname, graph.searchParams.get("focus")]).toEqual([`${BASE}/connections`, "n1"]);
    const asked = server.calls.filter(isSources);
    expect((asked[asked.length - 1].body as { file_ids: string[] }).file_ids).toEqual(["n1"]);
  });

  it("SPEC-ADDON-132 a column with no entry, or whose request fails, is not drawn; with neither there is no section", async () => {
    nav.set(`${BASE}?view=all`);
    server = installNotesServer({ notes: NOTES, relations: { n1: [related("r1", "Linked note")] }, sources: { n1: [] } });
    render(<Page />);

    expect(await findText("Related files 1")).toBeInTheDocument();
    expect(textNodes("Sources 0")).toEqual([]);
    expect(document.body.textContent).not.toMatch(/Sources \d/);
    cleanup();

    nav.set(`${BASE}?view=all`);
    server = installNotesServer({ notes: NOTES, sources: { n1: [source("s1", null)] } });
    server.override = (c) => (isRelations("n1")(c) ? new Response("{}", { status: 500 }) : null);
    render(<Page />);
    expect(await findText("Sources 1")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Related files/);
    cleanup();

    nav.set(`${BASE}?view=all`);
    server = installNotesServer({ notes: NOTES });
    render(<Page />);
    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
    await act(() => settle(100));
    expect(screen.queryByText("Connections")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-132 Library step 9, I6: below 1024px", () => {
  it("SPEC-ADDON-132 I6 rows link to the file page, no pane is drawn and note is ignored", async () => {
    setViewport(1000);
    open(`${BASE}?view=all&note=n3`);

    const row = await screen.findByText("Gamma");
    const link = row.closest("a")!;
    const href = new URL(link.getAttribute("href")!, "http://localhost");
    expect(href.searchParams.get("file")).toBe("n3");
    expect(href.pathname.startsWith(`/drive/${DRIVE}`)).toBe(true);
    await act(() => settle(100));
    expect(editButton()).toBeNull();
    expect(shown("Body of Gamma")).toBe(false);
    expect(server.calls.some(isMeta("n3"))).toBe(false);
    expect(screen.getByPlaceholderText("Search notes")).toBeInTheDocument();
  });

  it("SPEC-ADDON-132 narrowing below 1024 removes a reading pane but keeps an editing one until Done", async () => {
    open();
    await startEditing();

    act(() => setViewport(900));
    await act(() => settle());

    expect(paneEditor()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(paneEditor()).toBeNull());
    await act(() => settle(100));
    expect(editButton()).toBeNull();
    expect(screen.getByText("Gamma").closest("a")).not.toBeNull();
  });
});

describe("SPEC-ADDON-132 Library step 2: paging, dates, openings and history", () => {
  const many = (count: number): Note[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `m${i}`,
      title: `Many ${i}`,
      folder: "",
      tags: [],
      updated: new Date(Date.UTC(2026, 10, 1) - i * 60_000).toISOString(),
    }));
  const pages = () => listCalls().map((c) => c.url.searchParams.get("page") ?? "1");

  it("SPEC-ADDON-132 scrolling to the end asks the next page and appends it; the last page ends the paging", async () => {
    open(`${BASE}?view=all`, many(130));

    expect(await screen.findByText("Many 59")).toBeInTheDocument();
    expect(screen.queryByText("Many 60")).toBeNull();
    expect(nearEnd.enabled).toBe(true);

    act(() => nearEnd.load());
    expect(await screen.findByText("Many 119")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Notes" })).getByText("Many 0")).toBeInTheDocument();
    expect(pages()).toEqual(["1", "2"]);

    await waitFor(() => expect(nearEnd.enabled).toBe(true));
    act(() => nearEnd.load());
    expect(await screen.findByText("Many 129")).toBeInTheDocument();
    expect(pages()).toEqual(["1", "2", "3"]);
    await waitFor(() => expect(nearEnd.enabled).toBe(false));
  });

  it.each([
    ["updated", "Jul 9, 2021"],
    ["created", "Mar 5, 2020"],
  ])("SPEC-ADDON-132 under sort=%s a row shows %s", async (sort, date) => {
    const notes: Note[] = [
      { id: "d1", title: "Dated", folder: "", tags: [], created: "2020-03-05T12:00:00Z", updated: "2021-07-09T12:00:00Z" },
    ];
    open(`${BASE}?view=all&sort=${sort}`, notes);

    const list = await screen.findByRole("region", { name: "Notes" });
    expect(await within(list).findByText("Dated")).toBeInTheDocument();
    const row = within(list).getByText("Dated").closest("a")!;
    expect(row.textContent).toContain(date);
    expect(row.textContent).not.toContain(date === "Jul 9, 2021" ? "Mar 5, 2020" : "Jul 9, 2021");
  });

  it("SPEC-ADDON-132 a selection change pushes history and drops note", async () => {
    open(`${BASE}?view=all&note=n1`);
    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
    await waitFor(() => expect(controls("Work").length).toBeGreaterThan(0));

    fireEvent.click(control("Work"));

    await waitFor(() => expect(nav.log.some((n) => n.url.searchParams.get("folder") === "Work")).toBe(true));
    const entry = nav.log.find((n) => n.url.searchParams.get("folder") === "Work")!;
    expect(entry.kind).toBe("push");
    expect(entry.url.searchParams.has("note")).toBe(false);
  });

  it("SPEC-ADDON-132 the sort control pushes history, drops note and names the current sort", async () => {
    open(`${BASE}?view=all&note=n3`);
    await waitFor(() => expect(shown("Body of Gamma")).toBe(true));
    expect(screen.getByRole("button", { name: /Sort/ })).toHaveTextContent("Updated");

    await chooseSort("Title");

    await waitFor(() => expect(nav.log.some((n) => n.url.searchParams.get("sort") === "title")).toBe(true));
    const entry = nav.log.find((n) => n.url.searchParams.get("sort") === "title")!;
    expect(entry.kind).toBe("push");
    expect(entry.url.searchParams.has("note")).toBe(false);
    expect(screen.getByRole("button", { name: /Sort/ })).toHaveTextContent("Title");
  });

  it("SPEC-ADDON-132 rows show their opening, and a row whose opening did not load has none", async () => {
    open(`${BASE}?view=all`, NOTES, { openings: { n1: "Opening of Alpha" } });

    const list = await screen.findByRole("region", { name: "Notes" });
    await waitFor(() => expect(within(list).queryByText("Opening of Alpha")).not.toBeNull());
    const asked = server.calls.filter((c) => c.url.pathname === "/api/addons/knowledge/note-openings");
    expect(asked.length).toBeGreaterThan(0);
    expect((asked[0].body as { file_ids: string[] }).file_ids).toEqual(expect.arrayContaining(["n1", "n2", "n3", "n4"]));
    const excerpt = (title: string) => within(list).getByText(title).closest("a")!.querySelector("[data-testid=note-excerpt]")!;
    expect(excerpt("Alpha").textContent).toBe("Opening of Alpha");
    expect(excerpt("Beta").textContent).toBe("");
  });

  it("SPEC-ADDON-132 when the openings request fails the rows are drawn without openings", async () => {
    nav.set(`${BASE}?view=all`);
    server = installNotesServer({ notes: NOTES, openings: { n1: "Opening of Alpha" } });
    server.override = (c) => (c.url.pathname === "/api/addons/knowledge/note-openings" ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    const list = await screen.findByRole("region", { name: "Notes" });
    expect(await within(list).findByText("Delta")).toBeInTheDocument();
    await act(() => settle(100));
    expect(within(list).queryByText("Opening of Alpha")).toBeNull();
  });
});

describe("SPEC-ADDON-132 Library: Target, rail and frame gaps", () => {
  const collection = {
    id: "c-mine",
    name: "Mine",
    description: null,
    drive: DRIVE,
    item_count: 2,
    first_file_id: "n1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it.each(["folder", "tag"])("SPEC-ADDON-132 I3 a collection Target reaches the %s rail and the list with collection=", async (segment) => {
    localStorage.setItem(CLASSIFICATION_KEY, segment);
    localStorage.setItem(TARGET_KEY, "collection:c-mine");
    const notes = NOTES.map((n) => (n.id === "n1" || n.id === "n3" ? { ...n, collections: ["Mine"] } : n));
    open(`${BASE}?view=all`, notes, { collections: [collection] });

    if (segment === "folder") {
      await waitFor(() => expect(controls("Journal", 1)).toHaveLength(1));
      expect(control("Work", 1)).toBeInTheDocument();
    } else {
      await waitFor(() => expect(controls("trip", 2)).toHaveLength(1));
      expect(control("food", 1)).toBeInTheDocument();
    }
    expect(control("All", 2)).toBeInTheDocument();
    const asked = server.calls.filter((c) => listsOrCountsCall(c));
    expect(asked.length).toBeGreaterThan(0);
    for (const call of asked) expect(call.url.searchParams.getAll("collection")).toEqual(["Mine"]);
    expect(screen.queryByText("Delta")).toBeNull();
  });

  it("SPEC-ADDON-132 a Target change through a lookup drops note and keeps the folder", async () => {
    const lookup = deferred<unknown>();
    member.evaluation = () => lookup.promise;
    open(`${BASE}?view=all&folder=Journal&note=n4`, NOTES, {
      smartFolders: [smartFolder("sf-beach", "Beach", "beach")],
    });
    await waitFor(() => expect(shown("Body of Delta")).toBe(true));

    await chooseTarget("Beach");
    await act(() => settle(50));
    await act(async () => lookup.resolve({ status: "ready", fileIds: ["n1", "n4"] }));

    await waitFor(() => expect(nav.params.has("note")).toBe(false));
    expect(nav.params.get("folder")).toBe("Journal");
  });

  it("SPEC-ADDON-132 the tag rail has an entry per tag and none for untagged notes", async () => {
    localStorage.setItem(CLASSIFICATION_KEY, "tag");
    open();

    await waitFor(() => expect(controls("trip", 2)).toHaveLength(1));
    const rail = screen.getByRole("navigation", { name: "Classification" });
    const entries = within(rail).getAllByRole("listitem");
    expect(entries.map((li) => li.textContent).sort()).toEqual(["All4", "food2", "trip2"]);
  });

  it("SPEC-ADDON-130 I13 the Library does not ask for an overlay sidebar", async () => {
    open();

    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
    expect(sidebar.overlay).not.toHaveBeenCalled();
  });
});

describe("SPEC-ADDON-132 Library step 5, I6: the file's kind", () => {
  const log: Note = { id: "p1", title: "Plain", folder: "", tags: [], mime: "text/plain", updated: "2026-11-12T09:00:00Z", body: "Plain body" };

  it("SPEC-ADDON-132 I6 a plain-text document is drawn as plain text and can be edited with plainTextDocument", async () => {
    plain.state = { decided: true, plainTextDocument: true };
    open(`${BASE}?view=all&note=p1`, [log, ...NOTES]);

    expect(await screen.findByTestId("text-preview")).toHaveTextContent("p1");
    expect(screen.queryByTestId("markdown")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await waitFor(() => expect(paneEditor()).not.toBeNull());
    expect(edit.props[edit.props.length - 1].plainTextDocument).toBe(true);
  });

  it.each([
    ["not a plain-text document", { decided: true, plainTextDocument: false }],
    ["not yet decided", { decided: false, plainTextDocument: false }],
  ])("SPEC-ADDON-132 I6 a text/plain file that is %s has no Edit", async (_l, state) => {
    plain.state = state;
    open(`${BASE}?view=all&note=p1`, [log, ...NOTES]);

    expect(await screen.findByTestId("text-preview")).toBeInTheDocument();
    await act(() => settle(100));
    expect(editButton()).toBeNull();
  });
});

describe("SPEC-ADDON-132 Library step 4, I21: only a chosen note records a view", () => {
  const views = () => server.calls.filter(isProgress).map((c) => c.url.pathname);

  it("SPEC-ADDON-132 I21 the first row shown with no note records nothing", async () => {
    open();

    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));
    await act(() => settle(100));
    expect(views()).toEqual([]);
  });

  it("SPEC-ADDON-132 I21 clicking a row records that note once", async () => {
    open();
    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));

    fireEvent.click(screen.getByText("Gamma"));

    expect(await screen.findByText("Body of Gamma")).toBeInTheDocument();
    await act(() => settle(100));
    expect(views()).toEqual(["/api/files/n3/progress"]);
  });

  it("SPEC-ADDON-132 I21 clicking the row already shown as the first row records it", async () => {
    open();
    await waitFor(() => expect(shown("Body of Alpha")).toBe(true));

    fireEvent.click(within(screen.getByRole("region", { name: "Notes" })).getByText("Alpha"));

    await waitFor(() => expect(views()).toEqual(["/api/files/n1/progress"]));
  });

  it("SPEC-ADDON-132 I21 the replacement for a note that is not a note records nothing", async () => {
    open(`${BASE}?view=all&note=zz`);

    await waitFor(() => expect(nav.params.get("note")).toBe("n1"));
    expect(await screen.findByText("Body of Alpha")).toBeInTheDocument();
    await act(() => settle(100));
    expect(views()).toEqual([]);
  });
});

describe("SPEC-ADDON-132 Library step 4, I21: choosing the replacement", () => {
  it("SPEC-ADDON-132 I21 clicking the row a replacement put in the URL records it", async () => {
    open(`${BASE}?view=all&note=zz`);
    await waitFor(() => expect(nav.params.get("note")).toBe("n1"));
    await screen.findByText("Body of Alpha");

    fireEvent.click(within(screen.getByRole("region", { name: "Notes" })).getByText("Alpha"));

    await waitFor(() => expect(server.calls.filter(isProgress).map((c) => c.url.pathname)).toEqual(["/api/files/n1/progress"]));
  });
});

describe("SPEC-ADDON-132 Library step 7: the row of the note on screen", () => {
  it("SPEC-ADDON-132 I4 clicking the row of the note being edited, with no note in the URL, does not run the gate", async () => {
    open();
    await startEditing();

    fireEvent.click(within(screen.getByRole("region", { name: "Notes" })).getByText("Alpha"));
    await act(() => settle(100));

    expect(edit.flush).not.toHaveBeenCalled();
    expect(paneEditor()).not.toBeNull();
    expect(nav.params.get("note")).toBe("n1");
  });

  it("SPEC-ADDON-132 an editing pane that replaces the list keeps the page gutter, with no inset", async () => {
    open();
    await startEditing();

    act(() => setViewport(900));
    await act(() => settle());

    const pane = screen.getByRole("article", { name: "Selected note" });
    expect(pane.parentElement!.className).not.toMatch(/\bpl-/);
  });
});

describe("SPEC-ADDON-132 Library: the phone's folder names", () => {
  const nested: Note[] = [
    { id: "x1", title: "Deep", folder: "Journal/2026", tags: [], updated: "2026-11-10T09:00:00Z", body: "Body of Deep" },
  ];

  it("SPEC-ADDON-132 on the phone the rail button and the search use the folder's last segment, and the sort sits beside the button", async () => {
    setViewport(390);
    open(`${BASE}?view=all&folder=Journal/2026`, nested);

    const railButton = await screen.findByRole("button", { name: /Folders: 2026/ });
    expect(screen.getByPlaceholderText("Search 2026")).toBeInTheDocument();
    const sort = screen.getByRole("button", { name: /Sort/ });
    expect(sort.parentElement!.parentElement).toBe(railButton.parentElement!.parentElement!.parentElement);
    expect(within(screen.getByRole("region", { name: "Notes" })).queryByRole("button", { name: /Sort/ })).toBeNull();
  });

  it("SPEC-ADDON-132 from 1024 up the full path stays", async () => {
    setViewport(1100);
    open(`${BASE}?view=all&folder=Journal/2026`, nested);

    expect(await screen.findByRole("button", { name: /Folders: Journal \/ 2026/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search Journal/2026")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Notes" })).getByRole("button", { name: /Sort/ })).toBeInTheDocument();
  });
});
