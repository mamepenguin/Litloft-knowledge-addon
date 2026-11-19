import {
  getDriveFiles,
  getDriveFilesWithFileIds,
  getShelves,
  getShelvesWithFileIds,
  getWatchHistory,
  setFileTrustTier,
  type ShelfItem,
  type ShelvesParams,
} from "@/lib/api";
import { ApiStatusError } from "@/lib/apiError";
import type { ListingFilters } from "@/lib/listingRequest";
import type { FileItem } from "@/types";

import type { ReadyNotesTarget } from "../notesapp/useNotesTarget";
import { followsSort, type ClipSort, type ShelfId } from "./clipsUrl";

export type { ReadyNotesTarget };

export const HOME_SHELF_SIZE = 12;
export const UNVERIFIED_ROWS = 5;
export const PAGE_SIZE = 60;
export const TAG_SHELVES_PER_REQUEST = 12;
export const WATCH_HISTORY_MAX = 50;

export const NO_TAG_KEY = "no_tag";

const CLIP_ORIGIN = "webclip";

function asList(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : [...value];
}

/** The target's conditions; `type` and `origin` are fixed last so nothing widens them. */
export function clipConditions(
  target: ReadyNotesTarget,
  extra: { trust?: "unverified" } = {},
): ListingFilters {
  const own = target.params;
  const tags = asList(own?.tag);
  return {
    ...(own ?? {}),
    ...(tags.length > 0 ? { tag: tags } : {}),
    ...(extra.trust ? { trust: extra.trust } : {}),
    type: "text",
    origin: CLIP_ORIGIN,
  };
}

export function isViewerRequired(error: unknown): boolean {
  return (
    error instanceof ApiStatusError &&
    error.status === 400 &&
    error.detail === "viewer_required"
  );
}

export function sortParams(sort: ClipSort): Pick<ShelvesParams, "sort" | "order"> {
  if (sort === "oldest") return { sort: "created_at", order: "asc" };
  if (sort === "title") return { sort: "title", order: "asc" };
  return { sort: "created_at", order: "desc" };
}

export interface ClipPage {
  items: ShelfItem[];
  /** The shelf's own count, for a shelf page's total. */
  count: number;
}

type Signal = { signal?: AbortSignal };

function shelves(
  drive: string,
  target: ReadyNotesTarget,
  params: ShelvesParams,
  options?: Signal,
) {
  return target.fileIds === null
    ? getShelves(drive, params, options)
    : getShelvesWithFileIds(drive, params, target.fileIds, options);
}

/** The scope line's count: `files` with the target. */
export function loadClipCount(
  drive: string,
  target: ReadyNotesTarget,
  options?: Signal,
): Promise<number> {
  const params = { ...clipConditions(target), limit: 1 };
  return (
    target.fileIds === null
      ? getDriveFiles(drive, params, options)
      : getDriveFilesWithFileIds(drive, params, target.fileIds, options)
  ).then((page) => page.meta.total);
}

/** Whether the drive holds any clip, whatever the target. */
export function loadDriveClipCount(drive: string, options?: Signal): Promise<number> {
  return getDriveFiles(drive, { type: "text", origin: CLIP_ORIGIN, limit: 1 }, options).then(
    (page) => page.meta.total,
  );
}

/**
 * One shelf's page. Home passes no `page` and `perShelf` 12 (5 for the rows);
 * a shelf page passes `page` and 60. Only a tag shelf follows the sort.
 */
export async function loadShelfPage(
  drive: string,
  /** `null` only for Recently opened, which ignores the target. */
  target: ReadyNotesTarget | null,
  shelf: ShelfId,
  { page, perShelf, sort }: { page?: number; perShelf: number; sort: ClipSort },
  options?: Signal,
): Promise<ClipPage> {
  if (shelf.kind === "recent") {
    const items = await getWatchHistory(drive, Math.min(perShelf, WATCH_HISTORY_MAX), "all", "text", {
      origin: CLIP_ORIGIN,
    });
    return { items, count: items.length };
  }
  if (target === null) throw new Error("a shelf other than recent needs a target");
  const shelfBy =
    shelf.kind === "tag" || shelf.kind === "untagged"
      ? "tag"
      : shelf.kind === "folder"
        ? "folder"
        : shelf.kind === "month"
          ? "month"
          : "all";
  const params: ShelvesParams = {
    ...clipConditions(target, { trust: shelf.kind === "unverified" ? "unverified" : undefined }),
    by: shelfBy,
    key: shelf.kind === "tag" ? shelf.name : shelf.kind === "untagged" ? NO_TAG_KEY : shelf.kind === "folder" || shelf.kind === "month" ? shelf.key : "all",
    ...(shelf.kind === "unread" ? { opened: false } : {}),
    ...sortParams(followsSort(shelf) ? sort : "newest"),
    per_shelf: perShelf,
    ...(page !== undefined ? { page } : {}),
  };
  const res = await shelves(drive, target, params, options);
  const first = res.shelves[0];
  return { items: first?.items ?? [], count: first?.count ?? 0 };
}

/** The No grouping grid. */
export async function loadGridPage(
  drive: string,
  target: ReadyNotesTarget,
  page: number,
  sort: ClipSort,
  options?: Signal,
): Promise<ClipPage> {
  const res = await shelves(
    drive,
    target,
    {
      ...clipConditions(target),
      by: "all",
      key: "all",
      ...sortParams(sort),
      per_shelf: PAGE_SIZE,
      page,
    },
    options,
  );
  const first = res.shelves[0];
  return { items: first?.items ?? [], count: first?.count ?? 0 };
}

/** By tag, folder or month: `shelf_limit` shelves from `offset`, each with its first 12 cards. */
export function loadGroupShelves(
  drive: string,
  target: ReadyNotesTarget,
  by: "tag" | "folder" | "month",
  offset: number,
  sort: ClipSort,
  options?: Signal,
) {
  return shelves(
    drive,
    target,
    {
      ...clipConditions(target),
      by,
      ...sortParams(sort),
      per_shelf: HOME_SHELF_SIZE,
      shelf_limit: TAG_SHELVES_PER_REQUEST,
      offset,
    },
    options,
  );
}

/** Which of these clips the viewer has not opened. Asked without a target. */
export async function loadUnreadAmong(
  drive: string,
  ids: readonly string[],
  options?: Signal,
): Promise<Set<string>> {
  const res = await getShelves(
    drive,
    { by: "all", key: "all", opened: false, ids, per_shelf: PAGE_SIZE },
    options,
  );
  return new Set(res.shelves.flatMap((shelf) => shelf.items.map((item) => item.id)));
}

export function markVerified(id: string): Promise<FileItem> {
  return setFileTrustTier(id, "verified");
}
