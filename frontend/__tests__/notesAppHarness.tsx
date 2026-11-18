/**
 * A stand-in for the core and the Knowledge container, answering on the wire,
 * plus a navigation store that behaves like the App Router's: a `push` or
 * `replace` changes what `useSearchParams` answers and re-renders its readers.
 *
 * The Notes page is driven through its route entry (`Page.tsx`), so a test
 * holds whichever component draws a part: what is asserted is the request the
 * server receives and what the viewer can see.
 */
import { useSyncExternalStore } from "react";
import { vi } from "vitest";

import { installWireFetch, json, type WireCall } from "@/__tests__/helpers/wireFetch";

export const DRIVE = "d";
export const BASE = `/drive/${DRIVE}/addons/knowledge`;

// ---------------------------------------------------------------- navigation

export interface Navigation {
  kind: "push" | "replace";
  href: string;
  url: URL;
}

const listeners = new Set<() => void>();
let current = new URL(`http://localhost${BASE}`);
let snapshot = new URLSearchParams();

export const nav = {
  log: [] as Navigation[],
  get pathname() {
    return current.pathname;
  },
  get params() {
    return new URLSearchParams(current.search);
  },
  set(pathAndQuery: string) {
    current = new URL(pathAndQuery, "http://localhost");
    snapshot = new URLSearchParams(current.search);
    nav.log = [];
    listeners.forEach((l) => l());
  },
  go(kind: "push" | "replace", href: string) {
    const url = new URL(href, current.href);
    nav.log.push({ kind, href, url });
    current = url;
    snapshot = new URLSearchParams(url.search);
    listeners.forEach((l) => l());
  },
  /** Navigations whose target keeps the Notes path. */
  within(): Navigation[] {
    return nav.log.filter((n) => n.url.pathname === BASE);
  },
  last(): Navigation | undefined {
    return nav.log[nav.log.length - 1];
  },
};

export const router = {
  push: vi.fn((href: string) => nav.go("push", href)),
  replace: vi.fn((href: string) => nav.go("replace", href)),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const navigationModule = {
  useSearchParams: () => useSyncExternalStore(subscribe, () => snapshot, () => snapshot),
  usePathname: () => useSyncExternalStore(subscribe, () => current.pathname, () => current.pathname),
  useRouter: () => router,
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (href: string) => nav.go("replace", href),
};

/** A page that writes the URL through the History API reaches the same store. */
export function captureHistory() {
  const push = window.history.pushState.bind(window.history);
  const replace = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "pushState").mockImplementation((data, unused, url) => {
    push(data, unused, url);
    if (url != null) nav.go("push", String(url));
  });
  vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => {
    replace(data, unused, url);
    if (url != null) nav.go("replace", String(url));
  });
}

// ------------------------------------------------------------------ viewport

function evaluate(query: string, width: number): boolean {
  const parts = [...query.matchAll(/\((min|max)-width:\s*(\d+(?:\.\d+)?)px\)/g)];
  if (parts.length === 0) return false;
  return parts.every(([, side, px]) => (side === "min" ? width >= Number(px) : width <= Number(px)));
}

const mediaLists = new Set<{ query: string; listeners: Set<(e: { matches: boolean }) => void>; matches: boolean }>();
let viewportWidth = 1440;

/** Sets the viewport for both `innerWidth` readers and `matchMedia` readers. */
export function setViewport(width: number) {
  viewportWidth = width;
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const entry = { query, listeners: new Set<(e: { matches: boolean }) => void>(), matches: evaluate(query, viewportWidth) };
      mediaLists.add(entry);
      return {
        get matches() {
          return evaluate(query, viewportWidth);
        },
        media: query,
        onchange: null,
        addListener: (l: (e: { matches: boolean }) => void) => entry.listeners.add(l),
        removeListener: (l: (e: { matches: boolean }) => void) => entry.listeners.delete(l),
        addEventListener: (_t: string, l: (e: { matches: boolean }) => void) => entry.listeners.add(l),
        removeEventListener: (_t: string, l: (e: { matches: boolean }) => void) => entry.listeners.delete(l),
        dispatchEvent: () => true,
      };
    },
  });
  for (const entry of mediaLists) {
    const now = evaluate(entry.query, width);
    if (now !== entry.matches) {
      entry.matches = now;
      entry.listeners.forEach((l) => l({ matches: now }));
    }
  }
  window.dispatchEvent(new Event("resize"));
}

