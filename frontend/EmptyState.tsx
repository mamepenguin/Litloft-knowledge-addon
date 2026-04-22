"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, FileText } from "lucide-react";
import {
  listVaultFiles,
  type CoreFileItem,
  type Vault,
} from "./api";

interface Props {
  drive: string;
  vault: Vault;
  reloadKey?: number;
  onSelectFile: (f: CoreFileItem) => void;
}

interface FilesState {
  items: CoreFileItem[];
  total: number;
}

function formatTimestamp(iso: string, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function EmptyState({
  drive,
  vault,
  reloadKey = 0,
  onSelectFile,
}: Props) {
  const t = useTranslations("knowledge.empty");
  const [state, setState] = useState<FilesState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listVaultFiles(drive, vault.path);
        if (cancelled) return;
        const sorted = [...res.data].sort((a, b) => {
          const at = a.updated_at || a.created_at || "";
          const bt = b.updated_at || b.created_at || "";
          return bt.localeCompare(at);
        });
        setState({ items: sorted.slice(0, 5), total: res.meta.total });
      } catch {
        if (!cancelled) setState({ items: [], total: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drive, vault.path, reloadKey]);

  const locale =
    typeof navigator !== "undefined" ? navigator.language : "en-US";
  const statsLabel =
    state === null
      ? ""
      : state.total === 0
        ? t("statsEmpty")
        : t("statsNotes", { count: state.total });

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-10 px-6 py-12 md:py-20">
        <header className="flex flex-col gap-5">
          <div className="flex items-center gap-3 text-[11px] font-semibold uppercase text-text-muted">
            <span>{t("eyebrow")}</span>
            <span className="h-px flex-1 bg-bg-border" aria-hidden />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-bg-border bg-bg-card px-2.5 py-1 text-[11px] font-medium normal-case text-text-primary">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
              {vault.label}
            </span>
          </div>
          <h1 className="text-[2rem] font-semibold leading-[1.2] text-text-primary md:text-[2.4rem]">
            {t("title")}
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-text-muted">
            {t("description")}
          </p>
          {statsLabel && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="inline-block h-1 w-1 rounded-full bg-warm-silver" />
              <span>{statsLabel}</span>
            </div>
          )}
        </header>

        <section
          aria-labelledby="knowledge-empty-recent"
          className="flex flex-col gap-3"
        >
          <div className="flex items-baseline justify-between">
            <h2
              id="knowledge-empty-recent"
              className="text-[11px] font-semibold uppercase text-text-muted"
            >
              {t("recentHeading")}
            </h2>
          </div>
          <div className="flex flex-col">
            {state === null ? (
              <RecentSkeleton />
            ) : state.items.length === 0 ? (
              <p className="py-4 text-sm text-text-muted">{t("recentEmpty")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-bg-border">
                {state.items.map((f, idx) => {
                  const stamp = formatTimestamp(
                    f.updated_at || f.created_at,
                    locale,
                  );
                  const index = String(idx + 1).padStart(2, "0");
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => onSelectFile(f)}
                        className="group flex w-full items-center gap-4 py-3 text-left"
                      >
                        <span className="w-6 font-mono text-[11px] text-warm-silver">
                          {index}
                        </span>
                        <FileText
                          size={14}
                          className="flex-shrink-0 text-text-muted group-hover:text-accent"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary group-hover:text-accent">
                          {f.title || f.filename.replace(/\.md$/i, "")}
                        </span>
                        {stamp && (
                          <time className="hidden text-[11px] text-text-muted md:inline">
                            {stamp}
                          </time>
                        )}
                        <ArrowRight
                          size={14}
                          className="flex-shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-bg-border pt-5 text-[11px] text-text-muted">
          <ShortcutHint keys={["/"]} label={t("shortcutSearch")} />
        </footer>
      </div>
    </div>
  );
}

function ShortcutHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1">
        {keys.map((k, i) => (
          <kbd
            key={i}
            className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md border border-bg-border bg-bg-card px-1.5 font-mono text-[10px] font-medium text-text-primary"
          >
            {k}
          </kbd>
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}

function RecentSkeleton() {
  return (
    <ul className="flex flex-col divide-y divide-bg-border" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-4 py-3">
          <span className="h-3 w-4 rounded bg-bg-elevated" />
          <span className="h-3 flex-1 rounded bg-bg-elevated" />
        </li>
      ))}
    </ul>
  );
}
