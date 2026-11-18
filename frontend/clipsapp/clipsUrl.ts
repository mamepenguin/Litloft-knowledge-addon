export const CLIP_SORTS = ["newest", "oldest", "title"] as const;
export type ClipSort = (typeof CLIP_SORTS)[number];
export const DEFAULT_SORT: ClipSort = "newest";

export const CLIP_GROUPS = ["tags", "none"] as const;
export type ClipGroup = (typeof CLIP_GROUPS)[number];
export const DEFAULT_GROUP: ClipGroup = "tags";

export type ShelfId =
  | { kind: "unread" }
  | { kind: "recent" }
  | { kind: "new" }
  | { kind: "unverified" }
  | { kind: "tag"; name: string }
  | { kind: "untagged" };

const FIXED_SHELVES = ["unread", "recent", "new", "unverified", "untagged"] as const;

export function parseShelfId(raw: string | null): ShelfId | null {
  if (raw === null) return null;
  const fixed = FIXED_SHELVES.find((kind) => kind === raw);
  if (fixed) return { kind: fixed };
  if (raw.startsWith("tag:") && raw.length > "tag:".length) {
    return { kind: "tag", name: raw.slice("tag:".length) };
  }
  return null;
}

export function shelfIdString(shelf: ShelfId): string {
  return shelf.kind === "tag" ? `tag:${shelf.name}` : shelf.kind;
}

export function isTaggedShelf(shelf: ShelfId): boolean {
  return shelf.kind === "tag" || shelf.kind === "untagged";
}

/** Only a profile can have these; the page leaves them for Home without one. */
export function needsProfile(shelf: ShelfId): boolean {
  return shelf.kind === "unread" || shelf.kind === "recent";
}

export type ClipsView =
  | { view: "home" }
  | { view: "library"; group: ClipGroup; sort: ClipSort }
  | { view: "shelf"; shelf: ShelfId; sort: ClipSort };

function oneOf<T extends string>(allowed: readonly T[], value: string | null, fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

export function readClipsView(params: URLSearchParams): ClipsView {
  const sort = oneOf(CLIP_SORTS, params.get("sort"), DEFAULT_SORT);
  const view = params.get("view");
  if (view === "all") {
    return { view: "library", group: oneOf(CLIP_GROUPS, params.get("group"), DEFAULT_GROUP), sort };
  }
  if (view === "shelf") {
    const shelf = parseShelfId(params.get("shelf"));
    if (shelf !== null) return { view: "shelf", shelf, sort };
  }
  return { view: "home" };
}

/** Whether the URL names a view, a shelf, a group or a sort the page does not know. */
export function needsRewrite(params: URLSearchParams): boolean {
  const view = params.get("view");
  if (view === "shelf") return parseShelfId(params.get("shelf")) === null;
  if (view !== "all" && view !== "shelf") return false;
  const sort = params.get("sort");
  const group = params.get("group");
  return (
    (sort !== null && !CLIP_SORTS.some((s) => s === sort)) ||
    (view === "all" && group !== null && !CLIP_GROUPS.some((g) => g === group))
  );
}

export function clipsHref(pathname: string, view: ClipsView): string {
  if (view.view === "home") return pathname;
  const query = new URLSearchParams({ view: view.view === "library" ? "all" : "shelf" });
  if (view.view === "library") query.set("group", view.group);
  if (view.view === "shelf") {
    query.set("shelf", shelfIdString(view.shelf));
    if (isTaggedShelf(view.shelf)) query.set("sort", view.sort);
  } else {
    query.set("sort", view.sort);
  }
  return `${pathname}?${query}`;
}

export const LIBRARY_TAB_HREF = (pathname: string) => `${pathname}?view=all`;

/** Where the page goes for a URL it cannot read, keeping what it can. */
export function rewrittenHref(pathname: string, params: URLSearchParams): string {
  return clipsHref(pathname, readClipsView(params));
}

/** The shelf page's back link, and the tab it counts under. */
export function backTarget(shelf: ShelfId, sort: ClipSort): ClipsView {
  return isTaggedShelf(shelf)
    ? { view: "library", group: "tags", sort }
    : { view: "home" };
}
