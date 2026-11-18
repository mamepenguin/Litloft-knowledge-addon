"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Shelf } from "@/lib/api";

import type { ClipSort } from "./clipsUrl";
import { loadTagShelves, type ReadyNotesTarget } from "./requests";

export type TagShelvesPhase = "loading" | "ready" | "failed";

interface Held {
  scope: string;
  shelves: Shelf[];
  total: number;
  phase: TagShelvesPhase;
  more: "idle" | "loading" | "failed";
}

function empty(scope: string): Held {
  return { scope, shelves: [], total: 0, phase: "loading", more: "idle" };
}

/**
 * By tag: the first 12 shelves, then 12 more from where the drawn ones end as
 * the viewer scrolls. A refresh replaces the first 12 and drops the rest,
 * which are asked for again when the viewer reaches them.
 */
export function useTagShelves(
  drive: string,
  target: ReadyNotesTarget,
  sort: ClipSort,
  refresh: number,
) {
  const scope = [drive, target.key, sort].join("|");
  const [held, setHeld] = useState<Held | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ target, sort });
  useEffect(() => {
    latest.current = { target, sort };
  });

  useEffect(() => {
    const controller = new AbortController();
    setHeld((prev) =>
      prev !== null && prev.scope === scope
        ? { ...prev, phase: prev.phase === "ready" ? "ready" : "loading" }
        : empty(scope),
    );
    loadTagShelves(drive, latest.current.target, 0, latest.current.sort, { signal: controller.signal }).then(
      (res) => {
        if (controller.signal.aborted) return;
        setHeld({ scope, shelves: res.shelves, total: res.total_shelves, phase: "ready", more: "idle" });
      },
      () => {
        if (controller.signal.aborted) return;
        setHeld((prev) =>
          prev !== null && prev.scope === scope && prev.phase === "ready" ? prev : { ...empty(scope), phase: "failed" },
        );
      },
    );
    return () => controller.abort();
  }, [drive, scope, refresh, attempt]);

  const own = held !== null && held.scope === scope ? held : null;

  const loadMore = useCallback(() => {
    if (own === null || own.phase !== "ready" || own.more === "loading") return;
    if (own.shelves.length >= own.total) return;
    const offset = own.shelves.length;
    setHeld({ ...own, more: "loading" });
    loadTagShelves(drive, latest.current.target, offset, latest.current.sort).then(
      (res) =>
        setHeld((prev) => {
          if (prev === null || prev.scope !== scope) return prev;
          const seen = new Set(prev.shelves.map((shelf) => shelf.key));
          return {
            ...prev,
            shelves: [...prev.shelves, ...res.shelves.filter((shelf) => !seen.has(shelf.key))],
            total: res.total_shelves,
            // An answer with nothing new ends the list, whatever the total says.
            ...(res.shelves.length === 0 ? { total: prev.shelves.length } : {}),
            more: "idle",
          };
        }),
      () => setHeld((prev) => (prev !== null && prev.scope === scope ? { ...prev, more: "failed" } : prev)),
    );
  }, [own, drive, scope]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    phase: own?.phase ?? ("loading" as TagShelvesPhase),
    shelves: own?.shelves ?? [],
    more: own?.more ?? ("idle" as const),
    hasMore: own !== null && own.shelves.length < own.total,
    loadMore,
    retry,
  };
}
