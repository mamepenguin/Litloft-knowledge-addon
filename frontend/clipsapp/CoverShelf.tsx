"use client";

import type { FileItem } from "@/types";

import ClipCard from "./ClipCard";
import { useClipMeta } from "./clipMeta";
import { ClipGrid, ClipShelfBlock, SkeletonCard, type ClipShelfView } from "./ClipShelfBlock";

interface CardOptions {
  now: Date;
  /** The Library draws "site · N min"; elsewhere the age follows. */
  showAge: boolean;
  /** Every card is unread (the Unread shelf). `false` asks which are. */
  allUnread?: boolean;
  /** No card has a dot (Recently opened). */
  noDots?: boolean;
}

function useCards(items: readonly FileItem[], { now, showAge, allUnread, noDots }: CardOptions) {
  const meta = useClipMeta(
    items.map((item) => item.id),
    { dots: !allUnread && !noDots },
  );
  return (file: FileItem) => (
    <ClipCard
      file={file}
      cover={meta.coverOf(file.id)}
      dot={allUnread === true || (!noDots && meta.hasDot(file.id))}
      now={now}
      showAge={showAge}
    />
  );
}

/** One shelf of cover cards. */
export function CoverShelf({
  title,
  count,
  seeAllHref,
  view,
  onRetry,
  ...cards
}: CardOptions & {
  title: string;
  count?: string;
  seeAllHref?: string;
  view: ClipShelfView<FileItem>;
  onRetry: () => void;
}) {
  const renderItem = useCards(view.status === "loaded" ? view.items : [], cards);
  return (
    <ClipShelfBlock
      title={title}
      count={count}
      seeAllHref={seeAllHref}
      view={view}
      onRetry={onRetry}
      renderItem={renderItem}
    />
  );
}

/** Cover cards in a wrapping grid, with `skeletons` placeholders after them while more is asked for. */
export function CoverGrid({
  items,
  skeletons = 0,
  ...cards
}: CardOptions & { items: readonly FileItem[]; skeletons?: number }) {
  const renderItem = useCards(items, cards);
  return (
    <ClipGrid>
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          {renderItem(item)}
        </li>
      ))}
      {Array.from({ length: skeletons }, (_, i) => (
        <SkeletonCard key={`skeleton-${i}`} grid />
      ))}
    </ClipGrid>
  );
}
