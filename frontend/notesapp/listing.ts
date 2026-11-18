import {
  getDriveFiles,
  getDriveFilesWithFileIds,
  getShelves,
  getShelvesWithFileIds,
  type ShelvesResponse,
} from "@/lib/api";
import { ApiStatusError } from "@/lib/apiError";
import {
  appendListingFilters,
  type ListingFilters,
  type ListingRequestParams,
} from "@/lib/listingRequest";
import type { FolderCount, PaginatedResponse } from "@/types";

import type { ReadyNotesTarget } from "./useNotesTarget";

export type { ReadyNotesTarget };

/** What a caller adds to the target's own conditions. */
export interface NotesExtra {
  /** Files directly in this folder; `""` is the drive root. */
  path?: string;
  tag?: string;
  search?: string;
}

function asList(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : [...value];
}

/**
 * The target's conditions with the caller's added to them. A tag is added to
 * the target's own tags, never in place of them: a note must satisfy both.
 * `type` and `exclude_origin` are fixed last so nothing can widen them.
 */
export function notesConditions(
  target: ReadyNotesTarget,
  extra: NotesExtra = {},
): ListingFilters {
  const own = target.params;
  const tags = [...asList(own?.tag), ...(extra.tag ? [extra.tag] : [])];
  return {
    ...(own ?? {}),
    ...(tags.length > 0 ? { tag: tags } : {}),
    ...(extra.search ? { search: extra.search } : {}),
    type: "text",
    exclude_origin: "webclip",
  };
}

export interface ListNotesParams extends NotesExtra {
  sort?: ListingRequestParams["sort"];
  order?: ListingRequestParams["order"];
  page?: number;
  limit?: number;
}

/** `files`, or `files/query` for a member target. */
export function listNotes(
  drive: string,
  target: ReadyNotesTarget,
  { path, sort, order, page, limit, ...extra }: ListNotesParams = {},
  options?: { signal?: AbortSignal },
): Promise<PaginatedResponse> {
  const params: ListingRequestParams = {
    ...notesConditions(target, extra),
    ...(path !== undefined ? { path } : {}),
    ...(sort ? { sort } : {}),
    ...(order ? { order } : {}),
    ...(page ? { page } : {}),
    ...(limit ? { limit } : {}),
  };
  return target.fileIds === null
    ? getDriveFiles(drive, params, options)
    : getDriveFilesWithFileIds(drive, params, target.fileIds, options);
}

/** `shelves?by=tag`, or `shelves/query` for a member target. One tag per shelf. */
export function listNoteTagShelves(
  drive: string,
  target: ReadyNotesTarget,
  { offset, shelfLimit }: { offset: number; shelfLimit: number },
  options?: { signal?: AbortSignal },
): Promise<ShelvesResponse> {
  const params = {
    ...notesConditions(target),
    by: "tag" as const,
    per_shelf: 1,
    shelf_limit: shelfLimit,
    offset,
  };
  return target.fileIds === null
    ? getShelves(drive, params, options)
    : getShelvesWithFileIds(drive, params, target.fileIds, options);
}

/** `folder-counts`, or `folder-counts/query` for a member target. */
export async function getNoteFolderCounts(
  drive: string,
  target: ReadyNotesTarget,
  options?: { signal?: AbortSignal },
): Promise<FolderCount[]> {
  const search = new URLSearchParams();
  appendListingFilters(search, notesConditions(target));
  const base = `/api/drives/${encodeURIComponent(drive)}/folder-counts`;
  const member = target.fileIds !== null;
  const res = await fetch(`${base}${member ? "/query" : ""}?${search}`, {
    credentials: "include",
    signal: options?.signal,
    ...(member
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_ids: target.fileIds }),
        }
      : {}),
  });
  if (!res.ok) {
    throw new ApiStatusError(res.status, `API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as FolderCount[];
}

/** Whether a note passes `type=text` and `exclude_origin=webclip`, whatever the target. */
export function checkNote(
  drive: string,
  fileId: string,
  options?: { signal?: AbortSignal },
): Promise<PaginatedResponse> {
  return getDriveFilesWithFileIds(
    drive,
    { type: "text", exclude_origin: "webclip", limit: 1 },
    [fileId],
    options,
  );
}
