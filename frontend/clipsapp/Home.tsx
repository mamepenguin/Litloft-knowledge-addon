"use client";

import { useLocale, useTranslations } from "next-intl";

import type { FileItem } from "@/types";

import ClipRow from "./ClipRow";
import { useClipMeta } from "./clipMeta";
import { clipsHref, type ShelfId } from "./clipsUrl";
import { CoverShelf } from "./CoverShelf";
import { ShelfHeading, type ClipShelfView } from "./ClipShelfBlock";
import { LoadFailed } from "./ClipShelfBlock";
import { HOME_SHELF_SIZE, UNVERIFIED_ROWS, type ReadyNotesTarget } from "./requests";
import { useShelfData } from "./useShelfData";
import { useVerify } from "./useVerify";

export interface HomeProps {
  drive: string;
  pathname: string;
  /** `null` when the Target has no clips; only Recently opened is drawn then. */
  target: ReadyNotesTarget | null;
  /** A nickname is set and nothing has said the viewer is unknown. */
  withProfile: boolean;
  nickname: string | null;
  refresh: number;
  now: Date;
  onViewerRequired: () => void;
}

function viewOf(
  phase: "loading" | "ready" | "failed",
  items: readonly FileItem[],
): ClipShelfView<FileItem> {
  if (phase === "failed") return { status: "failed" };
  if (phase === "loading") return { status: "loading" };
  return { status: "loaded", items };
}

function CardShelf({
  shelf,
  title,
  withCount,
  ...props
}: HomeProps & { shelf: ShelfId; title: string; withCount: boolean }) {
  const locale = useLocale();
  const data = useShelfData({
    drive: props.drive,
    target: shelf.kind === "recent" ? null : props.target,
    shelf,
    sort: "newest",
    size: HOME_SHELF_SIZE,
    paged: false,
    profileKey: props.nickname ?? "",
    refresh: props.refresh,
    onViewerRequired: props.onViewerRequired,
  });
  if (data.phase === "ready" && data.items.length === 0) return null;
  return (
    <CoverShelf
      title={title}
      count={withCount && data.phase === "ready" ? new Intl.NumberFormat(locale).format(data.count) : undefined}
      seeAllHref={clipsHref(props.pathname, { view: "shelf", shelf, sort: "newest" })}
      view={viewOf(data.phase, data.items)}
      onRetry={data.retry}
      now={props.now}
      showAge
      allUnread={shelf.kind === "unread"}
      noDots={shelf.kind === "recent"}
    />
  );
}

/** The Unverified rows, on Home and on its shelf page. */
export function UnverifiedRows({
  items,
  now,
  remove,
  setSaving,
}: {
  items: readonly FileItem[];
  now: Date;
  remove: (id: string) => void;
  setSaving: (id: string, on: boolean) => void;
}) {
  const meta = useClipMeta(
    items.map((item) => item.id),
    { dots: false },
  );
  const { statusOf, verify } = useVerify(remove, setSaving);
  return (
    <ul>
      {items.map((file) => (
        <li key={file.id}>
          <ClipRow
            file={file}
            cover={meta.coverOf(file.id)}
            now={now}
            status={statusOf(file.id)}
            onVerify={() => verify(file.id)}
          />
        </li>
      ))}
    </ul>
  );
}

function UnverifiedShelf(props: HomeProps) {
  const t = useTranslations("knowledge.clips");
  const data = useShelfData({
    drive: props.drive,
    target: props.target,
    shelf: { kind: "unverified" },
    sort: "newest",
    size: UNVERIFIED_ROWS,
    paged: false,
    profileKey: props.nickname ?? "",
    refresh: props.refresh,
    onViewerRequired: props.onViewerRequired,
  });
  if (data.phase === "ready" && data.items.length === 0) return null;
  const href = clipsHref(props.pathname, { view: "shelf", shelf: { kind: "unverified" }, sort: "newest" });
  return (
    <section className="min-w-0">
      <ShelfHeading title={t("shelf.unverified")} seeAllHref={data.phase === "failed" ? undefined : href} />
      {data.phase === "failed" ? (
        <LoadFailed onRetry={data.retry} />
      ) : data.phase === "loading" ? (
        <div aria-hidden="true" data-testid="clip-skeleton" className="flex flex-col">
          {Array.from({ length: UNVERIFIED_ROWS }, (_, i) => (
            <div key={i} className="h-[75px] animate-pulse border-b border-bg-border py-2.5">
              <div className="h-full w-[72px] rounded-lg bg-bg-elevated" />
            </div>
          ))}
        </div>
      ) : (
        <UnverifiedRows items={data.items} now={props.now} remove={data.remove} setSaving={data.setSaving} />
      )}
    </section>
  );
}

export default function Home(props: HomeProps) {
  const t = useTranslations("knowledge.clips");
  const { withProfile, target } = props;
  const targetHasClips = target !== null;
  return (
    <div className="flex flex-col gap-12">
      {targetHasClips &&
        (withProfile ? (
          <CardShelf key="unread" {...props} shelf={{ kind: "unread" }} title={t("shelf.unread")} withCount />
        ) : (
          <CardShelf key="new" {...props} shelf={{ kind: "new" }} title={t("shelf.newClips")} withCount={false} />
        ))}
      {withProfile && (
        <CardShelf key="recent" {...props} shelf={{ kind: "recent" }} title={t("shelf.recentlyOpened")} withCount={false} />
      )}
      {targetHasClips && <UnverifiedShelf {...props} />}
    </div>
  );
}
