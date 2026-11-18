/**
 * SPEC-ADDON-138 / 139 / 140: the Clips page. Invariant ids are those of
 * docs/specs/clips-frame.md; SPEC-ADDON-100 ids (I11, I20, I24, I26, I27) are
 * the ones that still hold. Core requests are answered at `fetch` by a small
 * fake drive, so the assertions read the query strings the spec names.
 * Labels are the English messages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useSyncExternalStore } from "react";

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
const profileListeners = new Set<() => void>();
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => {
    const current = useSyncExternalStore(
      (l) => {
        profileListeners.add(l);
        return () => profileListeners.delete(l);
      },
      () => nickname,
    );
    return { nickname: current, setNickname: vi.fn(), clearNickname: vi.fn() };
  },
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

// The scroll sentinel's observer, driven by hand: jsdom has none.
type Entries = { isIntersecting: boolean }[];
const observers = new Set<(entries: Entries) => void>();
class FakeIntersectionObserver {
  private readonly callback: (entries: Entries) => void;
  constructor(callback: (entries: Entries) => void) {
    this.callback = callback;
    observers.add(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    observers.delete(this.callback);
  }
}
function reachEnd() {
  act(() => {
    [...observers].forEach((cb) => cb([{ isIntersecting: true }]));
  });
}

const createClip = vi.fn();
const findClipsByUrl = vi.fn();
const fetchClipCovers = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    createClip: (...a: unknown[]) => createClip(...a),
    findClipsByUrl: (...a: unknown[]) => findClipsByUrl(...a),
    fetchClipCovers: (...a: unknown[]) => fetchClipCovers(...a),
  };
});

const ClipsPage = (await import("../pages/clips")).default;

// --- a fake drive, answered at fetch ----------------------------------------

interface Call {
  url: URL;
  method: string;
  body: unknown;
}
const calls: Call[] = [];

class HttpError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`HTTP ${status}`);
  }
}
const VIEWER_REQUIRED = new HttpError(400, { detail: "viewer_required" });

function clip(id: string, extra: Partial<FileItem> = {}): FileItem {
  return {
    id,
    filename: `${id}.md`,
    title: `Clip ${id}`,
    drive: DRIVE,
    folder_path: "web",
    mime_type: "text/markdown",
    file_type: "document",
    file_size: 3000,
    created_at: "2026-09-01T09:00:00Z",
    updated_at: "2026-09-02T09:00:00Z",
    tags: [],
    trust_tier: "verified",
    ...extra,
  } as FileItem;
}

interface Fake {
  clips: FileItem[];
  opened: Set<string>;
  recent: FileItem[];
  /** The `files` total for a request that carries a collection condition. */
  collectionTotal: number;
  fail: (u: URL, method: string) => Error | undefined;
  hold: (u: URL, method: string) => Promise<void> | undefined;
  collections: { id: string; name: string }[];
  verifyFails: boolean;
}
let fake: Fake;

function newest(a: FileItem, b: FileItem) {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1;
}

function shelvesAnswer(u: URL) {
  const p = u.searchParams;
  let rows = fake.clips.filter((c) => !(p.get("trust") === "unverified" && c.trust_tier !== "unverified"));
  if (p.has("opened")) rows = rows.filter((c) => !fake.opened.has(c.id));
  const ids = p.getAll("ids");
  if (ids.length) rows = rows.filter((c) => ids.includes(c.id));
  rows = [...rows].sort(p.get("sort") === "title" ? (a, b) => a.title.localeCompare(b.title) : newest);
  if (p.get("order") === "asc" && p.get("sort") !== "title") rows.reverse();
  const perShelf = Number(p.get("per_shelf") ?? 12);
  const page = Number(p.get("page") ?? 1);
  const slice = (list: FileItem[]) => list.slice((page - 1) * perShelf, page * perShelf);
  const by = p.get("by");
  if (by === "all") {
    return { by, shelves: [{ key: "all", label: "", count: rows.length, items: slice(rows) }], total_shelves: 1, base: "" };
  }
  const tags = new Map<string, FileItem[]>();
  for (const c of rows) {
    for (const tag of c.tags.length ? c.tags : ["no_tag"]) tags.set(tag, [...(tags.get(tag) ?? []), c]);
  }
  const ranked = [...tags.keys()]
    .filter((k) => k !== "no_tag")
    .sort((a, b) => tags.get(b)!.length - tags.get(a)!.length || a.localeCompare(b));
  if (tags.has("no_tag")) ranked.push("no_tag");
  const key = p.get("key");
  const offset = Number(p.get("offset") ?? 0);
  const keys = key ? ranked.filter((k) => k === key) : ranked.slice(offset, offset + Number(p.get("shelf_limit") ?? 12));
  return {
    by,
    shelves: keys.map((k) => ({ key: k, label: k === "no_tag" ? "" : k, count: tags.get(k)!.length, items: slice(tags.get(k)!) })),
    total_shelves: ranked.length,
    base: "",
  };
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function route(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const u = new URL(String(input), "http://x");
  const method = init?.method ?? "GET";
  const base = `/api/drives/${encodeURIComponent(DRIVE)}`;
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  if (!u.pathname.startsWith("/api/")) return respond(404, {});
  calls.push({ url: u, method, body });
  const held = fake.hold(u, method);
  if (held) await held;
  const failure = fake.fail(u, method);
  try {
    if (failure) throw failure;
    if (u.pathname === `${base}/smart-folders`) return respond(200, []);
    if (u.pathname === `${base}/collections`) return respond(200, fake.collections);
    if (u.pathname === `${base}/files`) {
      const total = u.searchParams.has("collection") ? fake.collectionTotal : fake.clips.length;
      return respond(200, { data: [], meta: { total, page: 1, limit: 1 } });
    }
    if (u.pathname === `${base}/shelves`) {
      if (u.searchParams.has("opened") && !nickname) throw VIEWER_REQUIRED;
      return respond(200, shelvesAnswer(u));
    }
    if (u.pathname === `${base}/watch-history`) {
      return respond(200, { data: fake.recent.map((c) => ({ ...c, watch_progress: {} })) });
    }
    if (/^\/api\/files\/[^/]+\/trust-tier$/.test(u.pathname) && method === "PUT") {
      if (fake.verifyFails) throw new HttpError(500, {});
      const id = u.pathname.split("/")[3];
      const done = fake.clips.find((c) => c.id === id)!;
      fake.clips = fake.clips.map((c) => (c.id === id ? { ...c, trust_tier: "verified" } : c));
      return respond(200, { ...done, trust_tier: "verified" });
    }
    return respond(404, {});
  } catch (e) {
    if (e instanceof HttpError) return respond(e.status, e.body);
    return respond(500, { detail: "down" });
  }
}

const shelfCalls = (match: (p: URLSearchParams) => boolean) =>
  calls.filter((c) => c.url.pathname.endsWith("/shelves") && match(c.url.searchParams));
const isDots = (p: URLSearchParams) => p.has("ids");
const isUnread = (p: URLSearchParams) => p.has("opened") && !p.has("ids");
const isUnverified = (p: URLSearchParams) => p.get("trust") === "unverified";
const isNew = (p: URLSearchParams) =>
  p.get("by") === "all" && !p.has("opened") && !p.has("ids") && !p.has("trust") && !p.has("page");
const isTagShelves = (p: URLSearchParams) => p.get("by") === "tag" && !p.has("key");
const isGrid = (p: URLSearchParams) =>
  p.get("by") === "all" && p.has("page") && !p.has("opened") && !p.has("trust") && !p.has("ids");
const counts = () => calls.filter((c) => c.url.pathname.endsWith("/files"));
const histories = () => calls.filter((c) => c.url.pathname.endsWith("/watch-history"));
const verifies = () => calls.filter((c) => c.method === "PUT");
const q = (c: Call, key: string) => c.url.searchParams.get(key);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const heading = (name: string) => screen.queryByRole("heading", { level: 2, name });
const before = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const header = () => screen.getByRole("heading", { level: 1, name: "Clips" }).closest("header")!;
const tab = (name: string) => screen.queryByRole("link", { name });
const ACTION = "Clip a web page";
const URL_FIELD = "URL to clip";
const EMPTY = "No clips yet";
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 30)));
const TARGET_KEY = `litloft.addon.knowledge-clips.target.${encodeURIComponent(DRIVE)}`;
const sixty = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    clip(`k${String(i).padStart(2, "0")}`, { created_at: `2026-09-01T09:${String(i).padStart(2, "0")}:00Z` }),
  );
