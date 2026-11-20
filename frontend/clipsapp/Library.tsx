"use client";

import { useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";

import { FilterMenus } from "@/components/appshell/FilterMenus";
import { GroupMenu, LibraryControlRow, SortMenu } from "@/components/appshell/ViewMenus";
import { useNearEnd } from "@/components/appshell/useNearEnd";

import {
  CLIP_GROUPS,
  CLIP_SORTS,
  clipFiltersKey,
  clipsHref,
  clipsShelfTitle,
  hasClipFilters,
  type ClipFilters,
  type ClipGroup,
  type ClipSort,
  type ClipState,
  type ShelfId,
} from "./clipsUrl";
import { FilteredEmpty, LoadFailed } from "./ClipShelfBlock";
import { CoverGrid, CoverShelf } from "./CoverShelf";
import {
  loadGridPage,
  loadTagCounts,
  NO_TAG_KEY,
  PAGE_SIZE,
  type ReadyNotesTarget,
} from "./requests";
import { usePagedClips } from "./usePagedClips";
import { useGroupShelves } from "./useGroupedShelves";
import { RetryLink } from "../notesapp/RetryLink";

export interface LibraryProps {
  drive: string;
  pathname: string;
  target: ReadyNotesTarget;
  group: ClipGroup;
  sort: ClipSort;
  filters: ClipFilters;
  refresh: number;
  now: Date;
  onGroup: (group: ClipGroup) => void;
  onSort: (sort: ClipSort) => void;
  onToggleTag: (name: string) => void;
  onClearTags: () => void;
  onState: (state: ClipState) => void;
  onViewerRejected: () => void;
}

function listOf(value: string | readonly string[] | undefined): string[] {
  return value === undefined ? [] : ([value].flat() as string[]);
}

function Menus({
  group,
  sort,
  filters,
  drive,
  target,
  onGroup,
  onSort,
  onToggleTag,
  onClearTags,
  onState,
  onViewerRejected,
}: Pick<
  LibraryProps,
  | "group"
  | "sort"
  | "filters"
  | "drive"
  | "target"
  | "onGroup"
  | "onSort"
  | "onToggleTag"
  | "onClearTags"
  | "onState"
  | "onViewerRejected"
>) {
  const t = useTranslations("knowledge.clips");
  const loadCandidates = useCallback(
    (signal: AbortSignal) => loadTagCounts(drive, target, filters, { signal }),
    [drive, target, filters],
  );
  const conditionsKey = JSON.stringify({
    target: target.key,
    tags: filters.tags,
    trust: filters.trust,
    name: filters.name,
  });
  return (
    <LibraryControlRow
      className="pb-10"
      filters={
        <FilterMenus
          tags={filters.tags}
          onToggle={onToggleTag}
          onClear={onClearTags}
          loadCandidates={loadCandidates}
          conditionsKey={conditionsKey}
          excludeTags={listOf(target.params?.tag)}
          state={{
            options: [
              { value: "all", label: t("state.all") },
              { value: "unverified", label: t("state.unverified") },
              { value: "verified", label: t("state.verified") },
            ],
            value: filters.trust ?? "all",
            onChange: (value) => onState(value as ClipState),
          }}
          onViewerRejected={onViewerRejected}
        />
      }
    >
      <GroupMenu
        value={group}
        options={CLIP_GROUPS.map((value) => ({ value, label: t(`group.${value}`) }))}
        onChange={onGroup}
      />
      <SortMenu
        value={sort}
        options={CLIP_SORTS.map((value) => ({ value, label: t(`sort.${value}`) }))}
        onChange={onSort}
      />
    </LibraryControlRow>
  );
}

function MoreRow({
  more,
  onRetry,
}: {
  more: "idle" | "loading" | "failed";
  onRetry: () => void;
}) {
  const t = useTranslations("knowledge.clips");
  if (more !== "failed") return null;
  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <p role="alert" className="text-xs text-danger">
        {t("loadFailed")}
      </p>
      <RetryLink onRetry={onRetry} />
    </div>
  );
}

function GroupShelves({
  drive,
  pathname,
  target,
  group,
  sort,
  filters,
  refresh,
  now,
}: Omit<LibraryProps, "group"> & { group: "tag" | "folder" | "month" }) {
  const t = useTranslations("knowledge.clips");
  const locale = useLocale();
  const data = useGroupShelves(drive, target, group, sort, refresh, filters);
  const sentinel = useNearEnd(data.hasMore && data.more === "idle", data.loadMore);

  if (data.phase === "failed") return <LoadFailed onRetry={data.retry} />;
  if (data.phase === "ready" && data.shelves.length === 0) {
    return hasClipFilters(filters) ? (
      <FilteredEmpty />
    ) : (
      <p className="py-6 text-sm text-text-muted">{t("noClipsHere")}</p>
    );
  }
  if (data.phase === "loading") {
    return (
      <CoverShelf
        title=""
        view={{ status: "loading" }}
        onRetry={data.retry}
        now={now}
        showAge={false}
      />
    );
  }
  return (
    <div className="flex flex-col gap-10">
      {data.shelves.map((shelf) => {
        const untagged = group === "tag" && shelf.key === NO_TAG_KEY;
        const shelfId: ShelfId = untagged
          ? { kind: "untagged" }
          : group === "tag"
            ? { kind: "tag", name: shelf.label }
            : { kind: group, key: shelf.key };
        const title = untagged
          ? t("untagged")
          : (clipsShelfTitle(shelfId, drive, locale) ?? shelf.label);
        return (
          <CoverShelf
            key={shelf.key}
            title={title}
            count={new Intl.NumberFormat(locale).format(shelf.count)}
            seeAllHref={clipsHref(pathname, { view: "shelf", shelf: shelfId, sort }, filters)}
            view={{ status: "loaded", items: shelf.items }}
            onRetry={data.retry}
            now={now}
            showAge={false}
          />
        );
      })}
      <MoreRow more={data.more} onRetry={data.loadMore} />
      <div ref={sentinel} aria-hidden="true" className="h-px" />
    </div>
  );
}

function Ungrouped({ drive, target, sort, filters, refresh, now }: LibraryProps) {
  const t = useTranslations("knowledge.clips");
  const fetchPage = useCallback(
    (page: number, signal: AbortSignal) =>
      loadGridPage(drive, target, page, sort, filters, { signal }),
    [drive, target, sort, filters],
  );
  const data = usePagedClips({
    scope: [drive, target.key, sort, "grid", clipFiltersKey(filters)].join("|"),
    fetchPage,
    pageSize: PAGE_SIZE,
    refresh,
  });
  const sentinel = useNearEnd(data.hasMore && data.more === "idle", data.loadMore);

  if (data.phase === "failed") return <LoadFailed onRetry={data.retry} />;
  if (data.phase === "ready" && data.items.length === 0) {
    return hasClipFilters(filters) ? (
      <FilteredEmpty />
    ) : (
      <p className="py-6 text-sm text-text-muted">{t("noClipsHere")}</p>
    );
  }
  return (
    <>
      <CoverGrid
        items={data.items}
        now={now}
        showAge={false}
        skeletons={data.phase === "loading" || data.more === "loading" ? 8 : 0}
      />
      <MoreRow more={data.more} onRetry={data.loadMore} />
      <div ref={sentinel} aria-hidden="true" className="h-px" />
    </>
  );
}

export default function Library(props: LibraryProps) {
  return (
    <div>
      <Menus {...props} />
      {props.group === "none" ? (
        <Ungrouped {...props} />
      ) : (
        <GroupShelves {...props} group={props.group === "tags" ? "tag" : props.group} />
      )}
    </div>
  );
}
