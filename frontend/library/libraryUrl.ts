import type { ListingSortField, SortOrder } from "@/types";

export type LibrarySort = "updated" | "title" | "created";
export const LIBRARY_SORTS: LibrarySort[] = ["updated", "title", "created"];

export const SORT_REQUEST: Record<LibrarySort, { sort: ListingSortField; order: SortOrder }> = {
  updated: { sort: "updated_at", order: "desc" },
  title: { sort: "title", order: "asc" },
  created: { sort: "created_at", order: "desc" },
};

export type Segment = "folder" | "tag";

/** What the rail has selected. `path` `""` is the drive root. */
export type Selection =
  | { kind: "all" }
  | { kind: "folder"; path: string }
  | { kind: "tag"; name: string };

export interface LibraryParams {
  /** `""` is the drive root; `null` is not in the URL. */
  folder: string | null;
  tag: string | null;
  sort: LibrarySort;
  q: string;
  note: string | null;
}

export function readLibraryParams(params: URLSearchParams): LibraryParams {
  const sort = params.get("sort");
  return {
    folder: params.get("folder"),
    tag: params.get("tag") || null,
    sort: LIBRARY_SORTS.includes(sort as LibrarySort) ? (sort as LibrarySort) : "updated",
    q: params.get("q")?.trim() ?? "",
    note: params.get("note") || null,
  };
}

/** With both in the URL, the tag wins: a folder and a tag are never selected together. */
export function selectionOf(params: LibraryParams): Selection {
  if (params.tag) return { kind: "tag", name: params.tag };
  if (params.folder !== null) return { kind: "folder", path: params.folder };
  return { kind: "all" };
}

/** `tag` in the URL is Tags, `folder` is Folders, neither is the stored choice. */
export function segmentOf(params: LibraryParams, stored: Segment): Segment {
  if (params.tag) return "tag";
  if (params.folder !== null) return "folder";
  return stored;
}

/** The URL names both a folder and a tag, which `selectionOf` reads as the tag. */
export function hasConflictingSelection(params: URLSearchParams): boolean {
  return Boolean(params.get("tag")) && params.has("folder");
}

export type LibraryChange = Partial<{
  folder: string | null;
  tag: string | null;
  sort: LibrarySort;
  q: string;
  note: string | null;
}>;

/**
 * The URL with `change` applied. Parameters the Library does not own are kept.
 * Defaults (sort `updated`, an empty search) are left out.
 */
export function libraryHref(
  pathname: string,
  current: URLSearchParams,
  change: LibraryChange,
): string {
  const next = new URLSearchParams(current);
  next.set("view", "all");
  const apply = (name: string, value: string | null | undefined) => {
    if (value === null || value === undefined || value === "") next.delete(name);
    else next.set(name, value);
  };
  if ("folder" in change) {
    // `folder=` is the drive root, so the empty string is written, not dropped.
    if (change.folder === null || change.folder === undefined) next.delete("folder");
    else next.set("folder", change.folder);
  }
  if ("tag" in change) apply("tag", change.tag);
  if ("sort" in change) apply("sort", change.sort === "updated" ? null : change.sort);
  if ("q" in change) apply("q", change.q?.trim());
  if ("note" in change) apply("note", change.note);
  return `${pathname}?${next}`;
}

const classificationKey = (drive: string) => `litloft.addon.knowledge.classification.${drive}`;

export function readClassification(drive: string): Segment {
  try {
    return window.localStorage.getItem(classificationKey(drive)) === "tag" ? "tag" : "folder";
  } catch {
    return "folder";
  }
}

export function writeClassification(drive: string, segment: Segment): void {
  try {
    window.localStorage.setItem(classificationKey(drive), segment);
  } catch {
    // The choice is a convenience; the segment still changes for this visit.
  }
}
