"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { FileText, Search } from "lucide-react";
import {
  searchVault,
  type CoreFileItem,
  type SearchHit,
  type Vault,
} from "./api";

const RECENT_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 120;

interface RecentEntry {
  fileId: string;
  filename: string;
  title: string;
  drive: string;
  folderPath: string;
  openedAt: number;
}

function recentKey(vaultId: number): string {
  return `knowledge:recentFiles:${vaultId}`;
}

function loadRecents(vaultId: number): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(recentKey(vaultId));
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveRecents(vaultId: number, recents: RecentEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      recentKey(vaultId),
      JSON.stringify(recents.slice(0, RECENT_LIMIT)),
    );
  } catch {
    // ignore quota / disabled storage
  }
}

export function recordRecent(vaultId: number, file: CoreFileItem): void {
  const existing = loadRecents(vaultId);
  const filtered = existing.filter((e) => e.fileId !== file.id);
  const next: RecentEntry[] = [
    {
      fileId: file.id,
      filename: file.filename,
      title: file.title,
      drive: file.drive,
      folderPath: file.folder_path,
      openedAt: Date.now(),
    },
    ...filtered,
  ];
  saveRecents(vaultId, next);
}

interface SwitcherItem {
  fileId: string;
  filename: string;
  title: string;
  source: "recent" | "search";
}

function recentToItem(r: RecentEntry): SwitcherItem {
  return {
    fileId: r.fileId,
    filename: r.filename,
    title: r.title,
    source: "recent",
  };
}

function hitToItem(h: SearchHit): SwitcherItem {
  return {
    fileId: h.file_id,
    filename: h.filename,
    title: h.title,
    source: "search",
  };
}

interface Props {
  drive: string;
  vault: Vault;
  open: boolean;
  onClose: () => void;
  onSelect: (file: CoreFileItem) => void;
}

export default function QuickSwitcher({
  drive,
  vault,
  open,
  onClose,
  onSelect,
}: Props) {
  const t = useTranslations("knowledge.quickSwitcher");

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SwitcherItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recents = useMemo(() => loadRecents(vault.id), [vault.id, open]);

  // Reset state when (re)opening
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    setItems(recents.map(recentToItem));
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [open, recents]);

  // Run server search on query change
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim() === "") {
      setItems(recents.map(recentToItem));
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchVault(drive, vault.id, query.trim());
        setItems(res.results.map(hitToItem));
        setSelectedIndex(0);
      } catch {
        setItems([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, drive, vault.id, open, recents]);

  // Scroll selected item into view (guarded — jsdom lacks scrollIntoView)
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const node = list.children[selectedIndex] as HTMLElement | undefined;
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const choose = useCallback(
    async (item: SwitcherItem) => {
      try {
        const res = await fetch(`/api/files/${encodeURIComponent(item.fileId)}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const file = (await res.json()) as CoreFileItem;
        recordRecent(vault.id, file);
        onSelect(file);
      } catch {
        // ignore — user can retry
      }
    },
    [vault.id, onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item) void choose(item);
        return;
      }
    },
    [items, selectedIndex, onClose, choose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center pt-[15vh]">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="relative z-10 mx-4 w-full max-w-lg overflow-hidden rounded-2xl bg-bg-card shadow-2xl animate-fade-in-scale"
        role="dialog"
        aria-modal
        aria-label={t("title")}
      >
        <div className="flex items-center gap-2 border-b border-bg-border px-4 py-3">
          <Search size={16} className="text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          {searching && (
            <span className="text-xs text-text-muted">{t("searching")}</span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="p-6 text-center text-sm text-text-muted">
            {query.trim() === "" ? t("emptyRecents") : t("noMatches")}
          </p>
        ) : (
          <ul
            ref={listRef}
            className="max-h-[50vh] overflow-y-auto py-1"
            role="listbox"
          >
            {items.map((item, idx) => (
              <li
                key={item.fileId}
                role="option"
                aria-selected={idx === selectedIndex}
                className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${
                  idx === selectedIndex
                    ? "bg-bg-elevated text-text-primary"
                    : "text-text-primary hover:bg-bg-elevated"
                }`}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => void choose(item)}
              >
                <FileText size={14} className="shrink-0 text-text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{item.title || item.filename}</div>
                  {item.title && item.title !== item.filename && (
                    <div className="truncate text-xs text-text-muted">
                      {item.filename}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
