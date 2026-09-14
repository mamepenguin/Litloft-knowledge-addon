"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";

import { Button } from "@/components/Button";
import { useProfile } from "@/components/ProfileProvider";
import { getDriveFiles, getWatchHistory } from "@/lib/api";
import type { FileItem } from "@/types";

import NoteList from "./NoteList";

const CONTINUE_LIMIT = 6;
const RECENT_LIMIT = 8;

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[11px] font-semibold text-text-muted">{children}</h2>;
}

export function FindNote() {
  const t = useTranslations("knowledge.notes");
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`${pathname}?${new URLSearchParams({ q })}`);
  };

  return (
    <form role="search" onSubmit={onSubmit} className="flex items-center gap-2">
      <input
        type="search"
        maxLength={200}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("findPlaceholder")}
        aria-label={t("findLabel")}
        className="flex-1 rounded-2xl border border-bg-border bg-bg-card px-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring"
      />
      <Button type="submit" variant="secondary" disabled={!query.trim()}>
        <Search size={14} strokeWidth={1.6} />
        {t("findSubmit")}
      </Button>
    </form>
  );
}

export function ContinueWriting({ drive }: { drive: string }) {
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

  if (!nickname) return null;
  if (!failed && (rows === null || rows.length === 0)) return null;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>{t("continueWriting")}</SectionHeading>
      {failed ? (
        <p role="alert" className="text-xs text-danger">{t("loadFailed")}</p>
      ) : (
        <NoteList files={rows ?? []} />
      )}
    </section>
  );
}

export function RecentNotes({ drive }: { drive: string }) {
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
        if (!cancelled) setPage({ files: res.data, total: res.meta.total });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [drive]);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>{t("recent")}</SectionHeading>
      {failed && <p role="alert" className="text-xs text-danger">{t("loadFailed")}</p>}
      {page && page.total === 0 && <p className="text-sm text-text-muted">{t("empty")}</p>}
      {page && page.total > 0 && (
        <>
          <NoteList files={page.files} />
          <Link
            href={`${pathname}?${new URLSearchParams({ view: "all" })}`}
            className="self-start text-xs font-medium text-accent hover:underline"
          >
            {t("allLink", { count: page.total })}
          </Link>
        </>
      )}
    </section>
  );
}