const failWhen = (match: (u: URL) => boolean) => (u: URL) => (match(u) ? new Error("down") : undefined);

const covers = (map: Record<string, { image_id?: string | null; image_url?: string | null; site?: string | null }>) =>
  fetchClipCovers.mockImplementation(async (_d: string, ids: string[]) =>
    Object.fromEntries(
      ids.filter((id) => map[id]).map((id) => [id, { image_id: null, image_url: null, site: null, ...map[id] }]),
    ),
  );

beforeEach(() => {
  params = new URLSearchParams();
  nickname = "alice";
  wsEvent = null;
  calls.length = 0;
  observers.clear();
  push.mockReset();
  replace.mockReset();
  createClip.mockReset().mockResolvedValue({ job_id: 7, file_id: "c7", status: "fetching" });
  findClipsByUrl.mockReset().mockResolvedValue([]);
  fetchClipCovers.mockReset().mockResolvedValue({});
  fake = {
    clips: [
      clip("u1", { created_at: "2026-09-04T09:00:00Z" }),
      clip("u2", { created_at: "2026-09-03T09:00:00Z" }),
      clip("o1", { created_at: "2026-09-02T09:00:00Z" }),
      clip("v1", { created_at: "2026-09-01T09:00:00Z", trust_tier: "unverified" }),
    ],
    opened: new Set(["o1", "v1"]),
    recent: [clip("o1")],
    collectionTotal: 0,
    collections: [],
    verifyFails: false,
    fail: () => undefined,
    hold: () => undefined,
  };
  vi.stubGlobal("fetch", vi.fn(route));
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SPEC-ADDON-138 the frame", () => {
  it("SPEC-ADDON-138 draws the title, the scope line with the drive and the count, the Target and the primary action in that order", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    expect(screen.getByRole("heading", { level: 1, name: "Clips" })).toBeInTheDocument();
    expect(header().textContent).toContain(DRIVE);
    await waitFor(() => expect(header().textContent).toContain("4 clips"));
    const target = within(header()).getByRole("button", { name: /Target/ });
    const action = within(header()).getByRole("button", { name: ACTION });
    expect(target).toHaveTextContent("All clips");
    expect(before(target, action)).toBe(true);
  });

  it("SPEC-ADDON-138 counts the scope line with the target, type=text and origin=webclip", async () => {
    render(<ClipsPage />);
    await waitFor(() => expect(counts().length).toBeGreaterThan(0));

    const count = counts()[0];
    expect(q(count, "limit")).toBe("1");
    expect(q(count, "type")).toBe("text");
    expect(q(count, "origin")).toBe("webclip");
  });

  it("SPEC-ADDON-138 links Home to the URL without view and Library to view=all, and marks the current one", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    expect(tab("Home")).toHaveAttribute("href", PATH);
    expect(tab("Library")).toHaveAttribute("href", `${PATH}?view=all`);
    expect(tab("Home")).toHaveAttribute("aria-current", "page");
  });

  it("SPEC-ADDON-138 shows the drive alone, and no empty state, when the count fails; shelves still draw", async () => {
    fake.fail = failWhen((u) => u.pathname.endsWith("/files"));
    render(<ClipsPage />);

    await screen.findByText("Clip u1");
    expect(header().textContent).not.toMatch(/\d+ clips?/);
    expect(screen.queryByText(EMPTY)).toBeNull();
  });
});

