import type { ListingSortField, SortOrder } from "@/types";

export type AllNotesSort = "updated" | "title" | "created";

export const ALL_NOTES_SORTS: AllNotesSort[] = ["updated", "title", "created"];

export interface AllNotesScope {
  /** `null` is every folder; `""` is the drive root. */
  folder: string | null;
  tag: string | null;
  sort: AllNotesSort;
  query: string;
  /** True only when the URL asks for clips too, so the default stays out of the URL. */
  clips?: boolean;
}

export const SORT_REQUEST: Record<AllNotesSort, { sort: ListingSortField; order: SortOrder }> = {
  updated: { sort: "updated_at", order: "desc" },
  title: { sort: "title", order: "asc" },
  created: { sort: "created_at", order: "desc" },
};

export function readAllNotesScope(params: URLSearchParams): AllNotesScope {
  const sort = params.get("sort");
  return {
    folder: params.get("folder"),
    tag: params.get("tag") || null,
    sort: ALL_NOTES_SORTS.includes(sort as AllNotesSort) ? (sort as AllNotesSort) : "updated",
    query: params.get("q")?.trim() ?? "",
    ...(params.get("clips") === "1" ? { clips: true } : {}),
  };
}

/** Defaults are left out of the URL, so the plain `view=all` link is the unfiltered list. */
export function allNotesHref(pathname: string, scope: AllNotesScope): string {
  const params = new URLSearchParams({ view: "all" });
  if (scope.folder !== null) params.set("folder", scope.folder);
  if (scope.tag) params.set("tag", scope.tag);
  if (scope.sort !== "updated") params.set("sort", scope.sort);
  if (scope.query) params.set("q", scope.query);
  if (scope.clips) params.set("clips", "1");
  return `${pathname}?${params}`;
}
