"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { File as FileIcon } from "lucide-react";

import type { LoadState } from "@/components/appshell/useLoad";
import { getThumbnailUrl, type FileRelationItem } from "@/lib/api";
import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";

import { formatLocator } from "../../notesapp/locator";
import type { NoteSource } from "../../notesapp/sourcesApi";
import { sourceIcon } from "../../notesapp/sourceKind";

function uniqueFiles(relations: FileRelationItem[]): FileRelationItem["file"][] {
  const seen = new Set<string>();
  const files: FileRelationItem["file"][] = [];
  for (const relation of relations) {
    if (seen.has(relation.file.id)) continue;
    seen.add(relation.file.id);
    files.push(relation.file);
  }
  return files;
}

const LINK_CLASS =
  "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-text-primary transition-colors hover:bg-bg-elevated pointer-coarse:min-h-11";

function sourceHref(source: NoteSource, drive: string): string {
  const where =
    source.locator === null
      ? {}
      : "t" in source.locator
        ? { t: String(source.locator.t) }
        : { page: String(source.locator.page) };
  return buildCanonicalFileUrl({ drive, folder_path: source.folder_path }, source.source_file_id, where);
}

export function Connections({
  drive,
  relations,
  sources,
  graphHref,
}: {
  drive: string;
  relations: LoadState<FileRelationItem[]>;
  sources: LoadState<NoteSource[]>;
  graphHref: string;
}) {
  const t = useTranslations("knowledge.notesLibrary");
  const related = relations.status === "loaded" ? uniqueFiles(relations.data) : [];
  const cited = sources.status === "loaded" ? sources.data : [];
  if (related.length === 0 && cited.length === 0) return null;

  return (
    <section aria-label={t("connections")} className="mt-8 border-t border-bg-border pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-bold text-text-primary">{t("connections")}</h3>
        <Link href={graphHref} className="text-[13px] text-text-muted hover:text-text-primary">
          {t("graph")}
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        {related.length > 0 && (
          <div>
            <h4 className="mb-1 ml-2.5 text-xs font-semibold text-text-muted">
              {t("relatedFiles", { count: related.length })}
            </h4>
            <ul className="flex flex-col">
              {related.map((file) => {
                const missing = file.missing_since !== null;
                const label = file.title || file.filename;
                return (
                  <li key={file.id}>
                    {missing ? (
                      <span aria-disabled="true" className={`${LINK_CLASS} cursor-default text-text-muted hover:bg-transparent`}>
                        <FileIcon size={14} aria-hidden="true" className="shrink-0" />
                        <span className="min-w-0 truncate">{label}</span>
                      </span>
                    ) : (
                      <Link href={buildCanonicalFileUrl(file, file.id)} className={LINK_CLASS}>
                        <FileIcon size={14} aria-hidden="true" className="shrink-0 text-warm-silver" />
                        <span className="min-w-0 truncate">{label}</span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {cited.length > 0 && (
          <div>
            <h4 className="mb-1 ml-2.5 text-xs font-semibold text-text-muted">
              {t("sources", { count: cited.length })}
            </h4>
            <ul className="flex flex-col">
              {cited.map((source) => {
                const Icon = sourceIcon(source.mime_type);
                const position = formatLocator(source.locator, (n) => t("page", { count: n }));
                const folder = source.folder_path || t("rootFolder");
                return (
                  <li key={source.source_file_id}>
                    <Link href={sourceHref(source, drive)} className={LINK_CLASS}>
                      <span className="flex h-8 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-elevated text-text-muted">
                        {source.has_thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element -- the thumbnail is a core API route
                          <img src={getThumbnailUrl(source.source_file_id)} alt="" loading="lazy" className="size-full object-cover" />
                        ) : (
                          <Icon size={16} aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">{source.title || source.filename}</span>
                        <span className="block truncate text-xs text-text-muted">
                          {position === null ? folder : `${folder} · ${position}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
