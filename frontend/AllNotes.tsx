"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowUpDown, Folder, Search, Tag as TagIcon, X } from "lucide-react";

import { Button } from "@/components/Button";
import { MenuRadioGroup, ToolbarMenu } from "@/components/ToolbarMenu";
import { getDriveFiles, getDriveTags, getFolderCounts } from "@/lib/api";
import type { FileItem, FolderCount, Tag } from "@/types";

import AllNotesRail, { FolderLabel } from "./AllNotesRail";
import { ALL_NOTES_SORTS, SORT_REQUEST, allNotesHref, type AllNotesScope } from "./allNotesParams";
import { groupNotesByAge } from "./noteDates";
import { NoteRows } from "./NoteRow";

const PAGE_SIZE = 30;

function ScopeSearch({ scope, pathname }: { scope: AllNotesScope; pathname: string }) {
  const t = useTranslations("knowledge.notes");
  const router = useRouter();
  const [query, setQuery] = useState(scope.query);

  useEffect(() => {
    setQuery(scope.query);
  }, [scope.query]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    router.push(allNotesHref(pathname, { ...scope, query: query.trim() }));
  };

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className="flex h-10 min-w-0 basis-full items-center gap-2.5 rounded-2xl border border-warm-silver/40 bg-bg-card px-3.5 focus-within:border-focus-ring focus-within:ring-1 focus-within:ring-focus-ring md:flex-1 md:basis-auto pointer-coarse:h-11"
    >
      <Search size={16} strokeWidth={1.8} className="shrink-0 text-text-muted" aria-hidden="true" />
      <input
        type="search"
        maxLength={200}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("findInScopePlaceholder")}
        aria-label={t("findInScopeLabel")}
        className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-warm-silver focus:outline-none"
      />
    </form>
  );
}

/** Remounted (by key) whenever the drive or the scope changes. */
function AllNotesList({
  drive,
  scope,
  now,
  heading,
}: {
  drive: string;
  scope: AllNotesScope;
  now: Date;
  heading: ReactNode[];
}) {
  const t = useTranslations("knowledge.notes");
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
        ...SORT_REQUEST[scope.sort],
        ...(scope.folder !== null ? { path: scope.folder } : {}),
        ...(scope.tag ? { tag: scope.tag } : {}),
        ...(scope.query ? { search: scope.query } : {}),
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
  }, [drive, scope, nextPage]);

  useEffect(() => {
    if (drive) void loadNext();
    // The first page only; later pages are asked for by the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const more = total === null ? failed : files.length < total;
  const showTags = scope.folder !== null;
  const query = scope.query || undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 sm:px-3">
        {heading.length > 0 && (
          <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-lg font-bold text-text-primary">
            {heading}
          </h2>
        )}
        <span className="text-sm text-text-muted" aria-live="polite">
          {total !== null && t("count", { count: total })}
        </span>
      </div>
      {total === 0 && <p className="text-sm text-text-muted sm:px-3">{t("noResults")}</p>}
      {scope.sort === "updated" ? (
        <div className="flex flex-col gap-4">
          {groupNotesByAge(files, now).map(({ group, files: grouped }) => (
            <div key={group}>
              <h3 className="px-1 pb-1 text-xs font-semibold text-text-muted sm:px-3">{t(`age.${group}`)}</h3>
              <NoteRows files={grouped} now={now} query={query} showTags={showTags} />
            </div>
          ))}
        </div>
      ) : (
        <NoteRows files={files} now={now} query={query} showTags={showTags} />
      )}
      {failed && <p role="alert" className="text-xs text-danger">{t("loadFailed")}</p>}
      {more && (
        <Button variant="secondary" className="self-center" disabled={loading} onClick={() => void loadNext()}>
          {t("showMore")}
        </Button>
      )}
    </div>
  );
}

