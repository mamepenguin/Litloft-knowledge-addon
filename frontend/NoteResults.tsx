"use client";

import { useEffect, useState } from "react";
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

export default function NoteResults({ drive, query }: Props) {
  const t = useTranslations("knowledge.notes");
  const pathname = usePathname();
  const [pages, setPages] = useState(1);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!drive) return;
    let cancelled = false;
    setFailed(false);
    getDriveFiles(drive, {
      type: "text",
      sort: "updated_at",
      order: "desc",
      search: query,
      page: pages,
      limit: PAGE_SIZE,
    })
      .then((res) => {
        if (cancelled) return;
        setFiles((prev) => (pages === 1 ? res.data : [...prev, ...res.data]));
        setTotal(res.meta.total);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [drive, query, pages]);

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
      {total !== null && files.length < total && !failed && (
        <Button variant="secondary" className="self-start" onClick={() => setPages((p) => p + 1)}>
          {t("showMore")}
        </Button>
      )}
    </section>
  );
}
