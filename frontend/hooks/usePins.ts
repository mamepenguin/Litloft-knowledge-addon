"use client";

import { useCallback, useState } from "react";
import type { CoreFileItem } from "../api";

export interface PinnedNote {
  id: string;
  filename: string;
  title: string;
  vaultId: number;
}

function storageKey(vaultId: number): string {
  return `knowledge:pins:${vaultId}`;
}

function collapsedKey(vaultId: number): string {
  return `knowledge:pins:collapsed:${vaultId}`;
}

function loadPins(vaultId: number): PinnedNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(vaultId));
    if (!raw) return [];
    return JSON.parse(raw) as PinnedNote[];
  } catch {
    return [];
  }
}

function savePins(vaultId: number, pins: PinnedNote[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(vaultId), JSON.stringify(pins));
  } catch {
    // ignore quota / disabled storage
  }
}

export function loadPinsCollapsed(vaultId: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(collapsedKey(vaultId)) === "1";
  } catch {
    return false;
  }
}

export function savePinsCollapsed(vaultId: number, collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (collapsed) window.localStorage.setItem(collapsedKey(vaultId), "1");
    else window.localStorage.removeItem(collapsedKey(vaultId));
  } catch {
    // ignore quota / disabled storage
  }
}

export function usePins(vaultId: number) {
  const [pins, setPins] = useState<PinnedNote[]>(() => loadPins(vaultId));

  const pin = useCallback(
    (file: CoreFileItem) => {
      setPins((prev) => {
        if (prev.some((p) => p.id === file.id)) return prev;
        const next: PinnedNote[] = [
          { id: file.id, filename: file.filename, title: file.title, vaultId },
          ...prev,
        ];
        savePins(vaultId, next);
        return next;
      });
    },
    [vaultId],
  );

  const unpin = useCallback(
    (fileId: string) => {
      setPins((prev) => {
        const next = prev.filter((p) => p.id !== fileId);
        savePins(vaultId, next);
        return next;
      });
    },
    [vaultId],
  );

  const isPinned = useCallback(
    (fileId: string): boolean => {
      return pins.some((p) => p.id === fileId);
    },
    [pins],
  );

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      setPins((prev) => {
        if (fromIndex === toIndex) return prev;
        const next = [...prev];
        const [item] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, item);
        savePins(vaultId, next);
        return next;
      });
    },
    [vaultId],
  );

  const updatePinTitle = useCallback(
    (fileId: string, newFilename: string, newTitle: string) => {
      setPins((prev) => {
        const next = prev.map((p) =>
          p.id === fileId ? { ...p, filename: newFilename, title: newTitle } : p,
        );
        savePins(vaultId, next);
        return next;
      });
    },
    [vaultId],
  );

  return { pins, pin, unpin, isPinned, reorder, updatePinTitle };
}
