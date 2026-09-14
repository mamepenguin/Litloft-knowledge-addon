"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/Button";
import { getDriveFiles } from "@/lib/api";
import type { FileItem } from "@/types";

import NoteList from "./NoteList";

const PAGE_SIZE = 30;

interface Props {
  drive: string;
  /** Absent for All notes. */
  query?: string;
}

/** Remounted (by key) whenever the drive or the query changes. */
export default function NoteResults({ drive, query }: Props) {
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
      <Link href={pathname} className="self-start text-xs text-text-muted hover:text-text-primary">
        {t("back")}
      </Link>
      <h2 className="text-sm font-semibold text-text-primary">
        {query ? t("resultsFor", { query }) : t("all")}
      </h2>
      {total !== null && <p className="text-xs text-text-muted">{t("count", { count: total })}</p>}
      {total === 0 && <p className="text-sm text-text-muted">{query ? t("noResults") : t("empty")}</p>}
      <NoteList files={files} />
      {failed && <p role="alert" className="text-xs text-danger">{t("loadFailed")}</p>}
      {more && (
        <Button variant="secondary" className="self-start" disabled={loading} onClick={() => void loadNext()}>
          {t("showMore")}
        </Button>
      )}
    </section>
  );
}
