"use client";

import { useCallback, useEffect, useState } from "react";
import type { CoreFileItem, CoreFolderItem } from "../api";

export type ContextTarget =
  | { kind: "file"; item: CoreFileItem }
  | { kind: "folder"; item: CoreFolderItem };

export interface ContextMenuState {
  x: number;
  y: number;
  target: ContextTarget;
}

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const openContextMenu = useCallback(
    (e: React.MouseEvent, target: ContextTarget) => {
      e.preventDefault();
      e.stopPropagation();
      const MENU_WIDTH = 200;
      const MENU_HEIGHT = 280;
      let x = e.clientX;
      let y = e.clientY;
      if (x + MENU_WIDTH > window.innerWidth) {
        x = window.innerWidth - MENU_WIDTH - 8;
      }
      if (y + MENU_HEIGHT > window.innerHeight) {
        y = window.innerHeight - MENU_HEIGHT - 8;
      }
      setContextMenu({ x, y, target });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      // Close on any mousedown outside
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-context-menu]")) return;
      setContextMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [contextMenu]);

  return { contextMenu, openContextMenu, closeContextMenu };
}