describe("SPEC-ADDON-138 Home with a profile", () => {
  it("SPEC-ADDON-138 asks for Unread, Recently opened and Unverified as the spec names them", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");
    await screen.findByText("Clip v1");

    const unread = shelfCalls(isUnread)[0];
    expect(["by", "key", "opened", "sort", "order", "per_shelf", "type", "origin"].map((k) => q(unread, k))).toEqual([
      "all", "all", "false", "created_at", "desc", "12", "text", "webclip",
    ]);
    const unverified = shelfCalls(isUnverified)[0];
    expect(["by", "key", "trust", "per_shelf", "type", "origin"].map((k) => q(unverified, k))).toEqual([
      "all", "all", "unverified", "5", "text", "webclip",
    ]);
    const history = histories()[0];
    expect(["filter", "type", "origin", "limit"].map((k) => q(history, k))).toEqual(["all", "text", "webclip", "12"]);
  });

  it("SPEC-ADDON-138 draws Unread with its count, Recently opened, then Unverified, each with See all", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip v1");
    await screen.findByText("Clip o1");

    const unread = heading("Unread")!;
    expect(unread.parentElement).toHaveTextContent("2");
    expect(before(unread, heading("Recently opened")!)).toBe(true);
    expect(before(heading("Recently opened")!, heading("Unverified")!)).toBe(true);
    const seeAll = (name: string) => screen.getByRole("link", { name: `See all: ${name}` });
    expect(seeAll("Unread")).toHaveAttribute("href", `${PATH}?view=shelf&shelf=unread`);
    expect(seeAll("Recently opened")).toHaveAttribute("href", `${PATH}?view=shelf&shelf=recent`);
    expect(seeAll("Unverified")).toHaveAttribute("href", `${PATH}?view=shelf&shelf=unverified`);
  });

  it("SPEC-ADDON-138 does not draw a shelf with no cards", async () => {
    fake.recent = [];
    fake.clips = fake.clips.filter((c) => c.trust_tier !== "unverified");
    render(<ClipsPage />);
    await screen.findByText("Clip u1");
    await settle();

    expect(heading("Recently opened")).toBeNull();
    expect(heading("Unverified")).toBeNull();
  });

  it("SPEC-ADDON-138 draws skeleton cards in a shelf until its answer arrives", async () => {
    const gate = deferred();
    fake.hold = (u) => (u.pathname.endsWith("/shelves") && isUnread(u.searchParams) ? gate.promise : undefined);
    render(<ClipsPage />);

    await waitFor(() => expect(heading("Unread")).not.toBeNull());
    expect(screen.getAllByTestId("clip-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("Clip u1")).toBeNull();
    gate.resolve();
    await screen.findByText("Clip u1");
  });

  it("SPEC-ADDON-138 shows Couldn't load with Try again for a failed shelf and leaves the others", async () => {
    let failing = true;
    fake.fail = (u) => (failing && u.pathname.endsWith("/watch-history") ? new Error("down") : undefined);
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    const recent = heading("Recently opened")!.closest("section")!;
    await within(recent).findByText("Couldn't load");
    expect(screen.getByText("Clip v1")).toBeInTheDocument();
    failing = false;
    fireEvent.click(within(recent).getByRole("button", { name: "Try again" }));
    await screen.findByText("Clip o1");
  });

  it("SPEC-ADDON-138 starts Home's shelves over, showing skeletons rather than the old cards, when the nickname changes", async () => {
    const { rerender } = render(<ClipsPage />);
    await screen.findByText("Clip u1");

    const gate = deferred();
    fake.hold = (u) => (u.pathname.endsWith("/shelves") && isUnread(u.searchParams) ? gate.promise : undefined);
    nickname = "bob";
    rerender(<ClipsPage />);

    await waitFor(() => expect(shelfCalls(isUnread).length).toBe(2));
    expect(screen.queryByText("Clip u1")).toBeNull();
    expect(screen.getAllByTestId("clip-skeleton").length).toBeGreaterThan(0);
    gate.resolve();
    await screen.findByText("Clip u1");
  });
});

describe("SPEC-ADDON-138 Home without a profile", () => {
  beforeEach(() => {
    nickname = null;
  });

  it("SPEC-ADDON-138 draws New clips and Unverified, and asks for nothing that needs a viewer", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");
    await screen.findByRole("button", { name: "Mark as verified" });

    expect(heading("New clips")).not.toBeNull();
    expect(heading("Unread")).toBeNull();
    expect(heading("Recently opened")).toBeNull();
    expect(histories()).toHaveLength(0);
    expect(shelfCalls((p) => p.has("opened"))).toHaveLength(0);
    expect(q(shelfCalls(isNew)[0], "per_shelf")).toBe("12");
  });

  it("SPEC-ADDON-138 I4 draws no unread dot and asks no dot request", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");
    await settle();

    expect(screen.queryAllByTestId("unread-dot")).toHaveLength(0);
    expect(shelfCalls(isDots)).toHaveLength(0);
  });
});

describe("SPEC-ADDON-138 I11 a 400 viewer_required", () => {
  it("SPEC-ADDON-100 I24 switches to without-profile mode and sends no viewer request again until the nickname changes", async () => {
    fake.fail = (u) => (u.pathname.endsWith("/shelves") && isUnread(u.searchParams) ? VIEWER_REQUIRED : undefined);
    const { rerender } = render(<ClipsPage />);

    await screen.findByText("New clips");
    await settle();
    const viewer = () => shelfCalls((p) => p.has("opened")).length + histories().length;
    const sent = viewer();
    expect(heading("Unread")).toBeNull();
    expect(heading("Recently opened")).toBeNull();

    emit("knowledge.clip.ready", { job_id: 1, file_id: "n" });
    await settle();
    expect(viewer()).toBe(sent);

    fake.fail = () => undefined;
    nickname = "bob";
    rerender(<ClipsPage />);
    await screen.findByText("Unread");
    expect(viewer()).toBeGreaterThan(sent);
  });

  it("SPEC-ADDON-138 I4 ends the dots after a 400 from the dot request", async () => {
    params = new URLSearchParams({ view: "all", group: "none" });
    fake.fail = (u) => (u.pathname.endsWith("/shelves") && isDots(u.searchParams) ? VIEWER_REQUIRED : undefined);
    render(<ClipsPage />);

    await screen.findByText("Clip u1");
    await settle();
    const sent = shelfCalls(isDots).length;
    expect(screen.queryAllByTestId("unread-dot")).toHaveLength(0);
    emit("knowledge.clip.ready", { job_id: 1, file_id: "n" });
    await settle();
    expect(shelfCalls(isDots).length).toBe(sent);
  });
});

