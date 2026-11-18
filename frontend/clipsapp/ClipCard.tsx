"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { splitFilename } from "@/lib/filename";
import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import type { FileItem } from "@/types";

import type { ClipCover } from "../api";
import { formatNoteTime } from "../noteDates";

/** About 500 Japanese characters or 250 English words; one rate serves both. */
const BYTES_PER_MINUTE = 1500;

export function readingMinutes(fileSize: number): number {
  return Math.max(1, Math.round(fileSize / BYTES_PER_MINUTE));
}

export function clipTitle(file: Pick<FileItem, "title" | "filename">): string {
  return file.title || splitFilename(file.filename).stem;
}

export function coverSrc(cover: ClipCover | undefined): { src: string; external: boolean } | null {
  if (!cover) return null;
  if (cover.image_id) return { src: `/api/files/${cover.image_id}/thumbnail`, external: false };
  if (cover.image_url) return { src: cover.image_url, external: true };
  return null;
}

/** The cover box: always there at 4:3, so a picture arriving moves nothing. */
export function Cover({
  cover,
  className,
  children,
}: {
  cover: ClipCover | undefined;
  className: string;
  children?: React.ReactNode;
}) {
  const picture = coverSrc(cover);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className={`relative overflow-hidden bg-bg-elevated ${className}`}>
      {picture !== null && failed !== picture.src && (
        // eslint-disable-next-line @next/next/no-img-element -- the cover is any site's image
        <img
          src={picture.src}
          alt=""
          loading={picture.external ? "lazy" : undefined}
          referrerPolicy={picture.external ? "no-referrer" : undefined}
          onError={() => setFailed(picture.src)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {children}
    </div>
  );
}

export function useMetaLine() {
  const t = useTranslations("knowledge.clips");
  const locale = useLocale();
  return (file: FileItem, site: string | null | undefined, now: Date, parts: { minutes: boolean; age: boolean }) =>
    [
      site,
      parts.minutes ? t("minutes", { count: readingMinutes(file.file_size) }) : null,
      parts.age ? formatNoteTime(file.created_at, now, locale) : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
}

export interface ClipCardProps {
  file: FileItem;
  cover: ClipCover | undefined;
  dot: boolean;
  now: Date;
  /** The Library draws "site · N min"; Home and a shelf page add the age. */
  showAge: boolean;
}

export default function ClipCard({ file, cover, dot, now, showAge }: ClipCardProps) {
  const t = useTranslations("knowledge.clips");
  const metaLine = useMetaLine();
  return (
    <Link
      href={buildCanonicalFileUrl(file, file.id)}
      className="group relative block min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      <Cover cover={cover} className="aspect-[4/3] rounded-xl">
        {dot && (
          <span
            aria-hidden="true"
            data-testid="unread-dot"
            className="absolute left-2.5 top-2.5 size-2.5 rounded-full bg-accent ring-2 ring-bg-primary"
          />
        )}
      </Cover>
      {dot && <span className="sr-only">{t("unreadLabel")}</span>}
      <p className="mt-2.5 line-clamp-2 min-h-[2.9em] text-[15px] font-semibold leading-[1.45] text-text-primary group-hover:text-accent">
        {clipTitle(file)}
      </p>
      <p className="mt-1 min-h-4 truncate text-xs text-text-muted">
        {metaLine(file, cover?.site, now, { minutes: true, age: showAge })}
      </p>
    </Link>
  );
}
