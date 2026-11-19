/**
 * A stand-in for the core and the Knowledge container as the Clips page sees
 * them, answering on the wire. Navigation, viewport and i18n are the Notes
 * harness's. Every filter is applied only when the request names it, so a
 * request that leaves out `type` or `origin` gets the notes and non-text files
 * seeded beside the clips.
 */
import { useSyncExternalStore } from "react";
import { act } from "@testing-library/react";
import { vi } from "vitest";

import { json } from "@/__tests__/helpers/wireFetch";
import type { WebSocketEvent } from "@/types";
import { BASE, DRIVE } from "./notesAppHarness";

export {
  BASE,
  DRIVE,
  captureHistory,
  deferNavigation,
  findText,
  intlModule,
  nav,
  navigationModule,
  router,
  setViewport,
  settle,
  smartFolder,
  textNodes,
} from "./notesAppHarness";

export const CLIPS = `${BASE}/clips`;

// --------------------------------------------------------------------- calls

export interface Call {
  method: string;
  url: URL;
  body: unknown;
  headers: Headers;
}

function parseBody(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------- data

export interface Clip {
  id: string;
  title: string;
  filename?: string;
  folder?: string;
  created?: string;
  size?: number;
  tags?: string[];
  trust?: "verified" | "unverified";
  /** `webclip` unless given; `null` is a note with no marker. */
  origin?: string | null;
  mime?: string;
  collections?: string[];
}

export const NULL_COVER = { image_id: null, image_url: null, site: null };
export type Cover = { image_id: string | null; image_url: string | null; site: string | null };

export function fileItem(c: Clip) {
  const mime = c.mime ?? "text/markdown";
  return {
    id: c.id,
    filename: c.filename ?? `${c.title || c.id}.md`,
    title: c.title,
    description: "",
    drive: DRIVE,
    folder_path: c.folder ?? "web",
    file_type: mime.startsWith("image/") ? "image" : "document",
    mime_type: mime,
    thumbnail_url: `/api/files/${c.id}/thumbnail`,
    has_thumbnail: false,
    file_size: c.size ?? 3000,
    duration: null,
    image_width: null,
    image_height: null,
    liked_at: null,
    is_favorite: false,
    tags: c.tags ?? [],
    subtitles: [],
    deleted_at: null,
    missing_since: null,
    md_origin: c.origin === undefined ? "webclip" : c.origin,
    trust_tier: c.trust ?? "verified",
    trust_reviewed_at: null,
    created_at: c.created ?? "2026-11-01T09:00:00Z",
    updated_at: c.created ?? "2026-11-01T09:00:00Z",
  };
}

/** `count` clips, newest first, created an hour apart. */
export function clips(count: number, prefix = "c", over: Partial<Clip> = {}): Clip[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    title: `${prefix.toUpperCase()} clip ${i + 1}`,
    created: new Date(Date.UTC(2026, 10, 15) - i * 3_600_000).toISOString(),
    ...over,
  }));
}

/** Files that are not clips: a note with no origin, and a clipped picture. */
export const NOT_CLIPS: Clip[] = [
  { id: "note1", title: "A note", origin: null, trust: "unverified", created: "2026-11-30T00:00:00Z" },
  { id: "pic1", title: "picture", filename: "picture.jpg", mime: "image/jpeg", trust: "unverified", created: "2026-11-30T00:00:00Z" },
];

// -------------------------------------------------------------------- server

type Answer = Response | Promise<Response> | null;

export interface Server {
  calls: Call[];
  files: Clip[];
  /** Ids the viewer opened, newest first: the watch-history rows. */
  history: string[];
  /** The core knows the viewer (the identity cookie arrived). */
  viewer: boolean;
  covers: Record<string, Cover>;
  smartFolders: unknown[];
  collections: unknown[];
  override: (call: Call) => Answer;
  /** The default answer, for an override that only delays it. */
  answer: (call: Call) => Response;
}

