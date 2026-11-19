import { formatMonth, isMonthKey } from "@/lib/formatMonth";

export const CLIP_SORTS = ["newest", "oldest", "title"] as const;
export type ClipSort = (typeof CLIP_SORTS)[number];
export const DEFAULT_SORT: ClipSort = "newest";

export const CLIP_GROUPS = ["tags", "folder", "month", "none"] as const;
export type ClipGroup = (typeof CLIP_GROUPS)[number];
export const DEFAULT_GROUP: ClipGroup = "tags";

export type ShelfId =
  | { kind: "unread" }
  | { kind: "recent" }
  | { kind: "new" }
  | { kind: "unverified" }
  | { kind: "tag"; name: string }
  | { kind: "untagged" }
  | { kind: "folder"; key: string }
  | { kind: "month"; key: string };

const FIXED_SHELVES = ["unread", "recent", "new", "unverified", "untagged"] as const;

export function isClipSort(value: string | null | undefined): value is ClipSort {
  return CLIP_SORTS.some((sort) => sort === value);
}

export function isClipGroup(value: string | null | undefined): value is ClipGroup {
  return CLIP_GROUPS.some((group) => group === value);
}

export function parseShelfId(raw: string | null): ShelfId | null {
  if (raw === null) return null;
  const fixed = FIXED_SHELVES.find((kind) => kind === raw);
  if (fixed) return { kind: fixed };
  if (raw.startsWith("tag:") && raw.length > "tag:".length) {
    return { kind: "tag", name: raw.slice("tag:".length) };
  }
  if (raw.startsWith("folder:")) {
    return { kind: "folder", key: raw.slice("folder:".length) };
  }
  if (raw.startsWith("month:")) {
    const key = raw.slice("month:".length);
    return isMonthKey(key) ? { kind: "month", key } : null;
  }
  return null;
}

export function shelfIdString(shelf: ShelfId): string {
  switch (shelf.kind) {
    case "tag":
      return `tag:${shelf.name}`;
    case "folder":
      return `folder:${shelf.key}`;
    case "month":
      return `month:${shelf.key}`;
    default:
      return shelf.kind;
  }
}

export function isTaggedShelf(shelf: ShelfId): boolean {
  return shelf.kind === "tag" || shelf.kind === "untagged";
}

/** The shelf pages whose order is the Library's sort. */
export function followsSort(shelf: ShelfId): boolean {
  return isTaggedShelf(shelf) || shelf.kind === "folder" || shelf.kind === "month";
}

/** Only a profile can have these; the page leaves them for Home without one. */
export function needsProfile(shelf: ShelfId): boolean {
  return shelf.kind === "unread" || shelf.kind === "recent";
}

export interface ResolvedClipView {
  group: ClipGroup;
  sort: ClipSort;
}

export type ClipsView =
  | { view: "home" }
  | { view: "library"; group: ClipGroup; sort: ClipSort }
  | { view: "shelf"; shelf: ShelfId; sort: ClipSort };

/**
 * The view the URL names. A readable parameter wins; an absent or unreadable
 * one takes the Target's resolved value.
 */
export function readClipsView(
  params: URLSearchParams,
  resolved: ResolvedClipView = { group: DEFAULT_GROUP, sort: DEFAULT_SORT },
): ClipsView {
  const rawSort = params.get("sort");
  const sort = isClipSort(rawSort) ? rawSort : resolved.sort;
  const view = params.get("view");
  if (view === "all") {
    const rawGroup = params.get("group");
    return { view: "library", group: isClipGroup(rawGroup) ? rawGroup : resolved.group, sort };
  }
  if (view === "shelf") {
    const shelf = parseShelfId(params.get("shelf"));
    if (shelf !== null) return { view: "shelf", shelf, sort };
  }
  return { view: "home" };
}

/** Whether the URL names a `view` or a shelf id the page does not know. */
export function hasUnknownView(params: URLSearchParams): boolean {
  const view = params.get("view");
  if (view === "shelf") return parseShelfId(params.get("shelf")) === null;
  return false;
}

/** Whether the drawn view has a field the URL lacks or states unreadably. */
export function needsViewFillIn(params: URLSearchParams, view: ClipsView): boolean {
  if (view.view === "home") return false;
  if (view.view === "library") {
    return !isClipGroup(params.get("group")) || !isClipSort(params.get("sort"));
  }
  return followsSort(view.shelf) && !isClipSort(params.get("sort"));
}

/** A folder shelf's title: its key's last segment, or the drive at the root. */
export function folderTitle(key: string, drive: string): string {
  const path = key.normalize("NFC").replace(/\/+$/, "");
  if (path === "") return drive;
  return path.split("/").pop() || drive;
}

export function clipsShelfTitle(
  shelf: ShelfId,
  drive: string,
  locale: string,
): string | null {
  if (shelf.kind === "folder") return folderTitle(shelf.key, drive);
  if (shelf.kind === "month") return formatMonth(shelf.key, locale);
  return null;
}

export function clipsHref(pathname: string, view: ClipsView): string {
  if (view.view === "home") return pathname;
  const query = new URLSearchParams({ view: view.view === "library" ? "all" : "shelf" });
  if (view.view === "library") {
    query.set("group", view.group);
    query.set("sort", view.sort);
  } else {
    query.set("shelf", shelfIdString(view.shelf));
    if (followsSort(view.shelf)) query.set("sort", view.sort);
  }
  return `${pathname}?${query}`;
}

export const LIBRARY_TAB_HREF = (pathname: string) => `${pathname}?view=all`;

/** Where the page goes for a shelf id it cannot read: Home. */
export function rewrittenHref(pathname: string): string {
  return pathname;
}

/** The shelf page's back link, and the tab it counts under. */
export function backTarget(shelf: ShelfId, sort: ClipSort): ClipsView {
  switch (shelf.kind) {
    case "tag":
    case "untagged":
      return { view: "library", group: "tags", sort };
    case "folder":
      return { view: "library", group: "folder", sort };
    case "month":
      return { view: "library", group: "month", sort };
    default:
      return { view: "home" };
  }
}
