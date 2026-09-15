"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileText, Folder, Tag as TagIcon } from "lucide-react";

import type { FolderCount, Tag } from "@/types";

import { allNotesHref, type AllNotesScope } from "./allNotesParams";

export function FolderLabel({ path, rootLabel }: { path: string; rootLabel: string }) {
  if (path === "") return <>{rootLabel}</>;
  const slash = path.lastIndexOf("/");
  if (slash < 0) return <>{path}</>;
  return (
    <>
      <span className="text-warm-silver">{path.slice(0, slash)} / </span>
      {path.slice(slash + 1)}
    </>
  );
}

/** Gives up the parent path before the folder's own name when the rail is narrow. */
function RailFolderLabel({ path, rootLabel }: { path: string; rootLabel: string }) {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return <span className="truncate">{path === "" ? rootLabel : path}</span>;
  return (
    <span className="flex min-w-0">
      <span className="min-w-0 truncate text-warm-silver">
        {path.slice(0, slash)}
        <span className="whitespace-pre"> / </span>
      </span>
      <span className="max-w-full shrink-0 truncate">{path.slice(slash + 1)}</span>
    </span>
  );
}

function RailLink({
  href,
  selected,
  icon,
  label,
  count,
  title,
}: {
  href: string;
  selected: boolean;
  icon: ReactNode;
  label: ReactNode;
  count: number;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      aria-current={selected ? "true" : undefined}
      className={`flex min-w-0 items-center gap-2.5 rounded-2xl px-3 py-1.5 text-sm transition-colors pointer-coarse:min-h-11 ${
        selected
          ? "bg-bg-elevated font-semibold text-text-primary"
          : "text-text-primary hover:bg-bg-elevated"
      }`}
    >
      <span aria-hidden="true" className={`shrink-0 ${selected ? "text-text-primary" : "text-text-muted"}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs font-normal tabular-nums text-text-muted">{count}</span>
    </Link>
  );
}

interface Props {
  pathname: string;
  scope: AllNotesScope;
  folders: FolderCount[];
  tags: Tag[];
}

export default function AllNotesRail({ pathname, scope, folders, tags }: Props) {
  const t = useTranslations("knowledge.notes");
  const total = folders.reduce((sum, f) => sum + f.count, 0);
  const at = (next: Partial<AllNotesScope>) => allNotesHref(pathname, { ...scope, ...next });

  return (
    <nav aria-label={t("filtersLabel")} className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="px-3 pb-1 text-xs font-semibold text-text-muted">{t("foldersHeading")}</h2>
        <RailLink
          href={at({ folder: null })}
          selected={scope.folder === null}
          icon={<FileText size={16} strokeWidth={1.8} />}
          label={t("everyFolder")}
          count={total}
        />
        {folders.map((f) => (
          <RailLink
            key={f.path}
            href={at({ folder: f.path })}
            selected={scope.folder === f.path}
            icon={<Folder size={16} strokeWidth={1.8} />}
            label={<RailFolderLabel path={f.path} rootLabel={t("rootFolder")} />}
            title={f.path === "" ? undefined : f.path}
            count={f.count}
          />
        ))}
      </div>
      {tags.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <h2 className="px-3 pb-1 text-xs font-semibold text-text-muted">{t("tagsHeading")}</h2>
          {tags.map((tag) => (
            <RailLink
              key={tag.name}
              href={at({ tag: scope.tag === tag.name ? null : tag.name })}
              selected={scope.tag === tag.name}
              icon={<TagIcon size={16} strokeWidth={1.8} />}
              label={tag.name}
              count={tag.count}
            />
          ))}
        </div>
      )}
    </nav>
  );
}
