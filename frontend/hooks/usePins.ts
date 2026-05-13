"use client";

import { useCallback, useState } from "react";
import type { CoreFileItem } from "../api";

export interface PinnedNote {
  id: string;
  filename: string;
  title: string;
  drive: string;
}

function storageKey(drive: string): string {
  return `knowledge:pins:${drive}`;
}

function collapsedKey(drive: string): string {
  return `knowledge:pins:collapsed:${drive}`;
}

function loadPins(drive: string): PinnedNote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(drive));
    if (!raw) return [];
    return JSON.parse(raw) as PinnedNote[];
  } catch {
    return [];
  }
}

function savePins(drive: string, pins: PinnedNote[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(drive), JSON.stringify(pins));
  } catch {
    // ignore quota / disabled storage
  }
}

export function loadPinsCollapsed(drive: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(collapsedKey(drive)) === "1";
  } catch {
    return false;
  }
}

export function savePinsCollapsed(drive: string, collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (collapsed) window.localStorage.setItem(collapsedKey(drive), "1");
    else window.localStorage.removeItem(collapsedKey(drive));
  } catch {
    // ignore quota / disabled storage
  }
}

export function usePins(drive: string) {
  const [pins, setPins] = useState<PinnedNote[]>(() => loadPins(drive));

  const pin = useCallback(
    (file: CoreFileItem) => {
      setPins((prev) => {
        if (prev.some((p) => p.id === file.id)) return prev;
        const next: PinnedNote[] = [
          { id: file.id, filename: file.filename, title: file.title, drive },
          ...prev,
        ];
        savePins(drive, next);
        return next;
      });
    },
    [drive],
  );

  const unpin = useCallback(
    (fileId: string) => {
      setPins((prev) => {
        const next = prev.filter((p) => p.id !== fileId);
        savePins(drive, next);
        return next;
      });
    },
    [drive],
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
        savePins(drive, next);
        return next;
      });
    },
    [drive],
  );

  const updatePinTitle = useCallback(
    (fileId: string, newFilename: string, newTitle: string) => {
      setPins((prev) => {
        const next = prev.map((p) =>
          p.id === fileId ? { ...p, filename: newFilename, title: newTitle } : p,
        );
        savePins(drive, next);
        return next;
      });
    },
    [drive],
  );

  return { pins, pin, unpin, isPinned, reorder, updatePinTitle };
}