// -------------------------------------------------------------------- server

export function smartFolder(id: string, name: string, query: string) {
  return {
    id,
    drive: DRIVE,
    name,
    query,
    file_type: null,
    sort_by: null,
    sort_order: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
  };
}

export interface Note {
  id: string;
  title: string;
  folder: string;
  tags?: string[];
  updated?: string;
  created?: string;
  mime?: string;
  origin?: string | null;
  body?: string;
}

export function fileItem(n: Note) {
  const filename = n.title.includes(".") ? n.title : `${n.title}.md`;
  return {
    id: n.id,
    filename,
    title: n.title,
    description: "",
    drive: DRIVE,
    folder_path: n.folder,
    file_type: "document",
    mime_type: n.mime ?? "text/markdown",
    thumbnail_url: `/api/files/${n.id}/thumbnail`,
    has_thumbnail: false,
    file_size: 10,
    duration: null,
    image_width: null,
    image_height: null,
    liked_at: null,
    is_favorite: false,
    tags: n.tags ?? [],
    subtitles: [],
    deleted_at: null,
    missing_since: null,
    md_origin: n.origin ?? null,
    trust_tier: "verified",
    trust_reviewed_at: null,
    created_at: n.created ?? n.updated ?? "2026-01-01T00:00:00Z",
    updated_at: n.updated ?? "2026-01-01T00:00:00Z",
  };
}

type Answer = Response | Promise<Response> | null;

export interface Server {
  calls: WireCall[];
  notes: Note[];
  history: Note[];
  openings: Record<string, string>;
  withSources: string[];
  sources: Record<string, unknown[]>;
  relations: Record<string, unknown[]>;
  smartFolders: unknown[];
  /** Per-route override: return a Response (or a never-settling promise) to replace the default. */
  override: (call: WireCall) => Answer;
  isListing: (c: WireCall) => boolean;
  isCounts: (c: WireCall) => boolean;
  isTagShelves: (c: WireCall) => boolean;
}

export const path = (c: WireCall) => c.url.pathname;
export const isFiles = (c: WireCall) => path(c) === `/api/drives/${DRIVE}/files`;
export const isFilesQuery = (c: WireCall) => path(c) === `/api/drives/${DRIVE}/files/query`;
export const isCountsGet = (c: WireCall) => path(c) === `/api/drives/${DRIVE}/folder-counts`;
export const isCountsQuery = (c: WireCall) => path(c) === `/api/drives/${DRIVE}/folder-counts/query`;
export const isShelvesGet = (c: WireCall) => path(c) === `/api/drives/${DRIVE}/shelves`;
export const isShelvesQuery = (c: WireCall) => path(c) === `/api/drives/${DRIVE}/shelves/query`;
export const isWatchHistory = (c: WireCall) => path(c) === `/api/drives/${DRIVE}/watch-history`;
export const isOpenings = (c: WireCall) => path(c) === "/api/addons/knowledge/note-openings";
export const isWithSources = (c: WireCall) => path(c) === "/api/addons/knowledge/notes/with-sources";
export const isSources = (c: WireCall) => path(c) === "/api/addons/knowledge/notes/sources";
export const isProgress = (c: WireCall) => /^\/api\/files\/[^/]+\/progress$/.test(path(c)) && c.method === "POST";
export const isMeta = (id: string) => (c: WireCall) => path(c) === `/api/files/${id}` && c.method === "GET";
export const isRelations = (id: string) => (c: WireCall) => path(c) === `/api/files/${id}/relations`;
export const isContentRead = (id: string) => (c: WireCall) =>
  c.method === "GET" && (path(c) === `/api/files/${id}/stream` || path(c) === `/api/files/${id}/content`);

