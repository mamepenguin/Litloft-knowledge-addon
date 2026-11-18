"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Quote } from "lucide-react";

import { getThumbnailUrl } from "@/lib/api";
import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";

import { formatNoteTime } from "../noteDates";
import { excerptFromText } from "../noteExcerpt";
import { SectionHeading } from "../NotesLanding";
import { notesWithOpenings, useNoteOpenings } from "../useNoteOpenings";
import { formatLocator } from "./locator";
import { SkeletonRows } from "./Skeleton";
import { sourceIcon } from "./sourceKind";
import { useNotesWithSources, type SourcedNote } from "./useNotesWithSources";
import type { NotesTarget } from "./useNotesTarget";

function SourcedRow({
  note,
  now,
  opening,
  badge,
}: {
  note: SourcedNote;
  now: Date;
  opening: string | undefined;
  badge: string | null;
}) {
  const t = useTranslations("knowledge.notesApp");
  const locale = useLocale();
  const { file, source } = note;
  const title = file.title || file.filename;
  const excerpt = opening ? excerptFromText(opening, title).replace(/\s+/g, " ") : "";
  const folder = source.folder_path || t("rootFolder");
  const Icon = sourceIcon(source.mime_type);

  return (
    <Link
      href={buildCanonicalFileUrl(file, file.id)}
      className="flex items-start gap-3.5 rounded-xl px-1 py-3 transition-colors hover:bg-bg-elevated sm:px-3"
    >
      <span className="relative h-[54px] w-24 shrink-0 overflow-hidden rounded-lg bg-bg-elevated">
        {source.has_thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- the thumbnail is a core API route
          <img
            src={getThumbnailUrl(source.source_file_id)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <span aria-hidden="true" className="flex size-full items-center justify-center text-text-muted">
            <Icon size={20} strokeWidth={1.8} />
          </span>
        )}
        {badge !== null && (
          <span
            data-testid="locator-badge"
            className="absolute bottom-1 right-1 rounded-md bg-black/70 px-1.5 py-px text-[10px] tabular-nums text-white"
          >
            {badge}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold leading-[1.45] text-text-primary">{title}</span>
        {excerpt && (
          <span data-testid="note-excerpt" className="mt-0.5 truncate text-[13px] leading-[1.55] text-text-muted">
            {excerpt}
          </span>
        )}
        <span data-testid="source-line" className="mt-1.5 truncate text-xs text-text-muted">
          {badge === null ? folder : `${folder} · ${badge}`}
        </span>
      </span>
      <span className="hidden w-16 shrink-0 self-center text-right text-xs tabular-nums text-text-muted sm:block">
        {formatNoteTime(file.updated_at, now, locale)}
      </span>
    </Link>
  );
}

/** Notes that cite a video position or a document page, drawn with the source's thumbnail. */
export default function NotesWithSourcesSection({
  drive,
  target,
  now,
}: {
  drive: string;
  target: NotesTarget;
  now: Date;
}) {
  const t = useTranslations("knowledge.notesApp");
  const state = useNotesWithSources(drive, target);
  const notes = state.status === "loaded" ? state.data : [];
  const openings = useNoteOpenings(drive, notes.map((note) => note.file.id));
  const drawn = notes.filter((note) => notesWithOpenings([note.file], openings).length > 0);

  if (state.status === "failed") return null;
  if (state.status === "loaded" && notes.length === 0) return null;

  return (
    <section>
      <SectionHeading icon={<Quote size={18} strokeWidth={1.8} aria-hidden="true" />}>
        {t("withSources")}
      </SectionHeading>
      {drawn.length === 0 ? (
        <SkeletonRows count={Math.max(notes.length, 3)} rowClass="h-[78px]" />
      ) : (
        <ul role="list" className="flex flex-col">
          {drawn.map((note) => (
            <li key={note.file.id}>
              <SourcedRow
                note={note}
                now={now}
                opening={openings.text[note.file.id]}
                badge={formatLocator(note.source.locator, (n) => t("badgePage", { n }))}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
