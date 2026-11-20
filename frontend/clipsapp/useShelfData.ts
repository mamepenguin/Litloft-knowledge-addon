"use client";

import { useCallback } from "react";

import type { ClipFilters, ClipSort, ShelfId } from "./clipsUrl";
import { clipFiltersKey, NO_CLIP_FILTERS, shelfIdString } from "./clipsUrl";
import { isViewerRequired, loadShelfPage, type ReadyNotesTarget } from "./requests";
import { usePagedClips } from "./usePagedClips";

export interface ShelfDataOptions {
  drive: string;
  /** `null` while the target is not ready; Recently opened does not need one. */
  target: ReadyNotesTarget | null;
  shelf: ShelfId;
  sort: ClipSort;
  /** Home's shelves are one page of `size`; a shelf page pages by `size`. */
  size: number;
  paged: boolean;
  filters?: ClipFilters;
  /** The nickname the shelf was asked under; another one starts it over. */
  profileKey: string;
  refresh: number;
  onViewerRequired: () => void;
  /** How many of the drawn cards the menu has taken out. */
  removedBefore?: () => number;
  /** Bumps when the page's menu removes a card, so a page in flight is dropped. */
  revision?: number;
}

/** One shelf's cards as the page asks for them. */
export function useShelfData({
  drive,
  target,
  shelf,
  sort,
  size,
  paged,
  filters,
  profileKey,
  refresh,
  onViewerRequired,
  removedBefore,
  revision,
}: ShelfDataOptions) {
  const recent = shelf.kind === "recent";
  const ready = recent || target !== null;
  const scope = ready
    ? [
        drive,
        recent ? "-" : target?.key,
        shelfIdString(shelf),
        sort,
        size,
        paged,
        profileKey,
        clipFiltersKey(filters ?? NO_CLIP_FILTERS),
      ].join("|")
    : null;

  const fetchPage = useCallback(
    (page: number, signal: AbortSignal) =>
      loadShelfPage(drive, target, shelf, { page: paged ? page : undefined, perShelf: size, sort, filters }, { signal }),
    [drive, target, shelf, size, paged, sort, filters],
  );
  const onError = useCallback(
    (error: unknown) => {
      if (isViewerRequired(error)) onViewerRequired();
    },
    [onViewerRequired],
  );

  return usePagedClips({
    scope,
    fetchPage,
    pageSize: size,
    refresh,
    cap: paged ? undefined : size,
    replaceOnRefresh: recent,
    onError,
    removedBefore,
    revision,
  });
}
