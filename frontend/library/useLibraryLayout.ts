"use client";

import { useEffect, useState } from "react";

/** Three panes from here up. */
export const THREE_PANE_MIN = 1280;
/** The pane is drawn from here up. */
export const PANE_MIN = 1024;

export type LibraryLayout = "three" | "menu" | "list";

export function layoutForWidth(width: number): LibraryLayout {
  if (width >= THREE_PANE_MIN) return "three";
  if (width >= PANE_MIN) return "menu";
  return "list";
}

/**
 * `null` until the width is measured: nothing that depends on the pane (the
 * pane itself, the view record, a `note` in the URL) happens before then, so a
 * phone never does any of it for a first frame.
 */
export function useLibraryLayout(): LibraryLayout | null {
  const [layout, setLayout] = useState<LibraryLayout | null>(null);
  useEffect(() => {
    const measure = () => setLayout(layoutForWidth(window.innerWidth));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return layout;
}
