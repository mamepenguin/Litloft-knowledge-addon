"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  FileText,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  activateVault,
  createTextFile,
  listVaultFiles,
  searchVault,
  type CoreFileItem,
  type SearchHit,
  type Vault,
} from "./api";

interface Props {
  vaults: Vault[];
  active: Vault;
  selectedFileId: string | null;
  onSwitchVault: (v: Vault) => void;
  onAddVault: () => void;
  onSelectFile: (f: CoreFileItem) => void;
}

export default function Sidebar({
  vaults,
  active,
  selectedFileId,
  onSwitchVault,
  onAddVault,
  onSelectFile,
}: Props) {
  const t = useTranslations("knowledge");
  const tFile = useTranslations("knowledge.fileList");
  const tSearch = useTranslations("knowledge.search");

  const [files, setFiles] = useState<CoreFileItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const newNameRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    setFiles(null);
    setListError(null);
    try {
      const res = await listVaultFiles(active.drive, active.path);
      setFiles(res.data);
    } catch (e) {
      setListError((e as Error).message);
    }
  }, [active.drive, active.path]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await searchVault(active.id, q);
        setHits(res.results);
        setSearchTruncated(res.truncated);
      } catch {
        setHits([]);
        setSearchTruncated(false);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, active.id]);

  useEffect(() => {
    if (newName !== null) {
      newNameRef.current?.focus();
    }
  }, [newName]);

  async function handleCreate(name: string) {
    if (creating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNewName(null);
      return;
    }
    const clean = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
    const rel = active.path ? `${active.path}/${clean}` : clean;
    setCreating(true);
    try {
      const created = await createTextFile(active.drive, {
        path: rel,
        content: "",
      });
      setNewName(null);
      await reload();
      onSelectFile(created);
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const showSearch = query.trim().length > 0;

  return (
    <aside className="flex h-full w-72 flex-col border-r border-bg-border bg-bg-card">
      <VaultHeader
        vaults={vaults}
        active={active}
        onSwitch={onSwitchVault}
        onAddNew={onAddVault}
      />

      <div className="border-b border-bg-border px-3 py-2">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tSearch("placeholder")}
            aria-label={tSearch("placeholder")}
            className="w-full rounded-md border border-bg-border bg-bg-primary py-1.5 pl-8 pr-8 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={tSearch("clear")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-bg-elevated hover:text-text-primary"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showSearch ? (
          <SearchResults
            searching={searching}
            hits={hits}
            truncated={searchTruncated}
            onPick={(hit) =>
              onSelectFile({
                id: hit.file_id,
                filename: hit.filename,
                title: hit.title,
                drive: active.drive,
                folder_path: active.path,
                file_type: "document",
                mime_type: "text/markdown",
                thumbnail_url: "",
                file_size: 0,
                created_at: "",
                updated_at: "",
              })
            }
            selectedFileId={selectedFileId}
          />
        ) : (
          <FileListPane
            files={files}
            error={listError}
            selectedFileId={selectedFileId}
            onSelect={onSelectFile}
            pendingNew={newName}
            onPendingChange={setNewName}
            onCreate={handleCreate}
            creating={creating}
            inputRef={newNameRef}
          />
        )}
      </div>

      {!showSearch && (
        <div className="border-t border-bg-border p-2">
          <button
            type="button"
            onClick={() => setNewName("")}
            disabled={creating || newName !== null}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-text-primary hover:bg-bg-elevated disabled:opacity-50"
          >
            <Plus size={16} className="text-accent" />
            {tFile("newFile")}
          </button>
        </div>
      )}
    </aside>
  );
}

