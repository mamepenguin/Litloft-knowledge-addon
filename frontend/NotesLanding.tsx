"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Clock, PenLine, Search, X } from "lucide-react";

import { useProfile } from "@/components/ProfileProvider";
import { SectionRow } from "@/components/SectionRow";
import { getDriveFiles, getWatchHistory } from "@/lib/api";
import type { FileItem } from "@/types";

import ContinueCard from "./ContinueCard";
import { useNoteOpenings } from "./useNoteOpenings";
import { groupNotesByAge } from "./noteDates";
import { NoteRows } from "./NoteRow";

const CONTINUE_LIMIT = 3;
const RECENT_LIMIT = 8;

export function SectionHeading({
  icon,
  children,
  action,
}: {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-bold text-text-primary">
        {icon}
        {children}
      </h2>
      {action}
    </div>
  );
}

export function FindNote({ initialQuery = "" }: { initialQuery?: string }) {
  const t = useTranslations("knowledge.notes");
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`${pathname}?${new URLSearchParams({ q })}`);
  };

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className="flex h-12 items-center gap-2.5 rounded-2xl border border-warm-silver/40 bg-bg-card px-4 focus-within:border-focus-ring focus-within:ring-1 focus-within:ring-focus-ring"
    >
      <Search size={18} strokeWidth={1.8} className="shrink-0 text-text-muted" aria-hidden="true" />
      <input
        type="search"
        maxLength={200}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("findPlaceholder")}
        aria-label={t("findLabel")}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-text-primary placeholder:text-warm-silver focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {initialQuery && (
        <Link
          href={pathname}
          aria-label={t("clearFind")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-elevated text-text-muted hover:text-text-primary pointer-coarse:size-11"
        >
          <X size={14} strokeWidth={2} />
        </Link>
      )}
    </form>
  );
}

export function ContinueWriting({ drive, now }: { drive: string; now: Date }) {
  const t = useTranslations("knowledge.notes");
  const { nickname } = useProfile();
  const [rows, setRows] = useState<FileItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setRows(null);
    setFailed(false);
    if (!nickname || !drive) return;
    let cancelled = false;
    getWatchHistory(drive, CONTINUE_LIMIT, "all", "text")
      .then((items) => {
        if (!cancelled) setRows(items);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [drive, nickname]);

  const openings = useNoteOpenings(drive, rows?.map((f) => f.id) ?? null);

  if (!nickname) return null;
  if (!failed && (rows === null || rows.length === 0 || openings === null)) return null;

  return (
    <section>
      <SectionHeading icon={<PenLine size={18} strokeWidth={1.8} aria-hidden="true" />}>
        {t("continueWriting")}
      </SectionHeading>
      {failed ? (
        <p role="alert" className="text-xs text-danger">{t("loadFailed")}</p>
      ) : (
        <SectionRow>
          {(rows ?? []).map((file) => (
            <ContinueCard
              key={file.id}
              file={file}
              now={now}
              opening={openings?.[file.id]}
            />
          ))}
        </SectionRow>
      )}
    </section>
  );
}

export function RecentNotes({
  drive,
  now,
  onTotal,
}: {
  drive: string;
  now: Date;
  onTotal?: (total: number | null) => void;
}) {
  const t = useTranslations("knowledge.notes");
  const pathname = usePathname();
  const [page, setPage] = useState<{ files: FileItem[]; total: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setPage(null);
    setFailed(false);
    if (!drive) return;
    let cancelled = false;
    getDriveFiles(drive, { type: "text", sort: "updated_at", order: "desc", limit: RECENT_LIMIT })
      .then((res) => {
        if (cancelled) return;
        setPage({ files: res.data, total: res.meta.total });
        onTotal?.(res.meta.total);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      });
    return () => {
      cancelled = true;
      onTotal?.(null);
    };
  }, [drive]);

  const openings = useNoteOpenings(drive, page?.files.map((f) => f.id) ?? null);
  const rowsReady = page !== null && openings !== null;

  const allLink =
    page && page.total > 0 ? (
      <Link
        href={`${pathname}?${new URLSearchParams({ view: "all" })}`}
        className="flex items-center gap-0.5 text-sm text-text-muted transition-colors hover:text-accent"
      >
        {t("allLink", { count: page.total })}
        <ChevronRight size={16} aria-hidden="true" />
      </Link>
    ) : undefined;

  return (
    <section>
      <SectionHeading icon={<Clock size={18} strokeWidth={1.8} aria-hidden="true" />} action={allLink}>
        {t("recent")}
      </SectionHeading>
      {failed && <p role="alert" className="text-xs text-danger">{t("loadFailed")}</p>}
      {page && page.total === 0 && <p className="text-sm text-text-muted">{t("empty")}</p>}
      {rowsReady && page.total > 0 && (
        <div className="flex flex-col gap-4">
          {groupNotesByAge(page.files, now).map(({ group, files }) => (
            <div key={group}>
              <h3 className="px-1 pb-1 text-xs font-semibold text-text-muted sm:px-3">{t(`age.${group}`)}</h3>
              <NoteRows files={files} now={now} openings={openings} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
