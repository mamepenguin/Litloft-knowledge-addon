import { ApiStatusError, getDriveFiles, getShelves, getWatchHistory } from "@/lib/api";
import type { FileItem } from "@/types";

export const SHELF_SIZE = 12;
export const ALL_PAGE_SIZE = 60;

const CLIP = "webclip";

export type ClipLoader = (drive: string) => Promise<FileItem[]>;

function items(res: { shelves: { items: FileItem[] }[] }): FileItem[] {
  return res.shelves.flatMap((shelf) => shelf.items);
}

export function loadClipCount(drive: string): Promise<number> {
  return getDriveFiles(drive, { origin: CLIP, limit: 1 }).then((res) => res.meta.total);
}

export function loadUnread(drive: string): Promise<FileItem[]> {
  return getShelves(drive, {
    by: "all",
    key: "all",
    origin: CLIP,
    opened: false,
    sort: "created_at",
    order: "desc",
    per_shelf: SHELF_SIZE,
  }).then(items);
}

export function loadNewClips(drive: string): Promise<FileItem[]> {
  return getShelves(drive, {
    by: "all",
    key: "all",
    origin: CLIP,
    sort: "created_at",
    order: "desc",
    per_shelf: SHELF_SIZE,
  }).then(items);
}

export function loadUnverified(drive: string): Promise<FileItem[]> {
  return getShelves(drive, {
    by: "all",
    key: "all",
    origin: CLIP,
    trust: "unverified",
    sort: "created_at",
    order: "desc",
    per_shelf: SHELF_SIZE,
  }).then(items);
}

export function loadRecentlyOpened(drive: string): Promise<FileItem[]> {
  return getWatchHistory(drive, SHELF_SIZE, "all", null, { origin: CLIP });
}

export function loadAllClips(drive: string, page: number) {
  return getDriveFiles(drive, {
    origin: CLIP,
    sort: "created_at",
    order: "desc",
    page,
    limit: ALL_PAGE_SIZE,
  });
}

export function isViewerRequired(error: unknown): boolean {
  return (
    error instanceof ApiStatusError &&
    error.status === 400 &&
    error.detail === "viewer_required"
  );
}
