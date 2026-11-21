"use client";

import Link from "next/link";
import { useRef } from "react";
import { useLocale, useTranslations } from "next-intl";

import { useNearEnd } from "@/components/appshell/useNearEnd";

import { usePageFileLists } from "../cardMenu/PageFileMenu";
import { clipsShelfTitle, backTarget, clipsHref, hasClipFilters, NO_CLIP_FILTERS, type ClipFilters, type ClipSort, type ShelfId } from "./clipsUrl";
import { FilteredEmpty, LoadFailed } from "./ClipShelfBlock";
import { CoverGrid } from "./CoverShelf";
import { UnverifiedRows } from "./Home";
import { PAGE_SIZE, WATCH_HISTORY_MAX, type ReadyNotesTarget } from "./requests";
import { RetryLink } from "../notesapp/RetryLink";
import { useShelfData } from "./useShelfData";

export interface ShelfPageProps {
  drive: string;
  pathname: string;
  target: ReadyNotesTarget | null;
  shelf: ShelfId;
  sort: ClipSort;
  filters: ClipFilters;
  nickname: string | null;
  refresh: number;
  now: Date;
  onViewerRequired: () => void;
}

function useShelfTitle(shelf: ShelfId, drive: string): string {
  const t = useTranslations("knowledge.clips");
  const locale = useLocale();
  const named = clipsShelfTitle(shelf, drive, locale);
  if (named !== null) return named;
  switch (shelf.kind) {
    case "unread":
      return t("shelf.unread");
    case "recent":
      return t("shelf.recentlyOpened");
    case "new":
      return t("shelf.newClips");
    case "unverified":
      return t("shelf.unverified");
    case "untagged":
      return t("untagged");
    case "tag":
      return shelf.name;
    default:
      return "";
  }
}

export default function ShelfPage(props: ShelfPageProps) {
  const { drive, pathname, shelf, sort, filters, now } = props;
  const t = useTranslations("knowledge.clips");
  const locale = useLocale();
  const title = useShelfTitle(shelf, drive);
  const back = backTarget(shelf, sort);
  const backFilters = back.view === "library" ? filters : NO_CLIP_FILTERS;
  const lists = usePageFileLists();
  const listKey = shelf.kind === "recent" ? "page:recent" : "page";
  const removed = useRef(0);
  const data = useShelfData({
    drive,
    target: props.target,
    shelf,
    sort,
    size: shelf.kind === "recent" ? WATCH_HISTORY_MAX : PAGE_SIZE,
    paged: true,
    filters: backFilters,
    profileKey: props.nickname ?? "",
    refresh: props.refresh,
    onViewerRequired: props.onViewerRequired,
    removedBefore: () => removed.current,
    revision: lists.version,
  });
  const items = lists.filter(listKey, data.items);
  removed.current = lists.removedCount(listKey, data.items);
  const sentinel = useNearEnd(data.hasMore && data.more === "idle", data.loadMore);

  let body;
  if (data.phase === "failed") {
    body = <LoadFailed onRetry={data.retry} />;
  } else if (data.phase === "ready" && items.length === 0) {
    body = hasClipFilters(backFilters) ? (
      <FilteredEmpty />
    ) : (
      <p className="py-6 text-sm text-text-muted">{t("noClipsHere")}</p>
    );
  } else if (shelf.kind === "unverified" && data.phase === "ready") {
    body = (
      <UnverifiedRows
        items={items}
        now={now}
        listKey={listKey}
        remove={data.remove}
        setSaving={data.setSaving}
      />
    );
  } else {
    body = (
      <CoverGrid
        items={items}
        now={now}
        showAge
        allUnread={shelf.kind === "unread"}
        noDots={shelf.kind === "recent"}
        skeletons={data.phase === "loading" || data.more === "loading" ? 8 : 0}
        listKey={listKey}
      />
    );
  }

  return (
    <div>
      <Link
        href={clipsHref(pathname, back, backFilters)}
        className="mb-4 inline-flex items-center gap-0.5 text-sm text-text-muted transition-colors hover:text-text-primary pointer-coarse:min-h-11"
      >
        {t(back.view === "home" ? "backHome" : "backLibrary")}
      </Link>
      <div className="mb-4 flex min-w-0 items-baseline gap-2">
        <h2 className="min-w-0 truncate text-lg font-bold text-text-primary">{title}</h2>
        {shelf.kind !== "recent" && data.phase === "ready" && (
          <span className="flex-shrink-0 text-sm tabular-nums text-text-muted">
            {new Intl.NumberFormat(locale).format(data.count - lists.removedCount(listKey, data.counted))}
          </span>
        )}
      </div>
      {body}
      {data.more === "failed" && (
        <div className="mt-4 flex flex-col items-start gap-2">
          <p role="alert" className="text-xs text-danger">
            {t("loadFailed")}
          </p>
          <RetryLink onRetry={data.loadMore} />
        </div>
      )}
      <div ref={sentinel} aria-hidden="true" className="h-px" />
    </div>
  );
}
