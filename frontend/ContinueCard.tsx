"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import type { FileItem } from "@/types";

import { formatNoteTime } from "./noteDates";
import { excerptFromText } from "./noteExcerpt";

export default function ContinueCard({
  file,
  now,
  opening,
}: {
  file: FileItem;
  now: Date;
  /** The note's opening text, already in hand when the card is drawn. */
  opening?: string;
}) {
  const t = useTranslations("knowledge.notesApp");
  const locale = useLocale();
  const title = file.title || file.filename;
  const excerpt = opening ? excerptFromText(opening, title) : "";

  return (
    <Link
      href={buildCanonicalFileUrl(file, file.id)}
      className="group block overflow-hidden rounded-2xl border border-bg-border bg-bg-card shadow-card transition-colors hover:bg-bg-elevated"
    >
      <div aria-hidden="true" className="h-32 overflow-hidden bg-bg-elevated px-4 pt-4">
        <div className="h-full rounded-t-lg border border-b-0 border-bg-border bg-bg-card px-4 py-3.5">
          {excerpt && (
            <p className="line-clamp-6 whitespace-pre-line break-words text-[10.5px] leading-[1.75] text-text-muted">
              {excerpt}
            </p>
          )}
        </div>
      </div>
      <div className="p-3.5">
        <span className="line-clamp-2 text-sm font-semibold leading-[1.45] text-text-primary">{title}</span>
        <span className="mt-1 flex min-w-0 gap-1.5 text-xs text-text-muted">
          <span className="truncate">{file.folder_path || t("rootFolder")}</span>
          <span aria-hidden="true" className="opacity-40">·</span>
          <span className="shrink-0 tabular-nums">{formatNoteTime(file.updated_at, now, locale)}</span>
        </span>
      </div>
    </Link>
  );
}
