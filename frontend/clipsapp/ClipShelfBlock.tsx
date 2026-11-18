"use client";

import Link from "next/link";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { cardGridTemplate, MIN_CARD_COLUMNS, rowsFor, useCardColumns } from "@/lib/cardGrid";

import { RetryLink } from "../notesapp/RetryLink";

/** The clip cards' grid: 200px minimum, 20px gap. */
export const CLIP_GRID = { minWidthPx: 200, minWidth: "200px", gapPx: 20 } as const;

export type ClipShelfView<T> =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; items: readonly T[] };

const COARSE_QUERY = "(pointer: coarse)";

function useCoarsePointer(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window.matchMedia !== "function") return () => {};
    const mql = window.matchMedia(COARSE_QUERY);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === "function" && window.matchMedia(COARSE_QUERY).matches,
    () => false,
  );
}

export function SkeletonCard() {
  return (
    <li className="min-w-0 animate-pulse" aria-hidden="true" data-testid="clip-skeleton">
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

export function ShelfHeading({
  title,
  count,
  seeAllHref,
}: {
  title: string;
  /** Already in the viewer's number format. */
  count?: string;
  seeAllHref?: string;
}) {
  const t = useTranslations("knowledge.clips");
  return (
    <div className="mb-4 flex min-w-0 items-baseline gap-2">
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
  const coarse = useCoarsePointer();
  const effective = columns > 0 ? columns : MIN_CARD_COLUMNS;
  const capacity = effective * rowsFor(effective);
  const itemClass = coarse ? "min-w-0 w-[150px] shrink-0" : "min-w-0";

  let body: ReactNode;
  if (view.status === "failed") {
    body = <LoadFailed onRetry={onRetry} />;
  } else {
    const cards =
      view.status === "loading"
        ? Array.from({ length: coarse ? 4 : capacity }, (_, i) => <SkeletonCard key={i} />)
        : (coarse ? view.items : view.items.slice(0, capacity)).map((item) => (
            <li key={item.id} className={itemClass}>
              {renderItem(item)}
            </li>
          ));
    body = (
      <ul
        ref={ref}
        className={coarse ? "flex gap-3 overflow-x-auto" : "grid gap-x-5 gap-y-6"}
        style={coarse ? undefined : { gridTemplateColumns: cardGridTemplate(columns, CLIP_GRID) }}
      >
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
