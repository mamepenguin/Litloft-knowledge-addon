/**
 * SPEC-ADDON-100: the Clips page. Invariant ids are those of
 * docs/specs/clips-app.md. Core requests are answered at `fetch`, so the
 * assertions read the query strings the spec names, whatever the helper's
 * option names. Labels are the English messages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";

import type { FileItem, WebSocketEvent } from "@/types";

// The shared setup substitutes `{name}` literally; a plural message such as a count needs ICU.
vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  const messages = (await import("@/messages/en.json")).default as unknown as Record<string, unknown>;
  const cache = new Map<string, ReturnType<typeof actual.createTranslator>>();
  const useTranslations = (namespace?: string) => {
    const key = namespace ?? "";
    let t = cache.get(key);
    if (!t) {
      t = actual.createTranslator({
        locale: "en",
        messages,
        namespace: namespace as never,
        onError: () => {},
        getMessageFallback: ({ key: k, namespace: ns }) => (ns ? `${ns}.${k}` : k),
      });
      cache.set(key, t);
    }
    return t;
  };
  return {
    useTranslations,
    useLocale: () => "en",
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

const DRIVE = "書庫 d";
const PATH = `/drive/${encodeURIComponent(DRIVE)}/addons/knowledge/clips`;

let params = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push, replace, back: vi.fn() }),
  usePathname: () => PATH,
}));
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => DRIVE }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

let nickname: string | null = "alice";
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname, setNickname: vi.fn(), clearNickname: vi.fn() }),
}));
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => ({ enabled: true, isLoading: false }) }));
vi.mock("@/components/FolderPicker", () => ({
  FolderPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="folder" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

let wsEvent: WebSocketEvent | null = null;
const wsListeners = new Set<() => void>();
function emit(event: string, data: Record<string, unknown>) {
  act(() => {
    wsEvent = { event, data } as WebSocketEvent;
    wsListeners.forEach((l) => l());
  });
}
vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: (filter?: string) => {
    const current = useSyncExternalStore(
      (l) => {
        wsListeners.add(l);
        return () => wsListeners.delete(l);
      },
      () => wsEvent,
    );
    if (!current || (filter && current.event !== filter)) return null;
    return current;
  },
}));

const createClip = vi.fn();
const findClipsByUrl = vi.fn();
const fetchNoteOpenings = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    createClip: (...a: unknown[]) => createClip(...a),
    findClipsByUrl: (...a: unknown[]) => findClipsByUrl(...a),
    fetchNoteOpenings: (...a: unknown[]) => fetchNoteOpenings(...a),
  };
});

const ClipsPage = (await import("../pages/clips")).default;

// --- core requests, answered at fetch --------------------------------------

type Answer = unknown | Error | Promise<unknown>;
type Kind = "count" | "all" | "unread" | "newClips" | "unverified" | "recent" | "other";

const calls: URL[] = [];
let answers: Record<Exclude<Kind, "other">, (u: URL) => Answer>;

function kindOf(u: URL): Kind {
  const p = u.searchParams;
  if (u.pathname.endsWith("/files")) return p.get("limit") === "1" ? "count" : "all";
  if (u.pathname.endsWith("/shelves")) {
    if (p.get("trust") === "unverified") return "unverified";
    return p.has("opened") ? "unread" : "newClips";
  }
  if (u.pathname.endsWith("/watch-history")) return "recent";
  return "other";
}

class HttpError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`HTTP ${status}`);
  }
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function route(input: RequestInfo | URL): Promise<Response> {
  const u = new URL(String(input), "http://x");
  if (!u.pathname.startsWith(`/api/drives/${encodeURIComponent(DRIVE)}/`)) return respond(404, {});
  calls.push(u);
  const kind = kindOf(u);
  if (kind === "other") return respond(404, {});
  try {
    const value = await answers[kind](u);
    return respond(200, value);
  } catch (e) {
    if (e instanceof HttpError) return respond(e.status, e.body);
    return respond(500, { detail: "down" });
  }
}

const of = (kind: Kind) => calls.filter((u) => kindOf(u) === kind);
const param = (u: URL, k: string) => u.searchParams.get(k);
const expectParams = (u: URL, want: Record<string, string>) =>
  expect(Object.fromEntries(Object.keys(want).map((k) => [k, param(u, k)]))).toEqual(want);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function clip(id: string, extra: Partial<FileItem> = {}): FileItem {
  return {
    id,
    filename: `${id}.md`,
    title: `Clip ${id}`,
    drive: DRIVE,
    folder_path: "web",
    mime_type: "text/markdown",
    file_type: "document",
    created_at: "2026-09-01T09:00:00Z",
    updated_at: "2026-09-02T09:00:00Z",
    tags: [],
    ...extra,
  } as FileItem;
}

const filesPage = (data: FileItem[], total = data.length) => ({ data, meta: { total, page: 1, limit: data.length || 1 } });
const shelf = (items: FileItem[]) => ({
  by: "all",
  shelves: [{ key: "all", label: "", count: items.length, items }],
  total_shelves: 1,
  base: "",
});
const history = (items: FileItem[]) => ({ data: items });
const VIEWER_REQUIRED = new HttpError(400, { detail: "viewer_required" });

const heading = (name: string) => screen.queryByRole("heading", { level: 2, name });
const before = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const header = () => screen.getByRole("heading", { level: 1, name: "Clips" }).closest("header")!;
const tab = (name: string) => screen.queryByRole("link", { name });
const LOAD_FAILED = "Couldn't load notes.";
const ACTION = "Clip a web page";
const URL_FIELD = "URL to clip";
const EMPTY = "No clips yet";

beforeEach(() => {
  params = new URLSearchParams();
  nickname = "alice";
  wsEvent = null;
  calls.length = 0;
  push.mockReset();
  replace.mockReset();
  createClip.mockReset().mockResolvedValue({ job_id: 7, file_id: "c7", status: "fetching" });
  findClipsByUrl.mockReset().mockResolvedValue([]);
  fetchNoteOpenings.mockReset().mockImplementation(async (_d: string, ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, `Opening of ${id}.`])),
  );
  answers = {
    count: () => filesPage([clip("x")], 7),
    all: () => filesPage([clip("a1")], 1),
    unread: () => shelf([clip("u1"), clip("u2")]),
    newClips: () => shelf([clip("n1")]),
    unverified: () => shelf([clip("v1")]),
    recent: () => history([clip("r1")]),
  };
  vi.stubGlobal("fetch", vi.fn(route));
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SPEC-ADDON-100 the page header", () => {
  it("SPEC-ADDON-100 draws the title, the drive and the clip count, and the primary action", async () => {
    render(<ClipsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Clips" })).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: ACTION })).toBeInTheDocument();
    await waitFor(() => expect(header().textContent).toMatch(/\b7\b/));
    expect(header().textContent).toContain(DRIVE);
    expectParams(of("count")[0], { origin: "webclip", limit: "1" });
  });

  it("SPEC-ADDON-100 I20 shows the drive alone, never 0, while the count loads", async () => {
    const count = deferred<unknown>();
    answers.count = () => count.promise;
    render(<ClipsPage />);
    await waitFor(() => expect(of("count")).toHaveLength(1));

    expect(header().textContent).toContain(DRIVE);
    expect(header().textContent).not.toMatch(/\b0\b/);

    await act(async () => count.resolve(filesPage([clip("x")], 7)));
    await waitFor(() => expect(header().textContent).toMatch(/\b7\b/));
  });

  it("SPEC-ADDON-100 I20 shows the drive alone, and no empty state, when the count fails; tabs and shelves still draw", async () => {
    answers.count = () => {
      throw new Error("down");
    };
    render(<ClipsPage />);

    await screen.findByRole("heading", { level: 2, name: "Unread" });
    expect(header().textContent).toContain(DRIVE);
    expect(header().textContent).not.toMatch(/\b0\b/);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(tab("Home")).not.toBeNull();
    expect(tab("All")).not.toBeNull();
  });
});

describe("SPEC-ADDON-100 the tabs", () => {
  it("SPEC-ADDON-100 links Home to the landing and All to view=all", async () => {
    render(<ClipsPage />);
    await screen.findByRole("heading", { level: 2, name: "Unread" });

    const home = new URL(tab("Home")!.getAttribute("href")!, `http://x${PATH}`);
    const all = new URL(tab("All")!.getAttribute("href")!, `http://x${PATH}`);
    expect([home.pathname, home.searchParams.get("view")]).toEqual([PATH, null]);
    expect([all.pathname, all.searchParams.get("view")]).toEqual([PATH, "all"]);
    expect(before(header(), tab("Home")!)).toBe(true);
    expect(before(tab("All")!, heading("Unread")!)).toBe(true);
  });
});

describe("SPEC-ADDON-100 I12 the landing with a profile", () => {
  it("SPEC-ADDON-100 asks for Unread, Recently opened and Unverified as the spec names them", async () => {
    render(<ClipsPage />);
    await screen.findByRole("heading", { level: 2, name: "Unverified" });

    expectParams(of("unread")[0], {
      by: "all",
      key: "all",
      origin: "webclip",
      opened: "false",
      sort: "created_at",
      order: "desc",
      per_shelf: "12",
    });
    expectParams(of("recent")[0], { filter: "all", origin: "webclip", limit: "12" });
    expectParams(of("unverified")[0], {
      by: "all",
      key: "all",
      origin: "webclip",
      trust: "unverified",
      sort: "created_at",
      order: "desc",
      per_shelf: "12",
    });
    expect(param(of("unverified")[0], "opened")).toBeNull();
    expect(of("newClips")).toHaveLength(0);
  });

  it("SPEC-ADDON-100 draws Unread, Recently opened, Unverified in order, each over its own rows", async () => {
    render(<ClipsPage />);
    await screen.findByRole("heading", { level: 2, name: "Unverified" });
    await screen.findByText("Clip v1");

    const [unread, recent, unverified] = ["Unread", "Recently opened", "Unverified"].map((n) => heading(n)!);
    expect([before(unread, recent), before(recent, unverified)]).toEqual([true, true]);
    const u1 = screen.getByText("Clip u1");
    const r1 = screen.getByText("Clip r1");
    const v1 = screen.getByText("Clip v1");
    expect([before(unread, u1), before(u1, recent), before(recent, r1), before(r1, unverified), before(unverified, v1)]).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(heading("New clips")).toBeNull();
  });

  it("SPEC-ADDON-100 does not draw a shelf with no files", async () => {
    answers.unverified = () => shelf([]);
    answers.recent = () => history([]);
    render(<ClipsPage />);
    await screen.findByText("Clip u1");
    await waitFor(() => expect(of("unverified")).toHaveLength(1));
    await waitFor(() => expect(of("recent")).toHaveLength(1));

    expect(heading("Unverified")).toBeNull();
    expect(heading("Recently opened")).toBeNull();
    expect(heading("Unread")).not.toBeNull();
  });

  it("SPEC-ADDON-100 shows Notes' could-not-load line for a failed shelf and still draws the others", async () => {
    answers.recent = () => {
      throw new Error("down");
    };
    render(<ClipsPage />);
    await screen.findByText("Clip v1");

    expect(screen.getByText("Clip u1")).toBeInTheDocument();
    expect(screen.getAllByText(LOAD_FAILED)).toHaveLength(1);
  });
});

describe("SPEC-ADDON-100 I12 the landing without a profile", () => {
  it("SPEC-ADDON-100 asks for New clips and Unverified, and never Recently opened", async () => {
    nickname = null;
    render(<ClipsPage />);
    await screen.findByRole("heading", { level: 2, name: "New clips" });
    await screen.findByText("Clip v1");

    expectParams(of("newClips")[0], {
      by: "all",
      key: "all",
      origin: "webclip",
      sort: "created_at",
      order: "desc",
      per_shelf: "12",
    });
    expect(calls.some((u) => u.searchParams.has("opened"))).toBe(false);
    expect(of("recent")).toHaveLength(0);
    expect(heading("Recently opened")).toBeNull();
    expect(heading("Unread")).toBeNull();
    expect(before(heading("New clips")!, heading("Unverified")!)).toBe(true);
  });
});

describe("SPEC-ADDON-100 I24 a 400 viewer_required", () => {
  it("SPEC-ADDON-100 switches to without-profile mode and asks nothing that needs a viewer again", async () => {
    answers.unread = () => {
      throw VIEWER_REQUIRED;
    };
    render(<ClipsPage />);

    await screen.findByRole("heading", { level: 2, name: "New clips" });
    await screen.findByText("Clip n1");
    expect(heading("Recently opened")).toBeNull();
    expect(heading("Unread")).toBeNull();

    const viewerCalls = () => calls.filter((u) => u.searchParams.has("opened") || kindOf(u) === "recent").length;
    const settled = viewerCalls();
    emit("knowledge.clip.ready", { job_id: 1, file_id: "z", title: "Z" });
    await waitFor(() => expect(of("count").length).toBeGreaterThan(1));
    await waitFor(() => expect(of("newClips").length).toBeGreaterThan(1));
    expect(viewerCalls()).toBe(settled);
  });

  it("SPEC-ADDON-100 asks for Unread again once the nickname changes", async () => {
    answers.unread = () => {
      throw VIEWER_REQUIRED;
    };
    const { rerender } = render(<ClipsPage />);
    await screen.findByRole("heading", { level: 2, name: "New clips" });
    const unreadBefore = of("unread").length;

    answers.unread = () => shelf([clip("u9")]);
    nickname = "bob";
    rerender(<ClipsPage />);

    await screen.findByRole("heading", { level: 2, name: "Unread" });
    expect(of("unread").length).toBe(unreadBefore + 1);
    await screen.findByRole("heading", { level: 2, name: "Recently opened" });
    expect(heading("New clips")).toBeNull();
  });
});

describe("SPEC-ADDON-100 shelf drawing", () => {
  it("SPEC-ADDON-100 draws nothing under the header until the count answers", async () => {
    const count = deferred<unknown>();
    answers.count = () => count.promise;
    render(<ClipsPage />);
    await waitFor(() => expect(of("unverified").length + of("unread").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));

    expect(tab("Home")).toBeNull();
    expect(heading("Unread")).toBeNull();
    expect(screen.queryByText("Clip u1")).toBeNull();

    await act(async () => count.resolve(filesPage([clip("x")], 7)));
    await screen.findByText("Clip u1");
    expect(tab("Home")).not.toBeNull();
  });

  it("SPEC-ADDON-100 does not draw a shelf until its openings answer, then shows the excerpt", async () => {
    const openings = deferred<Record<string, string>>();
    fetchNoteOpenings.mockImplementation(() => openings.promise);
    render(<ClipsPage />);
    await waitFor(() => expect(fetchNoteOpenings).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));

    expect(heading("Unread")).toBeNull();
    expect(screen.queryByText("Clip u1")).toBeNull();

    await act(async () => openings.resolve({ u1: "Opening of u1." }));
    await screen.findByText("Clip u1");
    expect(screen.getByText("Opening of u1.")).toBeInTheDocument();
  });

  it("SPEC-ADDON-100 draws the rows without excerpts when the openings request fails", async () => {
    fetchNoteOpenings.mockRejectedValue(new Error("down"));
    render(<ClipsPage />);

    await screen.findByText("Clip u1");
    expect(screen.queryByText(/Opening of/)).toBeNull();
  });

  it("SPEC-ADDON-100 opens a row at the core file page", async () => {
    render(<ClipsPage />);
    const title = await screen.findByText("Clip u1");

    const link = title.closest("a")!;
    expect(link.getAttribute("href")).toBe(`/drive/${encodeURIComponent(DRIVE)}/web?file=u1`);
  });

  it("SPEC-ADDON-100 I29 dates a row by when it was clipped, not when it was last changed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 14, 15, 0));
    try {
      params = new URLSearchParams({ view: "all" });
      answers.all = () =>
        filesPage([
          clip("today", { created_at: new Date(2026, 8, 14, 9).toISOString(), updated_at: new Date(2026, 0, 1).toISOString() }),
          clip("old", { created_at: new Date(2026, 0, 1).toISOString(), updated_at: new Date(2026, 8, 14, 10).toISOString() }),
        ]);
      render(<ClipsPage />);
      await screen.findByText("Clip today");

      const groups = screen.getAllByRole("heading", { level: 3 });
      expect(groups.map((h) => h.textContent)).toEqual(["Today", "Earlier"]);
      expect(before(groups[0], screen.getByText("Clip today"))).toBe(true);
      expect(before(screen.getByText("Clip today"), groups[1])).toBe(true);
      expect(before(groups[1], screen.getByText("Clip old"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SPEC-ADDON-100 I28 the empty state", () => {
  it.each([
    ["the landing", ""],
    ["view=all", "view=all"],
  ])("SPEC-ADDON-100 replaces the tabs and the list on %s at a count of 0", async (_, query) => {
    params = new URLSearchParams(query);
    answers.count = () => filesPage([], 0);
    answers.all = () => filesPage([], 0);
    answers.unread = () => shelf([]);
    answers.unverified = () => shelf([]);
    answers.recent = () => history([]);
    render(<ClipsPage />);

    await screen.findByText(EMPTY);
    expect(tab("Home")).toBeNull();
    expect(tab("All")).toBeNull();
    expect(heading("Unread")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Clips" })).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: ACTION })).toBeInTheDocument();
    expect(before(header(), screen.getByText(EMPTY))).toBe(true);
  });
});

describe("SPEC-ADDON-100 I25 refresh", () => {
  it("SPEC-ADDON-100 replaces the empty state once a clip added through the page's form is counted", async () => {
    let total = 0;
    answers.count = () => filesPage(total ? [clip("c7")] : [], total);
    answers.unread = () => shelf(total ? [clip("c7")] : []);
    answers.unverified = () => shelf(total ? [clip("c7")] : []);
    answers.recent = () => history([]);
    render(<ClipsPage />);
    await screen.findByText(EMPTY);

    fireEvent.click(within(header()).getByRole("button", { name: ACTION }));
    fireEvent.change(screen.getByRole("textbox", { name: URL_FIELD }), { target: { value: "https://example.com/a" } });
    total = 1;
    fireEvent.click(screen.getByRole("button", { name: "Clip" }));

    await waitFor(() => expect(createClip).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(EMPTY)).toBeNull());
    expect(tab("Home")).not.toBeNull();
    expect((await screen.findAllByText("Clip c7")).length).toBeGreaterThan(0);
    expect(of("count").length).toBe(2);
  });

  it("SPEC-ADDON-100 refreshes on a knowledge.clip.ready event, whatever drive it came from", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");
    const counts = of("count").length;
    const unread = of("unread").length;

    answers.unread = () => shelf([clip("u1", { title: "Finished title" })]);
    emit("knowledge.clip.ready", { job_id: 9, file_id: "u1", title: "Finished title" });

    await screen.findByText("Finished title");
    expect(of("count").length).toBe(counts + 1);
    expect(of("unread").length).toBe(unread + 1);
  });

  it("SPEC-ADDON-100 does not refresh on the event already held when the page mounted", async () => {
    wsEvent = { event: "knowledge.clip.ready", data: { job_id: 1, file_id: "old" } } as WebSocketEvent;
    render(<ClipsPage />);
    await screen.findByText("Clip v1");
    await new Promise((r) => setTimeout(r, 30));

    expect(of("count")).toHaveLength(1);
    expect(of("unread")).toHaveLength(1);
  });

  it("SPEC-ADDON-100 keeps drawn rows on screen while a refresh is on the way", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    const pending = deferred<unknown>();
    answers.unread = () => pending.promise;
    answers.count = () => pending.promise;
    emit("knowledge.clip.ready", { job_id: 9, file_id: "z" });
    await waitFor(() => expect(of("unread").length).toBe(2));

    expect(screen.getByText("Clip u1")).toBeInTheDocument();
    expect(heading("Unread")).not.toBeNull();
    expect(tab("Home")).not.toBeNull();
  });

  it("SPEC-ADDON-100 keeps drawn rows and shows no failure line when a refresh fails", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    answers.unread = () => {
      throw new Error("down");
    };
    answers.count = () => {
      throw new Error("down");
    };
    emit("knowledge.clip.ready", { job_id: 9, file_id: "z" });
    await waitFor(() => expect(of("unread").length).toBe(2));
    await new Promise((r) => setTimeout(r, 30));

    expect(screen.getByText("Clip u1")).toBeInTheDocument();
    expect(screen.queryByText(LOAD_FAILED)).toBeNull();
    expect(header().textContent).toMatch(/\b7\b/);
  });

  it("SPEC-ADDON-100 replaces loaded pages of view=all with page 1", async () => {
    params = new URLSearchParams({ view: "all" });
    const sixty = Array.from({ length: 60 }, (_, i) => clip(`p${i}`));
    answers.all = (u) => {
      const second = param(u, "page") === "2" || param(u, "offset") === "60";
      return second ? filesPage([clip("late")], 61) : filesPage(sixty, 61);
    };
    render(<ClipsPage />);
    await screen.findByText("Clip p0");
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    await screen.findByText("Clip late");

    emit("knowledge.clip.ready", { job_id: 9, file_id: "z" });
    await waitFor(() => expect(screen.queryByText("Clip late")).toBeNull());
    expect(screen.getByText("Clip p0")).toBeInTheDocument();
  });
});

describe("SPEC-ADDON-100 the clip form", () => {
  it("SPEC-ADDON-100 I27 opens under the header, and closing it hides it without unmounting it", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");
    expect(screen.queryByRole("textbox", { name: URL_FIELD })).toBeNull();

    const action = within(header()).getByRole("button", { name: ACTION });
    fireEvent.click(action);
    const field = screen.getByRole("textbox", { name: URL_FIELD });
    expect(before(header(), field)).toBe(true);
    fireEvent.change(field, { target: { value: "https://example.com/typed" } });

    fireEvent.click(action);
    expect(screen.queryByRole("textbox", { name: URL_FIELD })).toBeNull();
    expect(screen.getByRole("textbox", { name: URL_FIELD, hidden: true })).toHaveValue("https://example.com/typed");
  });

  it("SPEC-ADDON-100 I27 keeps the form through a tab switch and a refresh", async () => {
    const { rerender } = render(<ClipsPage />);
    await screen.findByText("Clip u1");
    fireEvent.click(within(header()).getByRole("button", { name: ACTION }));
    fireEvent.change(screen.getByRole("textbox", { name: URL_FIELD }), { target: { value: "https://example.com/typed" } });

    params = new URLSearchParams({ view: "all" });
    rerender(<ClipsPage />);
    await screen.findByText("Clip a1");
    emit("knowledge.clip.ready", { job_id: 9, file_id: "z" });
    await waitFor(() => expect(of("all").length).toBeGreaterThan(1));

    expect(screen.getByRole("textbox", { name: URL_FIELD, hidden: true })).toHaveValue("https://example.com/typed");
  });

  it("SPEC-ADDON-100 I26 opens with the form open and submits a bookmarklet's prefill once", async () => {
    params = new URLSearchParams({ prefill: "https://example.com/a", title: "A", autosubmit: "1" });
    render(<ClipsPage />);

    await waitFor(() => expect(createClip).toHaveBeenCalledTimes(1));
    expect(createClip.mock.calls[0][0]).toBe(DRIVE);
    expect((createClip.mock.calls[0][1] as { url: string }).url).toBe("https://example.com/a");
    expect(screen.getByRole("textbox", { name: URL_FIELD })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(createClip).toHaveBeenCalledTimes(1);
  });
});

describe("SPEC-ADDON-100 I29 view=all", () => {
  beforeEach(() => {
    params = new URLSearchParams({ view: "all" });
  });

  it("SPEC-ADDON-100 asks for every clip newest first, 60 at a time, and draws no shelves or filters", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip a1");

    expectParams(of("all")[0], { origin: "webclip", sort: "created_at", order: "desc", limit: "60" });
    expect(of("unread")).toHaveLength(0);
    expect(of("unverified")).toHaveLength(0);
    expect(heading("Unread")).toBeNull();
    for (const name of ["Folder", "Tag", "Sort"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("SPEC-ADDON-100 draws nothing under the tabs while page 1 loads", async () => {
    const first = deferred<unknown>();
    answers.all = () => first.promise;
    render(<ClipsPage />);
    await waitFor(() => expect(of("all")).toHaveLength(1));
    await screen.findByRole("link", { name: "All" });

    expect(screen.queryByText(LOAD_FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole("button", { name: /more/i })).toBeNull();

    await act(async () => first.resolve(filesPage([clip("a1")], 1)));
    await screen.findByText("Clip a1");
  });

  it("SPEC-ADDON-100 loads the next page and appends it", async () => {
    const sixty = Array.from({ length: 60 }, (_, i) => clip(`p${i}`));
    answers.all = (u) =>
      param(u, "page") === "2" || param(u, "offset") === "60" ? filesPage([clip("late")], 61) : filesPage(sixty, 61);
    render(<ClipsPage />);
    await screen.findByText("Clip p59");

    fireEvent.click(screen.getByRole("button", { name: /more/i }));

    await screen.findByText("Clip late");
    expect(screen.getByText("Clip p0")).toBeInTheDocument();
    expect(of("all")).toHaveLength(2);
    expect(of("all")[1].search).not.toBe(of("all")[0].search);
  });

  it("SPEC-ADDON-100 shows the could-not-load line and a retry when page 1 fails", async () => {
    let fail = true;
    answers.all = () => {
      if (fail) throw new Error("down");
      return filesPage([clip("a1")], 1);
    };
    render(<ClipsPage />);

    await screen.findByText(LOAD_FAILED);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    await screen.findByText("Clip a1");
    expect(of("all")[1].search).toBe(of("all")[0].search);
  });

  it("SPEC-ADDON-100 keeps the rows and retries the same page when a later page fails", async () => {
    const sixty = Array.from({ length: 60 }, (_, i) => clip(`p${i}`));
    let failSecond = true;
    answers.all = (u) => {
      const second = param(u, "page") === "2" || param(u, "offset") === "60";
      if (!second) return filesPage(sixty, 61);
      if (failSecond) throw new Error("down");
      return filesPage([clip("late")], 61);
    };
    render(<ClipsPage />);
    await screen.findByText("Clip p0");

    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    await screen.findByText(LOAD_FAILED);
    expect(screen.getByText("Clip p0")).toBeInTheDocument();

    failSecond = false;
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    await screen.findByText("Clip late");
    expect(of("all")[2].search).toBe(of("all")[1].search);
  });
});