export const path = (c: Call) => c.url.pathname;
export const q = (c: Call) => c.url.searchParams;
export const isFiles = (c: Call) => path(c) === `/api/drives/${DRIVE}/files` || path(c) === `/api/drives/${DRIVE}/files/query`;
export const isShelves = (c: Call) =>
  path(c) === `/api/drives/${DRIVE}/shelves` || path(c) === `/api/drives/${DRIVE}/shelves/query`;
export const isWatchHistory = (c: Call) => path(c) === `/api/drives/${DRIVE}/watch-history`;
export const isCovers = (c: Call) => path(c) === "/api/addons/knowledge/clip-covers";
export const isTrustWrite = (c: Call) => /^\/api\/files\/[^/]+\/trust-tier$/.test(path(c)) && c.method === "PUT";
export const isCount = (c: Call) => isFiles(c) && q(c).get("limit") === "1";
/** The unread-dot question: which of these cards has the viewer not opened. */
export const isDotAsk = (c: Call) => isShelves(c) && q(c).getAll("ids").length > 0;
export const isUnreadShelf = (c: Call) => isShelves(c) && q(c).get("opened") === "false" && !isDotAsk(c);
export const isUnverifiedShelf = (c: Call) => isShelves(c) && q(c).get("trust") === "unverified";
export const isNewShelf = (c: Call) =>
  isShelves(c) && q(c).get("by") === "all" && !q(c).has("opened") && !q(c).has("trust") && !isDotAsk(c);
export const isTagShelves = (c: Call) => isShelves(c) && q(c).get("by") === "tag";
export const coverIds = (c: Call) => ((c.body as { file_ids?: string[] } | null)?.file_ids ?? []) as string[];

class ViewerRequired extends Error {}

function isText(c: Clip) {
  const mime = c.mime ?? "text/markdown";
  return mime === "text/markdown" || mime === "text/plain";
}

function originOf(c: Clip) {
  return c.origin === undefined ? "webclip" : c.origin;
}

function filter(server: Server, call: Call): Clip[] {
  const p = q(call);
  let out = server.files;
  const types = p.getAll("type");
  if (types.length) out = out.filter((c) => types.some((t) => (t === "text" || t === "markdown" ? isText(c) : false)));
  if (p.has("origin")) out = out.filter((c) => originOf(c) === p.get("origin"));
  if (p.has("exclude_origin")) out = out.filter((c) => originOf(c) !== p.get("exclude_origin"));
  if (p.has("trust")) out = out.filter((c) => (c.trust ?? "verified") === p.get("trust"));
  if (p.has("opened")) {
    if (!server.viewer) throw new ViewerRequired();
    const opened = p.get("opened") === "true";
    out = out.filter((c) => server.history.includes(c.id) === opened);
  }
  const ids = p.getAll("ids");
  if (ids.length) out = out.filter((c) => ids.includes(c.id));
  for (const tag of p.getAll("tag")) out = out.filter((c) => (c.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase()));
  const named = p.getAll("collection");
  const body = call.body as { file_ids?: string[] } | null;
  if (named.length || body?.file_ids) {
    const listed = new Set(body?.file_ids ?? []);
    out = out.filter(
      (c) => listed.has(c.id) || named.some((n) => (c.collections ?? []).some((m) => m.toLowerCase() === n.toLowerCase())),
    );
  }
  return out;
}

