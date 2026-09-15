"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/Button";
import { getDriveFiles } from "@/lib/api";
import type { FileItem } from "@/types";

import { NoteRows } from "./NoteRow";

const PAGE_SIZE = 30;

interface Props {
  drive: string;
  now: Date;
  /** Absent for All notes. */
  query?: string;
}

/** Remounted (by key) whenever the drive or the query changes. */
export default function NoteResults({ drive, now, query }: Props) {
  const t = useTranslations("knowledge.notes");
  const pathname = usePathname();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextPage, setNextPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadNext = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await getDriveFiles(drive, {
        type: "text",
        sort: "updated_at",
        order: "desc",
        search: query,
        page: nextPage,
        limit: PAGE_SIZE,
      });
      setFiles((prev) => (nextPage === 1 ? res.data : [...prev, ...res.data]));
      setTotal(res.meta.total);
      setNextPage(nextPage + 1);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [drive, query, nextPage]);

  useEffect(() => {
    if (drive) void loadNext();
    // The first page only; later pages are asked for by the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const more = total === null ? failed : files.length < total;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 sm:px-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="text-lg font-bold text-text-primary">
            {query ? t("resultsFor", { query }) : t("all")}
          </h2>
          {total !== null && <span className="text-sm text-text-muted">{t("count", { count: total })}</span>}
        </div>
        <Link
          href={pathname}
          className="flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {t("back")}
        </Link>
      </div>
      {total === 0 && <p className="text-sm text-text-muted sm:px-3">{query ? t("noResults") : t("empty")}</p>}
      <NoteRows files={files} now={now} query={query} />
      {failed && <p role="alert" className="text-xs text-danger">{t("loadFailed")}</p>}
      {more && (
        <Button variant="secondary" className="self-center" disabled={loading} onClick={() => void loadNext()}>
          {t("showMore")}
        </Button>
      )}
    </section>
  );
}