export default function AllNotes({ drive, scope, now }: { drive: string; scope: AllNotesScope; now: Date }) {
  const t = useTranslations("knowledge.notes");
  const pathname = usePathname();
  const router = useRouter();
  const [folders, setFolders] = useState<FolderCount[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    setFolders([]);
    if (!drive) return;
    let cancelled = false;
    getFolderCounts(drive, "text")
      .then((rows) => {
        if (!cancelled) setFolders(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [drive]);

  // Counted within the chosen folder, so a count is what choosing the tag shows.
  useEffect(() => {
    setTags([]);
    if (!drive) return;
    let cancelled = false;
    getDriveTags(drive, null, "text", scope.folder)
      .then((rows) => {
        if (!cancelled) setTags(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [drive, scope.folder]);


  const go = (next: Partial<AllNotesScope>) => router.push(allNotesHref(pathname, { ...scope, ...next }));
  const sortLabel = (sort: AllNotesScope["sort"]) => t(`sort.${sort}`);
  const folderValue =
    scope.folder === null ? t("everyFolder") : scope.folder === "" ? t("rootFolder") : scope.folder;
  const heading = [
    scope.folder !== null ? (
      <FolderLabel key="folder" path={scope.folder} rootLabel={t("rootFolder")} />
    ) : null,
    scope.tag ? (
      <Link
        key="tag"
        href={allNotesHref(pathname, { ...scope, tag: null })}
        aria-label={t("removeTag", { tag: scope.tag })}
        className="inline-flex items-center gap-1 rounded-full bg-accent-teal/15 py-0.5 pl-2.5 pr-1.5 text-sm font-medium text-accent-teal transition-colors hover:bg-accent-teal/25 pointer-coarse:min-h-11"
      >
        #{scope.tag}
        <X size={14} aria-hidden="true" />
      </Link>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="flex items-start gap-8">
      <div className="hidden w-[15.5rem] shrink-0 md:block">
        <AllNotesRail pathname={pathname} scope={scope} folders={folders} tags={tags} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ScopeSearch scope={scope} pathname={pathname} />
          <ToolbarMenu label={t("folderMenu")} value={folderValue} icon={Folder} align="start" className="md:hidden">
            {(close) => (
              <MenuRadioGroup
                heading={t("foldersHeading")}
                options={[{ value: null as string | null, label: t("everyFolder") }, ...folders.map((f) => ({
                  value: f.path as string | null,
                  label: f.path === "" ? t("rootFolder") : f.path,
                }))]}
                isSelected={(value) => value === scope.folder}
                onSelect={(value) => {
                  close();
                  go({ folder: value });
                }}
              />
            )}
          </ToolbarMenu>
          {tags.length > 0 && (
            <ToolbarMenu
              label={t("tagMenu")}
              value={scope.tag ? `#${scope.tag}` : t("anyTag")}
              icon={TagIcon}
              align="start"
              className="md:hidden"
            >
              {(close) => (
                <MenuRadioGroup
                  heading={t("tagsHeading")}
                  options={[{ value: null as string | null, label: t("anyTag") }, ...tags.map((tag) => ({
                    value: tag.name as string | null,
                    label: `#${tag.name}`,
                  }))]}
                  isSelected={(value) => value === scope.tag}
                  onSelect={(value) => {
                    close();
                    go({ tag: value });
                  }}
                />
              )}
            </ToolbarMenu>
          )}
          <ToolbarMenu label={t("sortMenu")} value={sortLabel(scope.sort)} icon={ArrowUpDown}>
            {(close) => (
              <MenuRadioGroup
                heading={t("sortMenu")}
                options={ALL_NOTES_SORTS.map((sort) => ({ value: sort, label: sortLabel(sort) }))}
                isSelected={(value) => value === scope.sort}
                onSelect={(value) => {
                  close();
                  go({ sort: value });
                }}
              />
            )}
          </ToolbarMenu>
        </div>
        <AllNotesList
          key={`${drive}:${allNotesHref("", scope)}`}
          drive={drive}
          scope={scope}
          now={now}
          heading={heading}
        />
      </div>
    </div>
  );
}
