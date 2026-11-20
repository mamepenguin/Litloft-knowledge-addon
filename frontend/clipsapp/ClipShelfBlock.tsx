"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/EmptyState";
import { cardGridTemplate, MIN_CARD_COLUMNS, rowsFor, useCardColumns } from "@/lib/cardGrid";

import { RetryLink } from "../notesapp/RetryLink";

/** The clip cards' grid: 200px minimum, 20px gap. */
export const CLIP_GRID = { minWidthPx: 200, minWidth: "200px", gapPx: 20 } as const;

export type ClipShelfView<T> =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; items: readonly T[] };

/** A mouse wraps a grid; only a coarse pointer gets the sideways strip of 150px cards. */
const ITEM = "min-w-0 pointer-coarse:w-[150px] pointer-coarse:shrink-0";
const LIST = "grid gap-x-5 gap-y-6 pointer-coarse:flex pointer-coarse:gap-3 pointer-coarse:overflow-x-auto";
const STRIP_SKELETONS = 4;

/** `grid` is a skeleton in a wrapping grid: it takes the column width, never the strip's 150px. */
export function SkeletonCard({ className = "", grid = false }: { className?: string; grid?: boolean }) {
  return (
    <li className={`${grid ? "min-w-0" : ITEM} animate-pulse ${className}`} aria-hidden="true" data-testid="clip-skeleton">
      <div className="aspect-[4/3] rounded-xl bg-bg-elevated" />
      <div className="mt-2.5 h-[2.9em] rounded-lg bg-bg-elevated text-[15px]" />
      <div className="mt-1 h-4 w-2/3 rounded-lg bg-bg-elevated" />
    </li>
  );
}

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("knowledge.clips");
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert" className="text-xs text-danger">
        {t("loadFailed")}
      </p>
      <RetryLink onRetry={onRetry} />
    </div>
  );
}

/** The empty state a name, tag or trust filter leaves behind. */
export function FilteredEmpty() {
  const t = useTranslations("knowledge.clips");
  return <EmptyState icon={Search} title={t("filterEmpty")} />;
}

export function ShelfHeading({
  title,
  count,
  seeAllHref,
  tight = false,
}: {
  title: string;
  /** Already in the viewer's number format. */
  count?: string;
  seeAllHref?: string;
  /** 8px to the list below instead of 16px: the Unverified rows. */
  tight?: boolean;
}) {
  const t = useTranslations("knowledge.clips");
  return (
    <div className={`${tight ? "mb-2" : "mb-4"} flex min-w-0 items-baseline gap-2`}>
      {title ? (
        <h2 className="min-w-0 truncate text-lg font-bold text-text-primary">{title}</h2>
      ) : (
        <div aria-hidden="true" className="h-6 w-32 animate-pulse rounded-lg bg-bg-elevated" />
      )}
      {count !== undefined && (
        <span className="flex-shrink-0 text-sm tabular-nums text-text-muted">{count}</span>
      )}
      {seeAllHref !== undefined && (
        <Link
          href={seeAllHref}
          aria-label={t("seeAllIn", { name: title })}
          className="ml-auto inline-flex flex-shrink-0 items-center gap-0.5 text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          {t("seeAll")}
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/**
 * A shelf of cover cards: as many as fit in the rows `rowsFor` allows at the
 * container's width, or a sideways strip on a coarse pointer.
 */
export function ClipShelfBlock<T extends { id: string }>({
  title,
  count,
  seeAllHref,
  view,
  onRetry,
  renderItem,
}: {
  title: string;
  /** Already in the viewer's number format. */
  count?: string;
  seeAllHref?: string;
  view: ClipShelfView<T>;
  onRetry: () => void;
  renderItem: (item: T) => ReactNode;
}) {
  const { ref, columns } = useCardColumns(CLIP_GRID);
  const effective = columns > 0 ? columns : MIN_CARD_COLUMNS;
  const capacity = effective * rowsFor(effective);

  let body: ReactNode;
  if (view.status === "failed") {
    body = <LoadFailed onRetry={onRetry} />;
  } else {
    // Beyond the grid's capacity a card exists only for the strip.
    const spill = (i: number, limit: number) => (i >= limit ? "hidden pointer-coarse:block" : "");
    const cards =
      view.status === "loading"
        ? Array.from({ length: Math.max(capacity, STRIP_SKELETONS) }, (_, i) => (
            <SkeletonCard
              key={i}
              className={`${i >= capacity ? "hidden" : ""} ${i >= STRIP_SKELETONS ? "pointer-coarse:hidden" : i >= capacity ? "pointer-coarse:block" : ""}`}
            />
          ))
        : view.items.map((item, i) => (
            <li key={item.id} className={`${ITEM} ${spill(i, capacity)}`}>
              {renderItem(item)}
            </li>
          ));
    body = (
      <ul ref={ref} className={LIST} style={{ gridTemplateColumns: cardGridTemplate(columns, CLIP_GRID) }}>
        {cards}
      </ul>
    );
  }

  return (
    <section className="min-w-0">
      <ShelfHeading title={title} count={count} seeAllHref={view.status === "failed" ? undefined : seeAllHref} />
      {body}
    </section>
  );
}

/** The wrapping grid of No grouping and the shelf pages. */
export function ClipGrid({ children }: { children: ReactNode }) {
  return (
    <ul
      className="grid gap-x-5 gap-y-6"
      style={{ gridTemplateColumns: cardGridTemplate(0, CLIP_GRID) }}
    >
      {children}
    </ul>
  );
}
