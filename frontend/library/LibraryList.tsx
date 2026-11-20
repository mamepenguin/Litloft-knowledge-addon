"use client";

import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Search } from "lucide-react";

import { SortMenu as ViewSortMenu } from "@/components/appshell/ViewMenus";
import { useNearEnd } from "@/components/appshell/useNearEnd";
import type { FileItem } from "@/types";

import { formatNoteTime } from "../noteDates";
import { excerptFromText } from "../noteExcerpt";
import { LIBRARY_SORTS, type LibrarySort, type Selection } from "./libraryUrl";
import type { ListPhase } from "./useNotesList";
import { useCardMenuHandlers, type CardMenuOptions } from "../cardMenu/PageFileMenu";

export interface LibraryListProps {
  rows: FileItem[];
  /** The page menu's entry for a row; absent leaves the row as it was. */
  menuFor?: (file: FileItem) => CardMenuOptions;
  /** The opening text of the notes whose answer is in. */
  openings: Record<string, string>;
  phase: ListPhase;
  more: "idle" | "loading" | "failed";
  hasMore: boolean;
  selection: Selection;
  query: string;
  sort: LibrarySort;
  /** The row shown in the pane, if any. */
  selectedId: string | null;
  now: Date;
  hrefFor: (file: FileItem) => string;
  /** Called by a plain click on a row. Return true when the click was taken (the row is not followed). */
  onChoose: (file: FileItem) => boolean;
  onSearch: (query: string) => void;
  onSort: (sort: LibrarySort) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  /** The phone layout: the sort button is drawn by the page, beside the rail menu. */
  phone?: boolean;
}

/** A folder path's own name; the full path does not fit a phone's field. */
export function lastSegment(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function SearchField({
  selection,
  query,
  onSearch,
  phone,
}: {
  selection: Selection;
  query: string;
  onSearch: (query: string) => void;
  phone: boolean;
}) {
  const t = useTranslations("knowledge.notesLibrary");
  const [draft, setDraft] = useState(query);
  useEffect(() => {
    setDraft(query);
  }, [query]);

  const placeholder =
    selection.kind === "folder"
      ? t("searchFolder", {
          folder: selection.path === "" ? t("rootFolder") : phone ? lastSegment(selection.path) : selection.path,
        })
      : selection.kind === "tag"
        ? t("searchTag", { tag: selection.name })
        : t("searchNotes");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(draft.trim());
  };

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-warm-silver/40 px-3 focus-within:border-focus-ring focus-within:ring-1 focus-within:ring-focus-ring pointer-coarse:h-11"
    >
      <Search size={14} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-text-muted" />
      <input
        type="search"
        maxLength={200}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-warm-silver focus:outline-none"
      />
    </form>
  );
}

function Row({
  file,
  opening,
  selected,
  now,
  dateField,
  href,
  menu,
  onClick,
}: {
  file: FileItem;
  opening: string | undefined;
  selected: boolean;
  now: Date;
  dateField: "created_at" | "updated_at";
  href: string;
  menu?: CardMenuOptions;
  onClick: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const locale = useLocale();
  const title = file.title || file.filename;
  const excerpt = opening ? excerptFromText(opening, title).replace(/\s+/g, " ") : "";
  const handlers = useCardMenuHandlers(file, menu);
  return (
    <li>
      <Link
        href={href}
        onClick={(e) => {
          handlers.onClick?.(e);
          if (e.defaultPrevented) return;
          onClick(e);
        }}
        onContextMenu={handlers.onContextMenu}
        onTouchStart={handlers.onTouchStart}
        onTouchEnd={handlers.onTouchEnd}
        onTouchMove={handlers.onTouchMove}
        aria-current={selected ? "true" : undefined}
        className={`flex select-none flex-col border-b border-bg-border px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring [-webkit-touch-callout:none] ${
          selected ? "bg-bg-elevated" : "hover:bg-bg-elevated"
        }`}
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-primary">{title}</span>
          <span className="shrink-0 text-xs tabular-nums text-text-muted">
            {formatNoteTime(file[dateField], now, locale)}
          </span>
        </span>
        <span
          data-testid="note-excerpt"
          className="mt-1 min-h-[2.4rem] line-clamp-2 text-[13px] leading-[1.55] text-text-muted"
        >
          {excerpt}
        </span>
      </Link>
    </li>
  );
}

export function SortMenu({ sort, onSort }: { sort: LibrarySort; onSort: (sort: LibrarySort) => void }) {
  const t = useTranslations("knowledge.notesLibrary");
  return (
    <ViewSortMenu
      value={sort}
      options={LIBRARY_SORTS.map((value) => ({ value, label: t(`sort.${value}`) }))}
      onChange={onSort}
      showLabel={false}
    />
  );
}

export function LibraryList(props: LibraryListProps) {
  const t = useTranslations("knowledge.notesLibrary");
  const sentinel = useNearEnd(props.hasMore && props.more === "idle", props.onLoadMore);
  const dateField = props.sort === "created" ? "created_at" : "updated_at";
  const empty = props.phase === "ready" && props.rows.length === 0;

  return (
    <section aria-label={t("listLabel")} className="flex min-w-0 flex-col">
      <div className={`flex gap-2 pb-3 ${props.phone ? "px-4" : "px-3"}`}>
        <SearchField selection={props.selection} query={props.query} onSearch={props.onSearch} phone={props.phone === true} />
        {!props.phone && <SortMenu sort={props.sort} onSort={props.onSort} />}
      </div>
      {props.phase === "loading" && props.rows.length === 0 && (
        <div aria-hidden="true" data-testid="list-skeleton" className="flex flex-col gap-1 px-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[78px] animate-pulse rounded-xl bg-bg-elevated" />
          ))}
        </div>
      )}
      {empty && <p className="px-4 py-6 text-sm text-text-muted">{t("noNotesHere")}</p>}
      <ul>
        {props.rows.map((file) => (
          <Row
            key={file.id}
            file={file}
            opening={props.openings[file.id]}
            selected={file.id === props.selectedId}
            now={props.now}
            dateField={dateField}
            href={props.hrefFor(file)}
            menu={props.menuFor?.(file)}
            onClick={(e) => {
              if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              if (props.onChoose(file)) e.preventDefault();
            }}
          />
        ))}
      </ul>
      {(props.phase === "failed" || props.more === "failed") && (
        <div className="px-4 py-3">
          <p role="alert" className="mb-2 text-xs text-danger">
            {t("loadFailed")}
          </p>
          <button
            type="button"
            onClick={props.phase === "failed" ? props.onRetry : props.onLoadMore}
            className="rounded-2xl border border-bg-border px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring pointer-coarse:min-h-11"
          >
            {t("retry")}
          </button>
        </div>
      )}
      <div ref={sentinel} aria-hidden="true" className="h-px" />
    </section>
  );
}
