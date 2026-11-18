"use client";

import { getNoteFolderCounts, listNoteTagShelves } from "../notesapp/listing";
import type { ReadyNotesTarget } from "../notesapp/useNotesTarget";
import type { Segment } from "./libraryUrl";
import { useScopedLoad, type ScopedPhase } from "./useScopedLoad";

export const MAX_RAIL_ENTRIES = 200;
export const TAG_SHELVES_PER_REQUEST = 24;
/** The shelf `shelves?by=tag` ends with for notes that carry no tag. */
const UNTAGGED_SHELF = "no_tag";

/** `key` is a folder path (`""` the drive root) or a tag name. */
export interface RailEntry {
  key: string;
  count: number;
}

export interface RailData {
  entries: RailEntry[];
  /** A later page of tags failed; the entries drawn are the ones that came. */
  partial: boolean;
}

async function loadFolders(
  drive: string,
  target: ReadyNotesTarget,
  signal: AbortSignal,
): Promise<RailData> {
  const rows = await getNoteFolderCounts(drive, target, { signal });
  return {
    entries: rows.slice(0, MAX_RAIL_ENTRIES).map((row) => ({ key: row.path, count: row.count })),
    partial: false,
  };
}

/** One request after another, so a long tag list never opens many requests at once. */
async function loadTags(
  drive: string,
  target: ReadyNotesTarget,
  signal: AbortSignal,
): Promise<RailData> {
  const entries: RailEntry[] = [];
  let offset = 0;
  for (;;) {
    let page;
    try {
      page = await listNoteTagShelves(
        drive,
        target,
        { offset, shelfLimit: TAG_SHELVES_PER_REQUEST },
        { signal },
      );
    } catch (error) {
      if (offset === 0 || signal.aborted) throw error;
      return { entries, partial: true };
    }
    for (const shelf of page.shelves) {
      if (shelf.key === UNTAGGED_SHELF) continue;
      entries.push({ key: shelf.key, count: shelf.count });
    }
    offset += TAG_SHELVES_PER_REQUEST;
    if (
      entries.length >= MAX_RAIL_ENTRIES ||
      page.shelves.length === 0 ||
      offset >= page.total_shelves
    ) {
      return { entries: entries.slice(0, MAX_RAIL_ENTRIES), partial: false };
    }
  }
}

/**
 * The rail's entries under the target. `refresh` asks again without emptying
 * what is drawn.
 */
export function useRailEntries(
  drive: string,
  target: ReadyNotesTarget | null,
  segment: Segment,
  refresh: number,
): { phase: ScopedPhase; data: RailData | null; retry: () => void } {
  const scope = target === null ? null : `${drive}\u0000${target.key}\u0000${segment}`;
  return useScopedLoad<RailData>(
    scope,
    (signal) =>
      target === null
        ? Promise.reject(new Error("no target"))
        : segment === "folder"
          ? loadFolders(drive, target, signal)
          : loadTags(drive, target, signal),
    refresh,
  );
}
