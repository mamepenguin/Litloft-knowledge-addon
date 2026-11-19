import { readLegacyGroup } from "@/lib/appPrefs";
import type { ListingSortField, SortOrder } from "@/types";

import { NOTES_APP } from "../notesapp/useNotesTarget";

export type LibrarySort = "updated" | "title" | "created";
export const LIBRARY_SORTS: LibrarySort[] = ["updated", "title", "created"];

export function isLibrarySort(value: unknown): value is LibrarySort {
  return LIBRARY_SORTS.includes(value as LibrarySort);
}

export const SORT_REQUEST: Record<LibrarySort, { sort: ListingSortField; order: SortOrder }> = {
  updated: { sort: "updated_at", order: "desc" },
  title: { sort: "title", order: "asc" },
  created: { sort: "created_at", order: "desc" },
};

export type Segment = "folder" | "tag";

export function isSegment(value: unknown): value is Segment {
  return value === "folder" || value === "tag";
}

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

/** `sort` is the Target's resolved sort, used when the URL states none. */
export function readLibraryParams(params: URLSearchParams, sort: LibrarySort = "updated"): LibraryParams {
  const raw = params.get("sort");
  return {
    folder: params.get("folder"),
    tag: params.get("tag") || null,
    sort: isLibrarySort(raw) ? raw : sort,
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

/** The segment the drive had before it was kept per Target; the default Target only. */
export function legacySegment(drive: string): Segment | null {
  const value = readLegacyGroup(drive, NOTES_APP);
  return isSegment(value) ? value : null;
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
 * `sort` is the sort in force and is always written, so every URL the Library
 * builds names it; an empty search is left out.
 */
export function libraryHref(
  pathname: string,
  current: URLSearchParams,
  change: LibraryChange,
  sort: LibrarySort,
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
  next.set("sort", change.sort ?? sort);
  if ("q" in change) apply("q", change.q?.trim());
  if ("note" in change) apply("note", change.note);
  return `${pathname}?${next}`;
}