function VaultHeader({
  vaults,
  active,
  onSwitch,
  onAddNew,
}: {
  vaults: Vault[];
  active: Vault;
  onSwitch: (v: Vault) => void;
  onAddNew: () => void;
}) {
  const t = useTranslations("knowledge.switcher");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function handlePick(v: Vault) {
    setOpen(false);
    if (v.id === active.id) return;
    const updated = await activateVault(v.id);
    onSwitch(updated);
  }

  return (
    <div ref={ref} className="relative border-b border-bg-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-3 text-left hover:bg-bg-elevated"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
          <span className="text-sm font-semibold">
            {active.label.slice(0, 1).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text-primary">
            {active.label}
          </div>
          <div className="truncate text-xs text-text-muted">
            {active.drive}
            {active.path ? ` / ${active.path}` : ""}
          </div>
        </div>
        <ChevronsUpDown size={14} className="flex-shrink-0 text-text-muted" />
      </button>
      {open && (
        <div className="absolute left-2 right-2 top-full z-20 mt-1 overflow-hidden rounded-lg border border-bg-border bg-bg-elevated shadow-xl animate-fade-in-scale">
          <ul className="max-h-72 overflow-y-auto py-1">
            {vaults.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => handlePick(v)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-bg-primary/60"
                >
                  <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {v.id === active.id && (
                      <Check size={14} className="text-accent" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {v.label}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {v.drive}
                      {v.path ? ` / ${v.path}` : ""}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onAddNew();
            }}
            className="flex w-full items-center gap-2 border-t border-bg-border px-3 py-2 text-sm font-medium text-accent hover:bg-bg-primary/60"
          >
            <Plus size={14} />
            {t("addNew")}
          </button>
        </div>
      )}
    </div>
  );
}

function FileListPane({
  files,
  error,
  selectedFileId,
  onSelect,
  pendingNew,
  onPendingChange,
  onCreate,
  creating,
  inputRef,
}: {
  files: CoreFileItem[] | null;
  error: string | null;
  selectedFileId: string | null;
  onSelect: (f: CoreFileItem) => void;
  pendingNew: string | null;
  onPendingChange: (v: string | null) => void;
  onCreate: (name: string) => void;
  creating: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const tFile = useTranslations("knowledge.fileList");
  const sorted = useMemo(() => {
    if (!files) return null;
    return [...files].sort((a, b) => {
      const at = a.updated_at || a.created_at || "";
      const bt = b.updated_at || b.created_at || "";
      return bt.localeCompare(at);
    });
  }, [files]);

  return (
    <div className="p-2">
      {error && (
        <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
          {error}
        </div>
      )}
      {pendingNew !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCreate(pendingNew);
          }}
          className="mb-1 flex items-center gap-2 rounded-md bg-bg-elevated px-2 py-1.5"
        >
          <FileText size={14} className="flex-shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={pendingNew}
            onChange={(e) => onPendingChange(e.target.value)}
            onBlur={() => {
              if (creating) return;
              if (!pendingNew.trim()) onPendingChange(null);
              else onCreate(pendingNew);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onPendingChange(null);
            }}
            disabled={creating}
            placeholder={tFile("newFilePlaceholder")}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </form>
      )}
      {sorted === null ? (
        <div className="px-3 py-6 text-center text-xs text-text-muted">
          {tFile("loading")}
        </div>
      ) : sorted.length === 0 && pendingNew === null ? (
        <div className="px-3 py-6 text-center text-xs text-text-muted">
          {tFile("empty")}
        </div>
      ) : (
        <ul className="flex flex-col">
          {sorted.map((f) => {
            const isActive = f.id === selectedFileId;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onSelect(f)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    isActive
                      ? "bg-accent/15 text-text-primary"
                      : "text-text-primary hover:bg-bg-elevated"
                  }`}
                >
                  <FileText
                    size={14}
                    className={`flex-shrink-0 ${
                      isActive ? "text-accent" : "text-text-muted"
                    }`}
                  />
                  <span className="flex-1 truncate text-sm">
                    {f.title || f.filename.replace(/\.md$/i, "")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SearchResults({
  searching,
  hits,
  truncated,
  onPick,
  selectedFileId,
}: {
  searching: boolean;
  hits: SearchHit[] | null;
  truncated: boolean;
  onPick: (h: SearchHit) => void;
  selectedFileId: string | null;
}) {
  const t = useTranslations("knowledge.search");
  if (searching && hits === null) {
    return (
      <div className="px-4 py-6 text-center text-xs text-text-muted">
        {t("searching")}
      </div>
    );
  }
  if (hits === null) return null;
  if (hits.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-text-muted">
        {t("noResults")}
      </div>
    );
  }
  return (
    <div className="p-2">
      <ul className="flex flex-col gap-0.5">
        {hits.map((hit) => {
          const isActive = hit.file_id === selectedFileId;
          return (
            <li key={hit.file_id}>
              <button
                type="button"
                onClick={() => onPick(hit)}
                className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                  isActive
                    ? "bg-accent/15"
                    : "hover:bg-bg-elevated"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <FileText
                    size={13}
                    className={
                      isActive ? "text-accent" : "text-text-muted"
                    }
                  />
                  <span className="truncate">
                    {hit.title || hit.filename}
                  </span>
                </span>
                {hit.snippet && (
                  <span className="ml-5 line-clamp-2 text-xs text-text-muted">
                    {hit.snippet}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {truncated && (
        <div className="mt-2 px-2 text-center text-[11px] text-text-muted">
          {t("truncated")}
        </div>
      )}
    </div>
  );
}