function sort(list: Clip[], call: Call): Clip[] {
  const by = q(call).get("sort") ?? "created_at";
  const order = q(call).get("order") ?? "desc";
  const key = (c: Clip) => (by === "title" ? c.title : (c.created ?? ""));
  const sorted = [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return order === "asc" ? sorted : sorted.reverse();
}

function page(list: Clip[], call: Call, perDefault: number) {
  const per = Number(q(call).get("per_shelf") ?? String(perDefault));
  const n = Number(q(call).get("page") ?? "1");
  return list.slice((n - 1) * per, n * per).map(fileItem);
}

const folderOf = (c: Clip) => c.folder ?? "web";
const monthOf = (c: Clip) => (c.created ?? "2026-11-01T09:00:00Z").slice(0, 7);

/**
 * by=folder groups under the drive root: one subtree shelf per top-level
 * folder, and "" for the clips directly in the root. A key ending in "/" is
 * the clips directly in that folder. by=month groups by the month added.
 */
function inFolderShelf(c: Clip, key: string) {
  const folder = folderOf(c);
  if (key === "") return folder === "";
  if (key.endsWith("/")) return folder === key.slice(0, -1);
  return folder === key || folder.startsWith(`${key}/`);
}

function groupedAnswer(by: "folder" | "month", all: Clip[], call: Call): Response {
  const p = q(call);
  const member = (c: Clip, key: string) => (by === "folder" ? inFolderShelf(c, key) : monthOf(c) === key);
  const shelfOf = (key: string) => {
    const members = all.filter((c) => member(c, key));
    return { key, label: key, count: members.length, items: page(members, call, 5) };
  };
  if (p.has("key")) return json({ by, base: "", total_shelves: 1, shelves: [shelfOf(p.get("key")!)] });
  const keys = [...new Set(all.map((c) => (by === "folder" ? folderOf(c).split("/")[0] : monthOf(c))))];
  const shelves = keys.map(shelfOf);
  if (by === "folder") shelves.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
  else shelves.sort((a, b) => (a.key < b.key ? 1 : -1));
  const offset = Number(p.get("offset") ?? "0");
  const limit = Number(p.get("shelf_limit") ?? "12");
  return json({ by, base: "", total_shelves: shelves.length, shelves: shelves.slice(offset, offset + limit) });
}

function shelvesAnswer(server: Server, call: Call): Response {
  const p = q(call);
  const all = sort(filter(server, call), call);
  const by = p.get("by");
  if (by === "folder" || by === "month") return groupedAnswer(by, all, call);
  if (p.get("by") === "tag") {
    const counts = new Map<string, number>();
    for (const c of all) for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    const keys = [...counts.entries()].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).map(([k]) => k);
    const untagged = all.filter((c) => (c.tags ?? []).length === 0);
    const shelfOf = (key: string) => {
      const members = key === "no_tag" ? untagged : all.filter((c) => (c.tags ?? []).includes(key));
      return { key, label: key === "no_tag" ? "" : key, count: members.length, items: page(members, call, 5) };
    };
    if (p.has("key")) {
      return json({ by: "tag", base: "", total_shelves: 1, shelves: [shelfOf(p.get("key")!)] });
    }
    const shelves = [...keys, ...(untagged.length ? ["no_tag"] : [])].map(shelfOf);
    const offset = Number(p.get("offset") ?? "0");
    const limit = Number(p.get("shelf_limit") ?? "12");
    return json({ by: "tag", base: "", total_shelves: shelves.length, shelves: shelves.slice(offset, offset + limit) });
  }
  return json({
    by: "all",
    base: "",
    total_shelves: 1,
    shelves: [{ key: "all", label: "", count: all.length, items: page(all, call, 5) }],
  });
}

function answer(server: Server, call: Call): Response {
  const p = path(call);
  if (p === `/api/drives/${DRIVE}/smart-folders`) return json(server.smartFolders);
  if (p === `/api/drives/${DRIVE}/collections`) return json(server.collections);
  if (p === "/api/addons/status") return json({ addons: {}, slots: {} });
  try {
    if (isFiles(call)) {
      const all = sort(filter(server, call), call);
      const n = Number(q(call).get("page") ?? "1");
      const limit = Number(q(call).get("limit") ?? "30");
      return json({ data: all.slice((n - 1) * limit, n * limit).map(fileItem), meta: { total: all.length, page: n, limit } });
    }
    if (isShelves(call)) return shelvesAnswer(server, call);
  } catch (e) {
    if (e instanceof ViewerRequired) return json({ detail: "viewer_required" }, 400);
    throw e;
  }
  if (isWatchHistory(call)) {
    if (!server.viewer) return json({ data: [] });
    const limit = Math.min(Number(q(call).get("limit") ?? "20"), 50);
    const rows = server.history
      .map((id) => server.files.find((c) => c.id === id))
      .filter((c): c is Clip => !!c)
      .filter((c) => !q(call).getAll("type").includes("text") || isText(c))
      .filter((c) => !q(call).has("origin") || originOf(c) === q(call).get("origin"));
    return json({ data: rows.slice(0, limit).map((c) => ({ ...fileItem(c), watch_progress: { position: 0, duration: 0 } })) });
  }
  if (isCovers(call)) {
    const known = coverIds(call).filter((id) => server.files.some((c) => c.id === id && isText(c)));
    return json({ covers: Object.fromEntries(known.map((id) => [id, server.covers[id] ?? NULL_COVER])) });
  }
  const trust = /^\/api\/files\/([^/]+)\/trust-tier$/.exec(p);
  if (trust && call.method === "PUT") {
    const tier = (call.body as { tier: "verified" | "unverified" }).tier;
    server.files = server.files.map((c) => (c.id === trust[1] ? { ...c, trust: tier } : c));
    const c = server.files.find((x) => x.id === trust[1]);
    return c ? json(fileItem(c)) : json({ detail: "Not found" }, 404);
  }
  if (/^\/api\/addons\/knowledge\/clips/.test(p)) return json([]);
  return json([]);
}