describe("SPEC-ADDON-138 cards", () => {
  it("SPEC-ADDON-138 titles a card by the file's title, else its filename without the extension", async () => {
    fake.clips = [clip("a", { title: "", filename: "salmon-bowl.md" })];
    fake.opened = new Set();
    render(<ClipsPage />);

    await screen.findByText("salmon-bowl");
  });

  it("SPEC-ADDON-140 draws the cover and the site, with the reading time, once the answer arrives", async () => {
    fake.clips = [clip("a", { file_size: 4500 }), clip("b", { file_size: 100 })];
    fake.opened = new Set();
    covers({
      a: { image_id: "img1", site: "recipe.example.jp" },
      b: { image_url: "https://cdn.example.com/b.jpg", site: "blog.example.com" },
    });
    render(<ClipsPage />);

    const card = (await screen.findByText("Clip a")).closest("a")!;
    await waitFor(() => expect(card.textContent).toContain("recipe.example.jp · 3 min"));
    expect(card.querySelector("img")).toHaveAttribute("src", "/api/files/img1/thumbnail");
    const other = screen.getByText("Clip b").closest("a")!;
    const external = other.querySelector("img")!;
    expect(external).toHaveAttribute("src", "https://cdn.example.com/b.jpg");
    expect(external).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(external).toHaveAttribute("loading", "lazy");
    expect(other.textContent).toContain("1 min");
  });

  it("SPEC-ADDON-140 I8 draws a card at once with the 4:3 tint, the title and the minutes, before any cover answer", async () => {
    const gate = deferred();
    fetchClipCovers.mockImplementation(() => gate.promise.then(() => ({})));
    render(<ClipsPage />);

    const card = (await screen.findByText("Clip u1")).closest("a")!;
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector(".aspect-\\[4\\/3\\]")).not.toBeNull();
    expect(card.textContent).toMatch(/2 min/);
    gate.resolve();
  });

  it("SPEC-ADDON-140 leaves the tint when the cover image fails to load", async () => {
    covers({ u1: { image_url: "https://cdn.example.com/x.jpg" } });
    render(<ClipsPage />);
    const card = (await screen.findByText("Clip u1")).closest("a")!;
    await waitFor(() => expect(card.querySelector("img")).not.toBeNull());

    fireEvent.error(card.querySelector("img")!);
    expect(card.querySelector("img")).toBeNull();
  });

  it("SPEC-ADDON-138 opens the clip's file page from a card", async () => {
    render(<ClipsPage />);
    const card = (await screen.findByText("Clip u1")).closest("a")!;

    expect(card.getAttribute("href")).toContain("file=u1");
  });

  it("SPEC-ADDON-138 I4 draws the dot on every Unread card and on no Recently opened card, and never asks about the latter", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip o1");

    const dots = (name: string) => within(heading(name)!.closest("section")!).queryAllByTestId("unread-dot");
    const cards = screen.getByText("Clip u1").closest("ul")!.querySelectorAll("li").length;
    expect(dots("Unread")).toHaveLength(cards);
    expect(dots("Recently opened")).toHaveLength(0);
    expect(shelfCalls(isDots).flatMap((c) => c.url.searchParams.getAll("ids"))).not.toContain("o1");
  });

  it("SPEC-ADDON-138 I4 asks for the dots of the other cards with ids, per_shelf=60 and no target, and draws them where returned", async () => {
    params = new URLSearchParams({ view: "all", group: "none" });
    render(<ClipsPage />);
    await screen.findByText("Clip o1");

    await waitFor(() => expect(shelfCalls(isDots).length).toBeGreaterThan(0));
    const ask = shelfCalls(isDots)[0];
    expect(["by", "key", "opened", "per_shelf"].map((k) => q(ask, k))).toEqual(["all", "all", "false", "60"]);
    expect(ask.url.searchParams.getAll("ids").sort()).toEqual(["o1", "u1", "u2", "v1"]);
    expect(ask.url.searchParams.has("collection")).toBe(false);
    const dot = (title: string) => screen.getByText(title).closest("a")!.querySelector("[data-testid=unread-dot]");
    await waitFor(() => expect(dot("Clip u1")).not.toBeNull());
    expect(dot("Clip o1")).toBeNull();
  });

  it("SPEC-ADDON-138 I4 draws no dot until the answer arrives, and none when the request fails", async () => {
    params = new URLSearchParams({ view: "all", group: "none" });
    const gate = deferred();
    fake.hold = (u) => (isDots(u.searchParams) ? gate.promise : undefined);
    fake.fail = failWhen((u) => isDots(u.searchParams) && u.pathname.endsWith("/shelves"));
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    expect(screen.queryAllByTestId("unread-dot")).toHaveLength(0);
    gate.resolve();
    await settle();
    expect(screen.queryAllByTestId("unread-dot")).toHaveLength(0);
  });
});

describe("SPEC-ADDON-140 asking for covers", () => {
  it("SPEC-ADDON-140 asks for every drawn card, at most 60 ids a request, and not again for an id the route left out", async () => {
    params = new URLSearchParams({ view: "all", group: "none" });
    fake.clips = sixty(61);
    fake.opened = new Set();
    render(<ClipsPage />);
    await screen.findByText("Clip k60");

    await waitFor(() => expect(fetchClipCovers).toHaveBeenCalledTimes(1));
    reachEnd();
    await screen.findByText("Clip k00");
    await waitFor(() => expect(fetchClipCovers).toHaveBeenCalledTimes(2));
    const sizes = fetchClipCovers.mock.calls.map((c) => (c[1] as string[]).length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(60);
    emit("knowledge.clip.ready", { job_id: 1, file_id: "elsewhere" });
    await settle();
    const asked = fetchClipCovers.mock.calls.flatMap((c) => c[1] as string[]);
    expect(asked.filter((id) => id === "k05")).toHaveLength(1);
  });

  it("SPEC-ADDON-140 asks again at the next refresh for the cards whose ask failed", async () => {
    fetchClipCovers.mockRejectedValueOnce(new Error("down"));
    render(<ClipsPage />);
    await screen.findByText("Clip u1");
    await settle();
    const first = fetchClipCovers.mock.calls.length;

    emit("knowledge.clip.ready", { job_id: 1, file_id: "elsewhere" });
    await waitFor(() => expect(fetchClipCovers.mock.calls.length).toBeGreaterThan(first));
    expect(fetchClipCovers.mock.calls.slice(first).flatMap((c) => c[1] as string[])).toContain("u1");
  });

  it("SPEC-ADDON-140 asks again, at the refresh, for the clip the event names and for no other that was answered", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");
    await settle();
    const first = fetchClipCovers.mock.calls.length;

    emit("knowledge.clip.ready", { job_id: 1, file_id: "u2" });
    await waitFor(() => expect(fetchClipCovers.mock.calls.length).toBeGreaterThan(first));
    expect(fetchClipCovers.mock.calls.slice(first).flatMap((c) => c[1] as string[])).toEqual(["u2"]);
  });
});

