"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpDown,
  FileText,
  Folder,
  Plus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createTextFile,
  listVaultFiles,
  listVaultFolders,
  type CoreFileItem,
  type CoreFolderItem,
  type Vault,
} from "./api";
import { sortFiles, useSortMode, type SortMode } from "./hooks/useSortMode";

function untitledFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `untitled-${stamp}.md`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

interface Props {
  drive: string;
  vault: Vault;
  path: string;
  name: string;
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
  onBack: () => void;
  onSelectFile: (f: CoreFileItem) => void;
  onSelectFolder: (path: string, name: string) => void;
  onReload: () => void;
}

export default function FolderView({
  drive,
  vault,
  path,
  name,
  onBack,
  onSelectFile,
  onSelectFolder,
  onReload,
}: Props) {
  const t = useTranslations("knowledge.folderView");
  const tFile = useTranslations("knowledge.fileList");

  const { sortMode, cycleSortMode } = useSortMode(vault.id);

  const [files, setFiles] = useState<CoreFileItem[]>([]);
  const [folders, setFolders] = useState<CoreFolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [filesResult, foldersResult] = await Promise.all([
          listVaultFiles(drive, path),
          listVaultFolders(drive, path),
        ]);
        if (!cancelled) {
          setFiles(filesResult.data);
          setFolders(foldersResult);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [drive, path]);

  const sortedFiles = useMemo(() => sortFiles(files, sortMode), [files, sortMode]);
  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name)),
    [folders],
  );

  async function handleCreateNote() {
    if (creating) return;
    const filename = untitledFilename();
    const rel = path ? `${path}/${filename}` : filename;
    setCreating(true);
    try {
      const created = await createTextFile(drive, { path: rel, content: "" });
      onReload();
      onSelectFile(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function sortLabel(mode: SortMode): string {
    if (mode === "updated_desc") return t("sortUpdated");
    if (mode === "created_desc") return t("sortCreated");
    return t("sortName");
  }

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-bg-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("back")}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-text-primary"
        >
          <ArrowLeft size={16} />
        </button>
        <Folder size={16} className="flex-shrink-0 text-accent" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
          {name || path || "/"}
        </h1>
        <button
          type="button"
          onClick={cycleSortMode}
          title={sortLabel(sortMode)}
          aria-label={sortLabel(sortMode)}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-primary"
        >
          <ArrowUpDown size={12} />
          <span className="hidden sm:inline">{sortLabel(sortMode)}</span>
        </button>
        <button
          type="button"
          onClick={handleCreateNote}
          disabled={creating}
          className="flex items-center gap-1.5 rounded-md bg-accent/15 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
        >
          <Plus size={12} />
          {t("newNote")}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="py-12 text-center text-sm text-text-muted">
            {tFile("loading")}
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        ) : sortedFolders.length === 0 && sortedFiles.length === 0 ? (
          <div className="py-12 text-center text-sm text-text-muted">
            {t("emptyFolder")}
          </div>
        ) : (
          <>
            {sortedFolders.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {t("subfolders")}
                </h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {sortedFolders.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => onSelectFolder(f.path, f.name)}
                      className="flex items-center gap-2 rounded-lg border border-bg-border bg-bg-card p-3 text-left transition-colors hover:border-accent/30 hover:bg-bg-elevated"
                    >
                      <Folder size={16} className="flex-shrink-0 text-accent/80" />
                      <span className="truncate text-sm font-medium text-text-primary">
                        {f.name}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {sortedFiles.length > 0 && (
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {t("notes")}
                </h2>
                <ul className="flex flex-col gap-1">
                  {sortedFiles.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => onSelectFile(f)}
                        className="flex w-full items-center gap-3 rounded-lg border border-bg-border bg-bg-card px-3 py-2.5 text-left transition-colors hover:border-accent/30 hover:bg-bg-elevated"
                      >
                        <FileText size={14} className="flex-shrink-0 text-text-muted" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                          {f.title || f.filename.replace(/\.md$/i, "")}
                        </span>
                        <span className="flex-shrink-0 text-xs text-text-muted">
                          {formatDate(f.updated_at || f.created_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