export function installClipsServer(init: Partial<Pick<Server, "files" | "history" | "viewer" | "covers" | "smartFolders" | "collections">> = {}): Server {
  const server: Server = {
    calls: [],
    files: init.files ?? [],
    history: init.history ?? [],
    viewer: init.viewer ?? true,
    covers: init.covers ?? {},
    smartFolders: init.smartFolders ?? [],
    collections: init.collections ?? [],
    override: () => null,
    answer: (call) => answer(server, call),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : null;
      const url = new URL(req ? req.url : String(input), "http://localhost");
      const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
      const raw = init?.body ?? (req ? await req.clone().text() : undefined);
      const headers = new Headers(init?.headers ?? req?.headers ?? {});
      const call: Call = { method, url, body: parseBody(raw), headers };
      server.calls.push(call);
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const overridden = server.override(call);
      if (overridden) return overridden;
      return answer(server, call);
    }),
  );
  return server;
}

const dotted = (s: string | null | undefined) =>
  (s ?? "").replace(/\s+/g, " ").replace(/\s*·\s*/g, " · ").trim();

/** The innermost elements whose text, spacing around "·" made uniform, matches `pattern`. */
export function metaNodes(pattern: RegExp, root: ParentNode = document.body): Element[] {
  return [...root.querySelectorAll("*")].filter(
    (el) => pattern.test(dotted(el.textContent)) && ![...el.children].some((c) => pattern.test(dotted(c.textContent))),
  );
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// --------------------------------------------------------- profile, socket, scrolling

const profileListeners = new Set<() => void>();
export const profile = { nickname: "alice" as string | null };

export function setNickname(nickname: string | null) {
  act(() => {
    profile.nickname = nickname;
    profileListeners.forEach((l) => l());
  });
}

export const profileModule = {
  useProfile: () => {
    const nickname = useSyncExternalStore(
      (l) => {
        profileListeners.add(l);
        return () => profileListeners.delete(l);
      },
      () => profile.nickname,
    );
    return { nickname, setNickname: vi.fn(), clearNickname: vi.fn() };
  },
};

let wsEvent: WebSocketEvent | null = null;
const wsListeners = new Set<() => void>();

export function resetSocket() {
  wsEvent = null;
}

export function emit(event: string, data: Record<string, unknown>) {
  act(() => {
    wsEvent = { event, data } as WebSocketEvent;
    wsListeners.forEach((l) => l());
  });
}

export const socketModule = {
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
};

/** Every mounted `useNearEnd`, so a test can bring each of them to its end. */
const nearEnds = new Map<symbol, { enabled: boolean; load: () => void }>();

export async function reachEnd() {
  await act(async () => {
    for (const entry of [...nearEnds.values()]) if (entry.enabled) entry.load();
  });
}

export async function nearEndModule() {
  const { useEffect, useRef } = await import("react");
  return {
    useNearEnd: (enabled: boolean, load: () => void) => {
      const id = useRef(Symbol("nearEnd")).current;
      nearEnds.set(id, { enabled, load });
      useEffect(() => () => void nearEnds.delete(id), [id]);
      return () => {};
    },
  };
}
