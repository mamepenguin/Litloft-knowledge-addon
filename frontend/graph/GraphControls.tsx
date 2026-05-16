"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Crosshair, Search } from "lucide-react";
import type { ColorBy } from "./graphPalette";

const COLOR_BY_OPTIONS: ColorBy[] = ["kind", "tag", "folder", "flat"];

type T = ReturnType<typeof useTranslations>;

export function GraphToolbar({
  searchQuery,
  onSearchChange,
  colorBy,
  onColorByChange,
  t,
}: {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  colorBy: ColorBy;
  onColorByChange: (v: ColorBy) => void;
  t: T;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[180px] flex-1 md:max-w-[280px]">
        <Search
          size={11}
          strokeWidth={1.8}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-2xl border border-bg-border bg-bg-card py-1.5 pl-7 pr-3 text-xs text-text-primary placeholder:text-text-dim focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring"
        />
      </div>
      <span className="text-[10px] uppercase tracking-wide text-text-dim">
        {t("colorByLabel")}
      </span>
      <div className="inline-flex gap-0.5 rounded-2xl border border-bg-border bg-bg-card p-0.5">
        {COLOR_BY_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onColorByChange(opt)}
            className={`rounded-xl px-2.5 py-1 text-[11px] transition-colors ${
              colorBy === opt
                ? "bg-bg-elevated text-text-primary"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {t(`colorBy.${opt}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GraphFocusBanner({
  title,
  depth,
  onDepthChange,
  onReset,
  t,
}: {
  title: string;
  depth: number;
  onDepthChange: (n: number) => void;
  onReset: () => void;
  t: T;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-accent-blue/30 bg-accent-blue/10 px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5">
        <Crosshair size={12} strokeWidth={1.8} className="text-accent-blue" />
        {t("focus.label")}:
      </span>
      <span className="font-semibold text-accent-blue">{title}</span>
      <span className="ml-auto flex items-center gap-2 text-text-muted">
        <span>{t("focus.depthLabel")}</span>
        <input
          type="range"
          min={1}
          max={3}
          value={depth}
          onChange={(e) => onDepthChange(Number(e.target.value))}
          className="w-20"
          style={{ accentColor: "var(--accent-blue, #60a5fa)" }}
        />
        <span className="tabular-nums">{depth}</span>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-bg-border px-2 py-0.5 text-[11px] text-text-muted hover:text-text-primary"
        >
          {t("focus.reset")}
        </button>
      </span>
    </div>
  );
}

export function ZoomButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-bg-border bg-bg-elevated text-text-primary transition-colors hover:bg-bg-border"
    >
      {children}
    </button>
  );
}
