"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, StickyNote } from "lucide-react";
import { useTranslations } from "next-intl";
import { MarkdownPreview } from "@/components/MarkdownPreview";

interface SummaryNote {
  file_id: string;
  drive: string;
  path: string;
  title: string;
}

interface Props {
  fileId: string;
  drive: string;
  summaryNote: SummaryNote;
}

/**
 * File-detail slot for `active-summary-view`: renders the promoted
 * knowledge note as the file's summary. Fetches the `.md` via core's
 * stream route (drive access already enforced) and hides the
 * frontmatter block via `showFrontmatter={false}`.
 *
 * Drive-scoped: the edit link points at the drive-prefixed knowledge
 * URL so the user lands in the same drive's knowledge context.
 */
export default function ActiveSummarySection({
  fileId: _fileId,
  drive,
  summaryNote,
}: Props) {
  const t = useTranslations("knowledge.activeSummary");
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    fetch(`/api/files/${encodeURIComponent(summaryNote.file_id)}/stream`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [summaryNote.file_id]);

  const editHref = `/drive/${encodeURIComponent(drive)}/addons/knowledge?edit=${encodeURIComponent(summaryNote.file_id)}`;

  return (
    <section className="rounded-xl border border-bg-border bg-bg-card p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <StickyNote size={14} className="text-accent" />
          <span>{t("title")}</span>
          <span className="rounded-lg bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
            {t("badge")}
          </span>
        </div>
        <Link
          href={editHref}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-text-muted hover:bg-bg-elevated hover:text-text-primary"
        >
          <Pencil size={12} />
          {t("openEditor")}
        </Link>
      </header>
      {content === null && error === null && (
        <p className="text-sm text-text-muted">{t("loading")}</p>
      )}
      {error !== null && (
        <p className="text-sm text-accent-amber">{t("loadFailed")}</p>
      )}
      {/* frontmatter is intentionally hidden here: the surrounding file
          detail already shows this file's metadata, so repeating
          `source_file_ids` / `origin` in a Properties panel is noise.
          Users who want to see/edit the frontmatter open the note in
          the knowledge editor via the "edit" link above. */}
      {content !== null && (
        <MarkdownPreview
          source={content}
          showFrontmatter={false}
          chrome={false}
        />
      )}
    </section>
  );
}
