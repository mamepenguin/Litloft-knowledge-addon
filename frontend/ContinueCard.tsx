"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import type { FileItem } from "@/types";

import { formatNoteTime } from "./noteDates";
import { useNoteExcerpt } from "./useNoteExcerpt";

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1) : "";
}

export default function ContinueCard({ file, now }: { file: FileItem; now: Date }) {
  const t = useTranslations("knowledge.notes");
  const locale = useLocale();
  const title = file.title || file.filename;
  const excerpt = useNoteExcerpt(file.id, title);
  const extension = extensionOf(file.filename);

  return (
    <Link
      href={buildCanonicalFileUrl(file, file.id)}
      className="group block overflow-hidden rounded-2xl bg-bg-card shadow-card transition-colors hover:bg-bg-elevated"
    >
      <div aria-hidden="true" className="relative h-32 overflow-hidden bg-bg-elevated px-4 pt-4">
        <div className="h-full rounded-t-lg border border-b-0 border-bg-border bg-bg-card px-4 py-3.5">
          {excerpt && (
            <p className="line-clamp-6 whitespace-pre-line break-words text-[10.5px] leading-[1.75] text-text-muted">
              {excerpt}
            </p>
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-bg-elevated to-transparent" />
        {extension && (
          <span className="absolute bottom-2.5 right-2.5 rounded-lg bg-black/70 px-1.5 py-0.5 text-[10px] font-medium uppercase text-white">
            {extension}
          </span>
        )}
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