/** A request that lists or counts notes. */
export const listsOrCounts = (c: WireCall) =>
  isFiles(c) || isFilesQuery(c) || isCountsGet(c) || isCountsQuery(c) || isShelvesGet(c) || isShelvesQuery(c);

function filterNotes(notes: Note[], c: WireCall): Note[] {
  const q = c.url.searchParams;
  let out = notes.filter((n) => !(q.get("exclude_origin") && n.origin === q.get("exclude_origin")));
  if (q.has("path")) out = out.filter((n) => n.folder === q.get("path"));
  for (const tag of q.getAll("tag")) {
    if (tag) out = out.filter((n) => (n.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase()));
  }
  const search = q.get("search");
  if (search) {
    const s = search.toLowerCase();
    out = out.filter((n) => n.title.toLowerCase().includes(s) || n.folder.toLowerCase().includes(s));
  }
  const body = c.body as { file_ids?: string[] } | null;
  if ((isFilesQuery(c) || isCountsQuery(c) || isShelvesQuery(c)) && body?.file_ids) {
    const ids = new Set(body.file_ids);
    out = out.filter((n) => ids.has(n.id));
  }
  return out;
}

function sortNotes(notes: Note[], c: WireCall): Note[] {
  const sort = c.url.searchParams.get("sort") ?? "created_at";
  const order = c.url.searchParams.get("order") ?? "desc";
  const key = (n: Note) =>
    sort === "title" ? n.title : sort === "updated_at" ? (n.updated ?? "") : (n.created ?? n.updated ?? "");
  const sorted = [...notes].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return order === "asc" ? sorted : sorted.reverse();
}

export function installNotesServer(init: Partial<Pick<Server, "notes" | "history" | "openings" | "withSources" | "sources" | "relations" | "smartFolders">> = {}): Server {
  const server: Server = {
    calls: [],
    notes: init.notes ?? [],
    history: init.history ?? [],
    openings: init.openings ?? {},
    withSources: init.withSources ?? [],
    sources: init.sources ?? {},
    relations: init.relations ?? {},
    smartFolders: init.smartFolders ?? [],
    override: () => null,
    isListing: (c) => isFiles(c) || isFilesQuery(c),
    isCounts: (c) => isCountsGet(c) || isCountsQuery(c),
    isTagShelves: (c) => (isShelvesGet(c) || isShelvesQuery(c)) && c.url.searchParams.get("by") === "tag",
  };
  const wire = installWireFetch((call) => {
    const overridden = server.override(call);
    if (overridden) return overridden;
    return answer(server, call);
  });
  server.calls = wire.calls;
  return server;
}

