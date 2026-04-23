"use client";

import { useCallback, useState } from "react";

export type SortMode = "updated_desc" | "created_desc" | "name_asc";

function sortStorageKey(vaultId: number): string {
  return `knowledge:sort:${vaultId}`;
}

function loadSortMode(vaultId: number): SortMode {
  if (typeof window === "undefined") return "updated_desc";
  try {
    const raw = window.localStorage.getItem(sortStorageKey(vaultId));
    if (raw === "updated_desc" || raw === "created_desc" || raw === "name_asc") {
      return raw;
    }
    return "updated_desc";
  } catch {
    return "updated_desc";
  }
}

function saveSortMode(vaultId: number, mode: SortMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sortStorageKey(vaultId), mode);
  } catch {
    // ignore quota / disabled storage
  }
}

export function useSortMode(vaultId: number) {
  const [sortMode, setSortMode] = useState<SortMode>(() => loadSortMode(vaultId));

  const cycleSortMode = useCallback(() => {
    setSortMode((prev) => {
      const next: SortMode =
        prev === "updated_desc"
          ? "created_desc"
          : prev === "created_desc"
            ? "name_asc"
            : "updated_desc";
      saveSortMode(vaultId, next);
      return next;
    });
  }, [vaultId]);

  return { sortMode, cycleSortMode };
}

export function sortFiles<T extends { updated_at: string; created_at: string; filename: string; title: string }>(
  files: T[],
  mode: SortMode,
): T[] {
  return [...files].sort((a, b) => {
    if (mode === "updated_desc") {
      const at = a.updated_at || a.created_at || "";
      const bt = b.updated_at || b.created_at || "";
      return bt.localeCompare(at);
    }
    if (mode === "created_desc") {
      const ac = a.created_at || "";
      const bc = b.created_at || "";
      return bc.localeCompare(ac);
    }
    // name_asc
    const an = a.title || a.filename;
    const bn = b.title || b.filename;
    return an.localeCompare(bn);
  });
}