describe("SPEC-ADDON-138 Mark as verified", () => {
  it("SPEC-ADDON-138 I5 puts verified for that file only, from the Unverified rows only", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip v1");

    expect(screen.getAllByRole("button", { name: "Mark as verified" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Mark as verified" }));

    await waitFor(() => expect(verifies()).toHaveLength(1));
    expect(verifies()[0].url.pathname).toBe("/api/files/v1/trust-tier");
    expect(verifies()[0].body).toEqual({ tier: "verified" });
    await waitFor(() => expect(screen.queryByText("Clip v1")).toBeNull());
    expect(heading("Unverified")).toBeNull();
  });

  it("SPEC-ADDON-138 disables the button while saving and removes the row without reloading the shelf", async () => {
    const gate = deferred();
    fake.hold = (_u, m) => (m === "PUT" ? gate.promise : undefined);
    render(<ClipsPage />);
    await screen.findByText("Clip v1");
    const asked = shelfCalls(isUnverified).length;

    fireEvent.click(screen.getByRole("button", { name: "Mark as verified" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark as verified" })).toBeDisabled());
    gate.resolve();

    await waitFor(() => expect(screen.queryByText("Clip v1")).toBeNull());
    expect(shelfCalls(isUnverified)).toHaveLength(asked);
  });

  it("SPEC-ADDON-138 keeps the card, says Couldn't save, and lets the button be pressed again after a failure", async () => {
    fake.verifyFails = true;
    render(<ClipsPage />);
    await screen.findByText("Clip v1");

    fireEvent.click(screen.getByRole("button", { name: "Mark as verified" }));
    await screen.findByText("Couldn't save");
    expect(screen.getByText("Clip v1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as verified" })).toBeEnabled();

    fake.verifyFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Mark as verified" }));
    await waitFor(() => expect(screen.queryByText("Clip v1")).toBeNull());
    expect(verifies()).toHaveLength(2);
  });

  it("SPEC-ADDON-138 neither removes nor re-adds the card when a refresh arrives while it is saving", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip v1");
    const gate = deferred();
    fake.hold = (_u, m) => (m === "PUT" ? gate.promise : undefined);

    fireEvent.click(screen.getByRole("button", { name: "Mark as verified" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark as verified" })).toBeDisabled());
    emit("knowledge.clip.ready", { job_id: 2, file_id: "z" });
    await waitFor(() => expect(shelfCalls(isUnverified).length).toBe(2));
    await settle();
    expect(screen.getByText("Clip v1")).toBeInTheDocument();

    gate.resolve();
    await waitFor(() => expect(screen.queryByText("Clip v1")).toBeNull());
    await settle();
    expect(screen.queryByText("Clip v1")).toBeNull();
  });

  it("SPEC-ADDON-138 keeps a saving row on Home when a refresh brings five newer rows in front of it", async () => {
    const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}T09:00:00Z`;
    fake.clips = [1, 2, 3, 4, 5].map((n) => clip(`v${n}`, { created_at: day(10 - n), trust_tier: "unverified" }));
    render(<ClipsPage />);
    await screen.findAllByText("Clip v5");
    const gate = deferred();
    fake.hold = (_u, m) => (m === "PUT" ? gate.promise : undefined);

    fireEvent.click(screen.getAllByRole("button", { name: "Mark as verified" })[4]);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Mark as verified" })[4]).toBeDisabled());
    fake.clips = [
      ...[1, 2, 3, 4, 5].map((n) => clip(`n${n}`, { created_at: day(20 - n), trust_tier: "unverified" })),
      ...fake.clips,
    ];
    emit("knowledge.clip.ready", { job_id: 2, file_id: "z" });
    await screen.findAllByText("Clip n5");
    expect(screen.getAllByText("Clip v5").length).toBeGreaterThan(0);
    gate.resolve();
  });
});

describe("SPEC-ADDON-139 Library", () => {
  beforeEach(() => {
    params = new URLSearchParams({ view: "all" });
    fake.clips = [
      clip("a", { tags: ["soup"], created_at: "2026-09-05T09:00:00Z" }),
      clip("b", { tags: ["soup", "fish"], created_at: "2026-09-04T09:00:00Z" }),
      clip("c", { tags: [], created_at: "2026-09-03T09:00:00Z" }),
    ];
    fake.opened = new Set();
  });

  it("SPEC-ADDON-139 asks by tag with the target, 12 per shelf and 12 shelves, and draws each shelf's tag, count and See all", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip a");

    const ask = shelfCalls(isTagShelves)[0];
    expect(["by", "per_shelf", "shelf_limit", "offset", "type", "origin", "sort", "order"].map((k) => q(ask, k))).toEqual([
      "tag", "12", "12", "0", "text", "webclip", "created_at", "desc",
    ]);
    expect(heading("soup")!.parentElement).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: "See all: soup" })).toHaveAttribute("href", `${PATH}?view=shelf&shelf=tag%3Asoup&sort=newest`);
    const order = ["soup", "fish", "Untagged"].map((n) => heading(n)!);
    expect(before(order[0], order[1])).toBe(true);
    expect(before(order[1], order[2])).toBe(true);
    expect(screen.getByRole("link", { name: "See all: Untagged" })).toHaveAttribute("href", `${PATH}?view=shelf&shelf=untagged&sort=newest`);
  });

  it("SPEC-ADDON-139 draws the Library's cards with site and minutes but no age", async () => {
    covers({ a: { site: "recipe.example.jp" } });
    render(<ClipsPage />);

    const card = (await screen.findByText("Clip a")).closest("a")!;
    await waitFor(() => expect(card.textContent).toContain("recipe.example.jp · 2 min"));
    expect(card.textContent).not.toMatch(/Sep|ago|:/);
  });

  it("SPEC-ADDON-139 draws two menu buttons, By tag and Newest clipped", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip a");

    expect(screen.getByRole("button", { name: "Grouping: By tag" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort: Newest clipped" })).toBeInTheDocument();
  });

  it("SPEC-ADDON-139 pushes the choice of a sort and of a grouping into the URL", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip a");

    fireEvent.click(screen.getByRole("button", { name: "Sort: Newest clipped" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest clipped" }));
    expect(push).toHaveBeenLastCalledWith(`${PATH}?view=all&group=tags&sort=oldest`);

    fireEvent.click(screen.getByRole("button", { name: "Grouping: By tag" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "No grouping" }));
    expect(push).toHaveBeenLastCalledWith(`${PATH}?view=all&group=none&sort=newest`);
  });

  it.each([
    ["oldest", ["created_at", "asc"]],
    ["title", ["title", "asc"]],
    ["newest", ["created_at", "desc"]],
  ])("SPEC-ADDON-139 sorts the cards by %s as %j", async (sort, want) => {
    params = new URLSearchParams({ view: "all", sort });
    render(<ClipsPage />);
    await screen.findByText("Clip a");

    const ask = shelfCalls(isTagShelves)[0];
    expect([q(ask, "sort"), q(ask, "order")]).toEqual(want);
  });

  it("SPEC-ADDON-139 reads an unknown group or sort as the default and replaces it in the URL", async () => {
    params = new URLSearchParams({ view: "all", group: "folders", sort: "random" });
    render(<ClipsPage />);
    await screen.findByText("Clip a");

    expect(replace).toHaveBeenCalledWith(`${PATH}?view=all&group=tags&sort=newest`);
    expect(heading("soup")).not.toBeNull();
  });

  it("SPEC-ADDON-139 starts over from the first shelves, with skeletons, when the sort changes", async () => {
    const { rerender } = render(<ClipsPage />);
    await screen.findByText("Clip a");

    const gate = deferred();
    fake.hold = (u) => (isTagShelves(u.searchParams) ? gate.promise : undefined);
    params = new URLSearchParams({ view: "all", sort: "oldest" });
    rerender(<ClipsPage />);

    await waitFor(() => expect(shelfCalls(isTagShelves).length).toBe(2));
    expect(screen.queryByText("Clip a")).toBeNull();
    expect(screen.getAllByTestId("clip-skeleton").length).toBeGreaterThan(0);
    gate.resolve();
    await screen.findByText("Clip a");
  });

  it("SPEC-ADDON-139 asks for more tag shelves from offset 12 as the viewer scrolls, until all are drawn", async () => {
    fake.clips = Array.from({ length: 14 }, (_, i) => clip(`t${i}`, { tags: [`tag${String(i).padStart(2, "0")}`] }));
    render(<ClipsPage />);
    await screen.findByText("tag00");
    expect(heading("tag12")).toBeNull();

    reachEnd();
    await screen.findByText("tag13");
    expect(q(shelfCalls(isTagShelves)[1], "offset")).toBe("12");
    reachEnd();
    await settle();
    expect(shelfCalls(isTagShelves)).toHaveLength(2);
  });

  it("SPEC-ADDON-139 keeps the drawn shelves and offers Try again, which re-asks that offset, when more shelves fail", async () => {
    fake.clips = Array.from({ length: 14 }, (_, i) => clip(`t${i}`, { tags: [`tag${String(i).padStart(2, "0")}`] }));
    let failing = true;
    fake.fail = (u) =>
      failing && isTagShelves(u.searchParams) && u.searchParams.get("offset") === "12" ? new Error("down") : undefined;
    render(<ClipsPage />);
    await screen.findByText("tag00");

    reachEnd();
    await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText("tag00")).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("tag13");
    expect(shelfCalls(isTagShelves).map((c) => q(c, "offset"))).toEqual(["0", "12", "12"]);
  });

  it("SPEC-ADDON-139 No grouping asks every clip 60 a page and appends the next page at the end of the scroll", async () => {
    params = new URLSearchParams({ view: "all", group: "none" });
    fake.clips = sixty(61);
    render(<ClipsPage />);
    await screen.findByText("Clip k60");

    const first = shelfCalls(isGrid)[0];
    expect(["by", "key", "per_shelf", "page", "type", "origin"].map((k) => q(first, k))).toEqual([
      "all", "all", "60", "1", "text", "webclip",
    ]);
    expect(screen.queryByText("Clip k00")).toBeNull();
    reachEnd();
    await screen.findByText("Clip k00");
    expect(q(shelfCalls(isGrid)[1], "page")).toBe("2");
  });

  it("SPEC-ADDON-139 shows Couldn't load and Try again when the first page of the grid fails, and retries it", async () => {
    params = new URLSearchParams({ view: "all", group: "none" });
    let failing = true;
    fake.fail = (u) => (failing && u.pathname.endsWith("/shelves") && isGrid(u.searchParams) ? new Error("down") : undefined);
    render(<ClipsPage />);

    await screen.findByText("Couldn't load");
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Clip a");
  });

  it("SPEC-ADDON-139 keeps the drawn cards when a later page fails and retries that page", async () => {
    params = new URLSearchParams({ view: "all", group: "none" });
    fake.clips = sixty(61);
    let failing = true;
    fake.fail = (u) => (failing && isGrid(u.searchParams) && u.searchParams.get("page") === "2" ? new Error("down") : undefined);
    render(<ClipsPage />);
    await screen.findByText("Clip k60");

    reachEnd();
    await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText("Clip k60")).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Clip k00");
  });
});

describe("SPEC-ADDON-139 shelf pages", () => {
  it("SPEC-ADDON-139 asks a tag shelf by tag and key with 60 a page and the Library's sort, and goes back to the Library", async () => {
    params = new URLSearchParams({ view: "shelf", shelf: "tag:soup", sort: "title" });
    fake.clips = [clip("a", { tags: ["soup"] }), clip("b", { tags: ["fish"] })];
    render(<ClipsPage />);
    await screen.findByText("Clip a");

    const ask = shelfCalls((p) => p.get("key") === "soup")[0];
    expect(["by", "per_shelf", "page", "sort", "order"].map((k) => q(ask, k))).toEqual(["tag", "60", "1", "title", "asc"]);
    expect(screen.queryByText("Clip b")).toBeNull();
    expect(screen.getByRole("link", { name: "‹ Library" })).toHaveAttribute("href", `${PATH}?view=all&group=tags&sort=title`);
    expect(tab("Library")).toHaveAttribute("aria-current", "page");
    expect(heading("soup")!.parentElement).toHaveTextContent("1");
  });

  it("SPEC-ADDON-139 asks the Untagged shelf by the no_tag key", async () => {
    params = new URLSearchParams({ view: "shelf", shelf: "untagged" });
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    expect(shelfCalls((p) => p.get("key") === "no_tag")).toHaveLength(1);
    expect(heading("Untagged")).not.toBeNull();
  });

  it.each([
    ["unread", "Unread"],
    ["new", "New clips"],
    ["unverified", "Unverified"],
  ])("SPEC-ADDON-139 draws the %s shelf page with its title, a Home back link and 60 a page", async (shelfId, title) => {
    if (shelfId === "new") nickname = null;
    params = new URLSearchParams({ view: "shelf", shelf: shelfId });
    render(<ClipsPage />);

    await screen.findByRole("heading", { level: 2, name: title });
    await waitFor(() => expect(shelfCalls((p) => p.get("per_shelf") === "60" && p.get("page") === "1")).toHaveLength(1));
    expect(screen.getByRole("link", { name: "‹ Home" })).toHaveAttribute("href", PATH);
    expect(tab("Home")).toHaveAttribute("aria-current", "page");
  });

  it("SPEC-ADDON-139 asks Recently opened with limit=50, draws no count and offers no further page", async () => {
    params = new URLSearchParams({ view: "shelf", shelf: "recent" });
    render(<ClipsPage />);
    await screen.findByText("Clip o1");

    expect(q(histories()[0], "limit")).toBe("50");
    expect(heading("Recently opened")!.parentElement!.textContent).toBe("Recently opened");
    reachEnd();
    await settle();
    expect(histories()).toHaveLength(1);
  });

  it.each([
    ["an unknown shelf", { view: "shelf", shelf: "nope" }],
    ["an empty tag name", { view: "shelf", shelf: "tag:" }],
  ])("SPEC-ADDON-139 sends %s to Home with a replace", async (_, query) => {
    params = new URLSearchParams(query);
    render(<ClipsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(PATH));
  });

  it.each(["unread", "recent"])("SPEC-ADDON-139 sends the %s shelf page to Home without a profile", async (shelfId) => {
    nickname = null;
    params = new URLSearchParams({ view: "shelf", shelf: shelfId });
    render(<ClipsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(PATH));
  });

  it("SPEC-ADDON-139 sends a profile-only shelf page to Home when the profile goes", async () => {
    params = new URLSearchParams({ view: "shelf", shelf: "unread" });
    const { rerender } = render(<ClipsPage />);
    await screen.findByText("Clip u1");
    expect(replace).not.toHaveBeenCalled();

    nickname = null;
    rerender(<ClipsPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(PATH));
  });

  it("SPEC-ADDON-139 does not send a deep link to Unread to Home while the profile is being read", async () => {
    params = new URLSearchParams({ view: "shelf", shelf: "unread" });
    nickname = null;
    // The provider reads the cookie in an effect that runs after its children's.
    function Provider({ children }: { children: React.ReactNode }) {
      useEffect(() => {
        nickname = "alice";
        profileListeners.forEach((l) => l());
      }, []);
      return children;
    }
    render(
      <Provider>
        <ClipsPage />
      </Provider>,
    );
    await screen.findByText("Clip u1");
    await settle();

    expect(replace).not.toHaveBeenCalled();
  });

  it("SPEC-ADDON-139 shows No clips here when a shelf page's first page has no clip", async () => {
    params = new URLSearchParams({ view: "shelf", shelf: "tag:nothing" });
    render(<ClipsPage />);

    await screen.findByText("No clips here");
  });

  it("SPEC-ADDON-138 asks the next page of the Unverified shelf page as floor(shown / 60) + 1 after a removal, skipping rows already drawn", async () => {
    params = new URLSearchParams({ view: "shelf", shelf: "unverified" });
    fake.clips = Array.from({ length: 70 }, (_, i) =>
      clip(`w${String(i).padStart(3, "0")}`, {
        trust_tier: "unverified",
        created_at: new Date(Date.UTC(2026, 8, 1, 9, i)).toISOString(),
      }),
    );
    render(<ClipsPage />);
    await screen.findByText("Clip w069");
    expect(screen.getAllByRole("button", { name: "Mark as verified" })).toHaveLength(60);

    fireEvent.click(screen.getAllByRole("button", { name: "Mark as verified" })[0]);
    await waitFor(() => expect(screen.queryByText("Clip w069")).toBeNull());
    reachEnd();

    await waitFor(() => expect(shelfCalls(isUnverified).length).toBe(2));
    expect(q(shelfCalls(isUnverified)[1], "page")).toBe("1");
    await screen.findByText("Clip w009");
    expect(screen.getAllByRole("button", { name: "Mark as verified" })).toHaveLength(60);
  });
});

describe("SPEC-ADDON-138 empty states", () => {
  it.each([
    ["Home", ""],
    ["Library", "view=all"],
  ])("SPEC-ADDON-100 I28 replaces the tabs and the shelves on %s when the drive has no clip", async (_, query) => {
    params = new URLSearchParams(query);
    fake.clips = [];
    fake.recent = [];
    render(<ClipsPage />);

    await screen.findByText(EMPTY);
    expect(tab("Home")).toBeNull();
    expect(tab("Library")).toBeNull();
    expect(heading("Unread")).toBeNull();
    expect(within(header()).getByRole("button", { name: ACTION })).toBeInTheDocument();
    expect(before(header(), screen.getByText(EMPTY))).toBe(true);
  });

  it("SPEC-ADDON-138 asks the drive-wide count once, without the target, when the Target has none", async () => {
    fake.collections = [{ id: "c1", name: "Empty" }];
    window.localStorage.setItem(TARGET_KEY, "collection:c1");
    render(<ClipsPage />);

    await screen.findByText("No clips in this Target");
    const withTarget = counts().filter((c) => c.url.searchParams.has("collection"));
    const driveWide = counts().filter((c) => !c.url.searchParams.has("collection"));
    expect(withTarget.length).toBeGreaterThan(0);
    expect(driveWide).toHaveLength(1);
    expect(["type", "origin", "limit"].map((k) => q(driveWide[0], k))).toEqual(["text", "webclip", "1"]);
  });

  it("SPEC-ADDON-138 keeps the tabs and draws Recently opened under No clips in this Target on Home", async () => {
    fake.collections = [{ id: "c1", name: "Empty" }];
    window.localStorage.setItem(TARGET_KEY, "collection:c1");
    render(<ClipsPage />);

    const notice = await screen.findByText("No clips in this Target");
    expect(tab("Home")).not.toBeNull();
    const recent = await screen.findByRole("heading", { level: 2, name: "Recently opened" });
    expect(before(notice, recent)).toBe(true);
    expect(heading("Unread")).toBeNull();
    expect(heading("Unverified")).toBeNull();
    expect(histories()[0].url.searchParams.has("collection")).toBe(false);
  });

  it("SPEC-ADDON-138 shows No clips in this Target on the Library", async () => {
    params = new URLSearchParams({ view: "all" });
    fake.collections = [{ id: "c1", name: "Empty" }];
    window.localStorage.setItem(TARGET_KEY, "collection:c1");
    render(<ClipsPage />);

    await screen.findByText("No clips in this Target");
    expect(tab("Library")).not.toBeNull();
    expect(screen.queryByText(/^Clip [uov]\d$/)).toBeNull();
  });

  it("SPEC-ADDON-138 draws no empty state when the drive-wide count fails", async () => {
    fake.collections = [{ id: "c1", name: "Empty" }];
    window.localStorage.setItem(TARGET_KEY, "collection:c1");
    fake.fail = failWhen((u) => u.pathname.endsWith("/files") && !u.searchParams.has("collection"));
    render(<ClipsPage />);

    await waitFor(() => expect(counts().length).toBeGreaterThan(1));
    await settle();
    expect(screen.queryByText("No clips in this Target")).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });
});

describe("SPEC-ADDON-138 the Target", () => {
  it("SPEC-ADDON-138 I1 sends the target's conditions with type=text and origin=webclip on every listing, and not on Recently opened", async () => {
    fake.collections = [{ id: "c1", name: "Soups" }];
    fake.collectionTotal = 3;
    window.localStorage.setItem(TARGET_KEY, "collection:c1");
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    for (const call of [counts()[0], shelfCalls(isUnread)[0], shelfCalls(isUnverified)[0]]) {
      expect(["collection", "type", "origin"].map((k) => q(call, k))).toEqual(["Soups", "text", "webclip"]);
    }
    expect(histories()[0].url.searchParams.has("collection")).toBe(false);
    expect(within(header()).getByRole("button", { name: /Target/ })).toHaveTextContent("Soups");
  });

  it("SPEC-ADDON-138 counts the menu's All clips as clips only", async () => {
    fake.collections = [{ id: "c1", name: "Soups" }];
    fake.collectionTotal = 3;
    window.localStorage.setItem(TARGET_KEY, "collection:c1");
    render(<ClipsPage />);
    await screen.findByText("Clip u1");
    const was = counts().length;

    fireEvent.click(within(header()).getByRole("button", { name: /Target/ }));
    await waitFor(() => expect(counts().length).toBeGreaterThan(was));
    const asked = counts()[counts().length - 1];
    expect(asked.url.searchParams.has("collection")).toBe(false);
    expect(["type", "origin", "limit"].map((k) => q(asked, k))).toEqual(["text", "webclip", "1"]);
  });

  it("SPEC-ADDON-138 keeps the menu's shown targets under Clips' own key", async () => {
    fake.collections = [
      { id: "c1", name: "Soups" },
      { id: "c2", name: "Salads" },
    ];
    window.localStorage.setItem(`litloft.addon.knowledge-clips.targets.${encodeURIComponent(DRIVE)}`, JSON.stringify(["collection:c2"]));
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    fireEvent.click(within(header()).getByRole("button", { name: /Target/ }));
    await screen.findByRole("menuitemradio", { name: /Salads/ });
    expect(screen.queryByRole("menuitemradio", { name: /Soups/ })).toBeNull();
  });

  it("SPEC-ADDON-138 does not read Notes' saved target", async () => {
    fake.collections = [{ id: "c1", name: "Soups" }];
    window.localStorage.setItem(`litloft.addon.knowledge.target.${encodeURIComponent(DRIVE)}`, "collection:c1");
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    expect(counts()[0].url.searchParams.has("collection")).toBe(false);
  });
});

describe("SPEC-ADDON-138 refresh", () => {
  it("SPEC-ADDON-100 I25 replaces the empty state once a clip added through the page's form is counted", async () => {
    fake.clips = [];
    fake.recent = [];
    render(<ClipsPage />);
    await screen.findByText(EMPTY);

    fireEvent.click(within(header()).getByRole("button", { name: ACTION }));
    fireEvent.change(screen.getByRole("textbox", { name: URL_FIELD }), { target: { value: "https://example.com/a" } });
    fake.clips = [clip("c7")];
    fireEvent.click(screen.getByRole("button", { name: "Clip" }));

    await waitFor(() => expect(createClip).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(EMPTY)).toBeNull());
    expect(tab("Home")).not.toBeNull();
    expect((await screen.findAllByText("Clip c7")).length).toBeGreaterThan(0);
  });

  it("SPEC-ADDON-138 refreshes on a knowledge.clip.ready event: the count and every shown shelf's first page are asked again", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");
    await screen.findByText("Clip v1");
    const was = {
      count: counts().length,
      unread: shelfCalls(isUnread).length,
      history: histories().length,
      unverified: shelfCalls(isUnverified).length,
    };

    emit("knowledge.clip.ready", { job_id: 9, file_id: "u1" });

    await waitFor(() => expect(shelfCalls(isUnread).length).toBe(was.unread + 1));
    expect(counts().length).toBe(was.count + 1);
    expect(histories().length).toBe(was.history + 1);
    expect(shelfCalls(isUnverified).length).toBe(was.unverified + 1);
  });

  it("SPEC-ADDON-138 does not refresh on the event already held when the page mounted", async () => {
    wsEvent = { event: "knowledge.clip.ready", data: { job_id: 1, file_id: "old" } } as WebSocketEvent;
    render(<ClipsPage />);
    await screen.findByText("Clip v1");
    await settle();

    expect(shelfCalls(isUnread)).toHaveLength(1);
  });

  it("SPEC-ADDON-138 puts a new clip in its place on Home and updates a drawn card with the answer's data", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    fake.clips = [
      clip("n9", { created_at: "2026-09-09T09:00:00Z" }),
      ...fake.clips.map((c) => (c.id === "u1" ? { ...c, title: "Renamed u1" } : c)),
    ];
    emit("knowledge.clip.ready", { job_id: 9, file_id: "n9" });

    await screen.findByText("Clip n9");
    expect(screen.getByText("Renamed u1")).toBeInTheDocument();
    const unread = heading("Unread")!.closest("section")!;
    const titles = within(unread).getAllByText(/^(Clip|Renamed)/).map((n) => n.textContent);
    expect(titles[0]).toBe("Clip n9");
  });

  it("SPEC-ADDON-138 keeps the cards on screen while a refresh is on the way and when it fails", async () => {
    render(<ClipsPage />);
    await screen.findByText("Clip u1");

    const gate = deferred();
    fake.hold = (u) => (u.pathname.endsWith("/shelves") ? gate.promise : undefined);
    fake.fail = failWhen((u) => u.pathname.endsWith("/shelves") || u.pathname.endsWith("/files"));
    emit("knowledge.clip.ready", { job_id: 9, file_id: "z" });
    await waitFor(() => expect(shelfCalls(isUnread).length).toBe(2));

    expect(screen.getByText("Clip u1")).toBeInTheDocument();
    gate.resolve();
    await settle();
    expect(screen.getByText("Clip u1")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load")).toBeNull();
    expect(header().textContent).toContain("4 clips");
  });

  it("SPEC-ADDON-138 keeps a later grid page already drawn through a refresh", async () => {
    params = new URLSearchParams({ view: "all", group: "none" });
    fake.clips = sixty(61);
    render(<ClipsPage />);
    await screen.findByText("Clip k60");
    reachEnd();
    await screen.findByText("Clip k00");

    emit("knowledge.clip.ready", { job_id: 9, file_id: "z" });
    await waitFor(() => expect(shelfCalls(isGrid).length).toBe(4));
    expect(screen.getByText("Clip k00")).toBeInTheDocument();
    expect(screen.getByText("Clip k60")).toBeInTheDocument();
  });

  it("SPEC-ADDON-138 replaces By tag's first shelves on a refresh and asks the later ones again from offset 12", async () => {
    params = new URLSearchParams({ view: "all" });
    fake.clips = Array.from({ length: 14 }, (_, i) => clip(`t${i}`, { tags: [`tag${String(i).padStart(2, "0")}`] }));
    render(<ClipsPage />);
    await screen.findByText("tag00");
    reachEnd();
    await screen.findByText("tag13");

    emit("knowledge.clip.ready", { job_id: 9, file_id: "z" });
    await waitFor(() => expect(heading("tag13")).toBeNull());
    expect(heading("tag00")).not.toBeNull();
    reachEnd();
    await screen.findByText("tag13");
    expect(shelfCalls(isTagShelves).map((c) => q(c, "offset"))).toEqual(["0", "12", "0", "12"]);
  });
});

describe("SPEC-ADDON-138 the clip form", () => {
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

  it.each([
    ["the Library", { view: "all" }],
    ["a shelf page", { view: "shelf", shelf: "unverified" }],
    ["Home", {}],
  ])("SPEC-ADDON-138 I11 keeps the form, typed into, when the page moves to %s and refreshes", async (_, next) => {
    params = new URLSearchParams("view" in next ? {} : { view: "all" });
    const { rerender } = render(<ClipsPage />);
    await settle();
    fireEvent.click(within(header()).getByRole("button", { name: ACTION }));
    fireEvent.change(screen.getByRole("textbox", { name: URL_FIELD }), { target: { value: "https://example.com/typed" } });

    params = new URLSearchParams(next);
    rerender(<ClipsPage />);
    await settle();
    emit("knowledge.clip.ready", { job_id: 9, file_id: "z" });
    await settle();

    expect(screen.getByRole("textbox", { name: URL_FIELD, hidden: true })).toHaveValue("https://example.com/typed");
  });

  it("SPEC-ADDON-100 I26 opens with the form open and submits a bookmarklet's prefill once", async () => {
    params = new URLSearchParams({ prefill: "https://example.com/a", title: "A", autosubmit: "1" });
    render(<ClipsPage />);

    await waitFor(() => expect(createClip).toHaveBeenCalledTimes(1));
    expect(createClip.mock.calls[0][0]).toBe(DRIVE);
    expect((createClip.mock.calls[0][1] as { url: string }).url).toBe("https://example.com/a");
    expect(screen.getByRole("textbox", { name: URL_FIELD })).toBeInTheDocument();
    await settle();
    expect(createClip).toHaveBeenCalledTimes(1);
  });
});
