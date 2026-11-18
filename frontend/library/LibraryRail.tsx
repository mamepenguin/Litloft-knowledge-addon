"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Folder, Layers, Tag as TagIcon } from "lucide-react";

import { MenuRadioGroup, ToolbarMenu } from "@/components/ToolbarMenu";

import type { Segment, Selection } from "./libraryUrl";
import type { RailItem } from "./railModel";

export interface LibraryRailProps {
  segment: Segment;
  items: RailItem[];
  /** The rail's own request is out and nothing is drawn from it yet. */
  loading: boolean;
  /** A request failed; "Try again" is drawn after the entries. */
  failed: boolean;
  onSegment: (segment: Segment) => void;
  onSelect: (selection: Selection) => void;
  onRetry: () => void;
}

function useRailLabel(segment: Segment) {
  const t = useTranslations("knowledge.notesLibrary");
  return (item: RailItem): string => {
    if (item.kind === "all") return t("all");
    if (segment === "tag") return item.key ?? "";
    if (item.key === "") return t("rootFolder");
    return (item.key ?? "").split("/").join(" / ");
  };
}

function selectionOf(segment: Segment, item: RailItem): Selection {
  if (item.kind === "all") return { kind: "all" };
  return segment === "tag" ? { kind: "tag", name: item.key ?? "" } : { kind: "folder", path: item.key ?? "" };
}

function SegmentSwitch({ segment, onSegment }: { segment: Segment; onSegment: (s: Segment) => void }) {
  const t = useTranslations("knowledge.notesLibrary");
  const option = (value: Segment, label: string) => (
    <button
      type="button"
      aria-pressed={segment === value}
      onClick={() => onSegment(value)}
      className={`h-[30px] flex-1 rounded-lg text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring pointer-coarse:min-h-11 ${
        segment === value
          ? "bg-bg-card font-semibold text-text-primary shadow-sm"
          : "text-text-muted hover:text-text-primary"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label={t("segmentLabel")} className="mb-3 flex rounded-[10px] bg-bg-elevated p-[3px]">
      {option("folder", t("folders"))}
      {option("tag", t("tags"))}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true" data-testid="rail-skeleton" className="flex flex-col gap-0.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[34px] animate-pulse rounded-[10px] bg-bg-elevated" />
      ))}
    </div>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("knowledge.notesLibrary");
  return (
    <button
      type="button"
      onClick={onRetry}
      className="mt-2 self-start rounded-2xl border border-bg-border px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring pointer-coarse:min-h-11"
    >
      {t("retry")}
    </button>
  );
}

export function LibraryRail(props: LibraryRailProps) {
  const { segment, items } = props;
  const t = useTranslations("knowledge.notesLibrary");
  const labelOf = useRailLabel(segment);
  const Icon = segment === "tag" ? TagIcon : Folder;
  return (
    <nav aria-label={t("railLabel")} className="flex flex-col">
      <SegmentSwitch segment={segment} onSegment={props.onSegment} />
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={item.key ?? "\u0000all"}>
            <button
              type="button"
              aria-current={item.selected ? "true" : undefined}
              title={labelOf(item)}
              onClick={() => props.onSelect(selectionOf(segment, item))}
              className={`flex h-[34px] w-full min-w-0 items-center gap-2.5 rounded-[10px] px-2.5 text-left text-sm text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring pointer-coarse:min-h-11 ${
                item.selected ? "bg-bg-elevated font-semibold" : "hover:bg-bg-elevated"
              }`}
            >
              {item.kind === "all" ? (
                <Layers size={14} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-warm-silver" />
              ) : (
                <Icon size={14} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-warm-silver" />
              )}
              <span className="min-w-0 flex-1 truncate">{labelOf(item)}</span>
              {item.count !== null && (
                <span className="shrink-0 text-xs tabular-nums text-text-muted">{item.count}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {props.loading && <Skeleton />}
      {props.failed && <RetryButton onRetry={props.onRetry} />}
    </nav>
  );
}

/** From 1024 to 1279px: the same switch and entries behind one button. */
export function LibraryRailMenu(props: LibraryRailProps): ReactNode {
  const t = useTranslations("knowledge.notesLibrary");
  const { segment, items } = props;
  const labelOf = useRailLabel(segment);
  const selected = items.find((item) => item.selected) ?? items[0];
  const value = t(segment === "tag" ? "railMenuTags" : "railMenuFolders", { name: labelOf(selected) });
  return (
    <ToolbarMenu label={value} value={value} icon={segment === "tag" ? TagIcon : Folder} align="start" truncateValue>
      {(close) => (
        <>
          <MenuRadioGroup
            heading={t("segmentLabel")}
            options={[
              { value: "folder" as Segment, label: t("folders") },
              { value: "tag" as Segment, label: t("tags") },
            ]}
            isSelected={(value) => value === segment}
            onSelect={(value) => {
              close();
              props.onSegment(value);
            }}
          />
          <MenuRadioGroup
            heading={t(segment === "tag" ? "tags" : "folders")}
            options={items.map((item) => ({
              value: item,
              label: labelOf(item),
              ...(item.count !== null ? { detail: String(item.count) } : {}),
            }))}
            isSelected={(item) => item.selected}
            onSelect={(item) => {
              close();
              props.onSelect(selectionOf(segment, item));
            }}
          />
          {props.loading && <Skeleton />}
          {props.failed && (
            <div className="px-3 py-2">
              <RetryButton onRetry={props.onRetry} />
            </div>
          )}
        </>
      )}
    </ToolbarMenu>
  );
}
