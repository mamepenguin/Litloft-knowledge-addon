"use client";

import { useCallback } from "react";
import { ArrowUpDown, Tags } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { useNearEnd } from "@/components/appshell/useNearEnd";
import { MenuRadioGroup, ToolbarMenu } from "@/components/ToolbarMenu";

import { CLIP_GROUPS, CLIP_SORTS, clipsHref, type ClipGroup, type ClipSort, type ClipsView } from "./clipsUrl";
import { LoadFailed } from "./ClipShelfBlock";
import { CoverGrid, CoverShelf } from "./CoverShelf";
import { loadGridPage, NO_TAG_KEY, PAGE_SIZE, type ReadyNotesTarget } from "./requests";
import { usePagedClips } from "./usePagedClips";
import { useTagShelves } from "./useTagShelves";
import { RetryLink } from "../notesapp/RetryLink";

export interface LibraryProps {
  drive: string;
  pathname: string;
  target: ReadyNotesTarget;
  group: ClipGroup;
  sort: ClipSort;
  refresh: number;
  now: Date;
  onNavigate: (view: ClipsView) => void;
}

function Menus({ group, sort, onNavigate }: Pick<LibraryProps, "group" | "sort" | "onNavigate">) {
  const t = useTranslations("knowledge.clips");
  return (
    <div className="flex items-center gap-2 pb-10">
      <ToolbarMenu label={t("groupMenu")} value={t(`group.${group}`)} icon={Tags} align="start">
        {(close) => (
          <MenuRadioGroup
            heading={t("groupMenu")}
            options={CLIP_GROUPS.map((value) => ({ value, label: t(`group.${value}`) }))}
            isSelected={(value) => value === group}
            onSelect={(value) => {
              close();
              if (value !== group) onNavigate({ view: "library", group: value, sort });
            }}
          />
        )}
      </ToolbarMenu>
      <ToolbarMenu label={t("sortMenu")} value={t(`sort.${sort}`)} icon={ArrowUpDown} align="start">
        {(close) => (
          <MenuRadioGroup
            heading={t("sortMenu")}
            options={CLIP_SORTS.map((value) => ({ value, label: t(`sort.${value}`) }))}
            isSelected={(value) => value === sort}
            onSelect={(value) => {
              close();
              if (value !== sort) onNavigate({ view: "library", group, sort: value });
            }}
          />
        )}
      </ToolbarMenu>
    </div>
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

function TagShelves({ drive, pathname, target, sort, refresh, now }: LibraryProps) {
  const t = useTranslations("knowledge.clips");
  const locale = useLocale();
  const data = useTagShelves(drive, target, sort, refresh);
  const sentinel = useNearEnd(data.hasMore && data.more === "idle", data.loadMore);

  if (data.phase === "failed") return <LoadFailed onRetry={data.retry} />;
  if (data.phase === "ready" && data.shelves.length === 0) {
    return <p className="py-6 text-sm text-text-muted">{t("noClipsHere")}</p>;
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
        const untagged = shelf.key === NO_TAG_KEY;
        return (
          <CoverShelf
            key={shelf.key}
            title={untagged ? t("untagged") : shelf.label}
            count={new Intl.NumberFormat(locale).format(shelf.count)}
            seeAllHref={clipsHref(pathname, {
              view: "shelf",
              shelf: untagged ? { kind: "untagged" } : { kind: "tag", name: shelf.label },
              sort,
            })}
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

function Ungrouped({ drive, target, sort, refresh, now }: LibraryProps) {
  const t = useTranslations("knowledge.clips");
  const fetchPage = useCallback(
    (page: number, signal: AbortSignal) => loadGridPage(drive, target, page, sort, { signal }),
    [drive, target, sort],
  );
  const data = usePagedClips({
    scope: [drive, target.key, sort, "grid"].join("|"),
    fetchPage,
    pageSize: PAGE_SIZE,
    refresh,
  });
  const sentinel = useNearEnd(data.hasMore && data.more === "idle", data.loadMore);

  if (data.phase === "failed") return <LoadFailed onRetry={data.retry} />;
  if (data.phase === "ready" && data.items.length === 0) {
    return <p className="py-6 text-sm text-text-muted">{t("noClipsHere")}</p>;
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
      <Menus group={props.group} sort={props.sort} onNavigate={props.onNavigate} />
      {props.group === "tags" ? <TagShelves {...props} /> : <Ungrouped {...props} />}
    </div>
  );
}