function answer(server: Server, call: WireCall): Response {
  const p = path(call);
  if (p === `/api/drives/${DRIVE}/smart-folders`) return json(server.smartFolders);
  if (p === `/api/drives/${DRIVE}/collections`) return json([]);
  if (p === "/api/addons/status") return json({ addons: {}, slots: {} });
  if (isFiles(call) || isFilesQuery(call)) {
    const all = sortNotes(filterNotes(server.notes, call), call);
    const page = Number(call.url.searchParams.get("page") ?? "1");
    const limit = Number(call.url.searchParams.get("limit") ?? "30");
    return json({
      data: all.slice((page - 1) * limit, page * limit).map(fileItem),
      meta: { total: all.length, page, limit },
    });
  }
  if (isCountsGet(call) || isCountsQuery(call)) {
    const counts = new Map<string, number>();
    for (const n of filterNotes(server.notes, call)) counts.set(n.folder, (counts.get(n.folder) ?? 0) + 1);
    return json([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p2, count]) => ({ path: p2, count })));
  }
  if ((isShelvesGet(call) || isShelvesQuery(call)) && call.url.searchParams.get("by") === "tag") {
    const notes = filterNotes(server.notes, call);
    const counts = new Map<string, number>();
    for (const n of notes) for (const t of n.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    const shelves = [...counts.entries()]
      .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
      .map(([key, count]) => ({ key, label: key, count, items: [] as unknown[] }));
    const untagged = notes.filter((n) => (n.tags ?? []).length === 0).length;
    if (untagged) shelves.push({ key: "no_tag", label: "", count: untagged, items: [] });
    const offset = Number(call.url.searchParams.get("offset") ?? "0");
    const limit = Number(call.url.searchParams.get("shelf_limit") ?? "12");
    return json({ by: "tag", base: "", total_shelves: shelves.length, shelves: shelves.slice(offset, offset + limit) });
  }
  if (isWatchHistory(call)) {
    const limit = Number(call.url.searchParams.get("limit") ?? "20");
    return json({ data: server.history.slice(0, limit).map((n) => ({ ...fileItem(n), watch_progress: { position: 0, duration: 0 } })) });
  }
  if (isOpenings(call)) {
    const ids = ((call.body as { file_ids?: string[] })?.file_ids ?? []).filter((id) => id in server.openings);
    return json({ openings: Object.fromEntries(ids.map((id) => [id, server.openings[id]])) });
  }
  if (isWithSources(call)) return json({ ids: server.withSources });
  if (isSources(call)) {
    const ids = (call.body as { file_ids?: string[] })?.file_ids ?? [];
    return json({ notes: Object.fromEntries(ids.filter((id) => id in server.sources).map((id) => [id, server.sources[id]])) });
  }
  if (isProgress(call)) return new Response(null, { status: 204 });
  const relations = /^\/api\/files\/([^/]+)\/relations$/.exec(p);
  if (relations) return json({ relations: server.relations[relations[1]] ?? [] });
  const content = /^\/api\/files\/([^/]+)\/(stream|content)$/.exec(p);
  if (content && call.method === "GET") {
    const n = server.notes.find((x) => x.id === content[1]);
    if (!n) return json({ detail: "Not found" }, 404);
    return new Response(n.body ?? `Body of ${n.title}`, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", etag: `"${n.id}-v1"` },
    });
  }
  const meta = /^\/api\/files\/([^/]+)$/.exec(p);
  if (meta && call.method === "GET") {
    const n = server.notes.find((x) => x.id === meta[1]);
    return n ? json(fileItem(n)) : json({ detail: "Not found" }, 404);
  }
  return json([]);
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The innermost elements whose whole text, whitespace collapsed, is `text`. */
export function textNodes(text: string, root: ParentNode = document.body): Element[] {
  return [...root.querySelectorAll("*")].filter(
    (el) => norm(el.textContent) === text && ![...el.children].some((c) => norm(c.textContent) === text),
  );
}

/** Waits for an element that reads `text`, however the text is split across elements. */
export async function findText(text: string, root?: ParentNode): Promise<Element> {
  const { waitFor } = await import("@testing-library/react");
  return waitFor(() => {
    const found = textNodes(text, root);
    if (found.length === 0) throw new Error(`no element reads "${text}"`);
    return found[0];
  });
}

export function settle(ms = 50) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------- i18n

/**
 * `next-intl` with the merged English messages, formatted as the real library
 * formats them (plurals included), so the spec's English strings can be asserted.
 */
export async function intlModule() {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  const messages = (await import("@/messages/en.json")).default as Record<string, unknown>;
  const translator = (namespace?: string) =>
    actual.createTranslator({
      locale: "en",
      messages: messages as never,
      namespace: namespace as never,
      onError: () => {},
      getMessageFallback: ({ key, namespace: ns }) => (ns ? `${ns}.${key}` : key),
    });
  return {
    ...actual,
    useTranslations: (namespace?: string) => translator(namespace),
    useLocale: () => "en",
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
}
