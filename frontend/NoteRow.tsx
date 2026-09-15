"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { FileText, Folder } from "lucide-react";

import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import type { FileItem } from "@/types";

import { formatNoteTime } from "./noteDates";
import { useNoteExcerpt } from "./useNoteExcerpt";

// Lowercasing can lengthen a character (İ becomes i + a combining dot), so
// offsets found in the lowercased text are mapped back to the original. The
// text is lowercased whole, as the query is, because some casing depends on
// context (a word-final Σ becomes ς); only the lengths are taken per character.
function lowercaseWithOffsets(text: string): { lower: string; starts: number[]; ends: number[] } {
  const lower = text.toLowerCase();
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const char of text) {
    for (let i = 0; i < char.toLowerCase().length; i++) {
      starts.push(offset);
      ends.push(offset + char.length);
    }
    offset += char.length;
  }
  return { lower, starts, ends };
}

export function markMatches(text: string, query: string | undefined): ReactNode {
  const needle = query?.trim();
  if (!needle) return text;
  const { lower, starts, ends } = lowercaseWithOffsets(text);
  const target = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(target);
  while (at >= 0) {
    const start = Math.max(starts[at], from);
    const end = ends[at + target.length - 1];
    if (end > start) {
      if (start > from) parts.push(text.slice(from, start));
      parts.push(
        <mark key={start} className="rounded-sm bg-highlight-bg text-inherit">
          {text.slice(start, end)}
        </mark>,
      );
      from = end;
    }
    at = lower.indexOf(target, at + target.length);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)}</>;
}

interface Props {
  file: FileItem;
  now: Date;
  query?: string;
  /** In place of the folder, for a list already narrowed to one folder. */
  showTags?: boolean;
}

function TagChips({ tags }: { tags: string[] }) {
  return (
    <>
      {tags.map((tag) => (
        <span key={tag} className="shrink-0 rounded-full bg-accent-teal/15 px-2 py-0.5 text-xs text-accent-teal">
          {tag}
        </span>
      ))}
    </>
  );
}

export default function NoteRow({ file, now, query, showTags = false }: Props) {
  const t = useTranslations("knowledge.notes");
  const locale = useLocale();
  const title = file.title || file.filename;
  const excerpt = useNoteExcerpt(file.id, title);
  const folder = file.folder_path || t("rootFolder");
  const time = formatNoteTime(file.updated_at, now, locale);

  return (
    <Link
      href={buildCanonicalFileUrl(file, file.id)}
      className="group flex items-start gap-3.5 rounded-xl px-1 py-3 transition-colors hover:bg-bg-elevated sm:px-3"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-bg-elevated text-text-muted group-hover:bg-bg-card"
      >
        <FileText size={18} strokeWidth={1.8} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold leading-[1.45] text-text-primary">
          {markMatches(title, query)}
        </span>
        {excerpt && (
          <span data-testid="note-excerpt" className="mt-0.5 truncate text-[13px] leading-[1.55] text-text-muted">
            {excerpt.replace(/\s+/g, " ")}
          </span>
        )}
        <span className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-text-muted sm:hidden">
          {showTags ? (
            file.tags.length > 0 && (
              <>
                <TagChips tags={file.tags} />
                <span aria-hidden="true" className="opacity-40">·</span>
              </>
            )
          ) : (
            <>
              <Folder size={12} strokeWidth={1.8} className="shrink-0 text-warm-silver" aria-hidden="true" />
              <span className="truncate">{markMatches(folder, query)}</span>
              <span aria-hidden="true" className="opacity-40">·</span>
            </>
          )}
          <span className="shrink-0 tabular-nums">{time}</span>
        </span>
      </span>
      <span className="hidden w-44 shrink-0 items-center gap-1.5 self-center overflow-hidden text-xs text-text-muted sm:flex">
        {showTags ? (
          <TagChips tags={file.tags} />
        ) : (
          <>
            <Folder size={13} strokeWidth={1.8} className="shrink-0 text-warm-silver" aria-hidden="true" />
            <span className="truncate">{markMatches(folder, query)}</span>
          </>
        )}
      </span>
      <span className="hidden w-16 shrink-0 self-center text-right text-xs tabular-nums text-text-muted sm:block">
        {time}
      </span>
    </Link>
  );
}

export function NoteRows({
  files,
  now,
  query,
  showTags,
}: {
  files: FileItem[];
  now: Date;
  query?: string;
  showTags?: boolean;
}) {
  return (
    <ul role="list" className="flex flex-col">
      {files.map((file, i) => (
        <li key={file.id}>
          {i > 0 && <div aria-hidden="true" className="ml-[3.375rem] h-px bg-bg-border sm:ml-[3.875rem] sm:mr-3" />}
          <NoteRow file={file} now={now} query={query} showTags={showTags} />
        </li>
      ))}
    </ul>
  );
}
