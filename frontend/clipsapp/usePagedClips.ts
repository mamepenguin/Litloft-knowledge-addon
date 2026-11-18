"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PagedPhase = "loading" | "ready" | "failed";
export type MorePhase = "idle" | "loading" | "failed";

export interface PagedPage<T> {
  items: T[];
  /** The shelf's whole size, not this page's. */
  count: number;
}

interface Held<T> {
  scope: string;
  items: T[];
  count: number;
  phase: PagedPhase;
  more: MorePhase;
  /** A page that added nothing new ended the list, whatever the count says. */
  exhausted: boolean;
}

export interface PagedOptions<T> {
  /** What the answers belong to; `null` is "nothing to ask". A new scope starts over. */
  scope: string | null;
  fetchPage: (page: number, signal: AbortSignal) => Promise<PagedPage<T>>;
  pageSize: number;
  /** A change re-asks page 1 and merges it into what is drawn. */
  refresh: number;
  /** Home's shelves hold no more than this many cards. */
  cap?: number;
  /** A shelf that is one page: a refresh replaces what is drawn. */
  replaceOnRefresh?: boolean;
  /** The first page's failure, before it is drawn as one. */
  onError?: (error: unknown) => void;
}

function empty<T>(scope: string): Held<T> {
  return { scope, items: [], count: 0, phase: "loading", more: "idle", exhausted: false };
}

function appendUnseen<T extends { id: string }>(drawn: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(drawn.map((item) => item.id));
  return [...drawn, ...page.filter((item) => !seen.has(item.id))];
}

/**
 * Pages of one shelf, in the order the server gave them. A refresh puts the
 * fresh first page in front and keeps every drawn card the page does not
 * name, so nothing already on screen leaves; a failed refresh changes nothing.
 * `remove` takes a card out without asking again, and what was removed or is
 * being saved never comes back from a refresh that was already on its way.
 */
export function usePagedClips<T extends { id: string }>(options: PagedOptions<T>) {
  const { scope, pageSize, refresh } = options;
  const [held, setHeld] = useState<Held<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const gone = useRef<{ scope: string | null; ids: Set<string> }>({ scope: null, ids: new Set() });
  const saving = useRef(new Set<string>());

  const goneIds = useCallback((forScope: string): Set<string> => {
    if (gone.current.scope !== forScope) gone.current = { scope: forScope, ids: new Set() };
    return gone.current.ids;
  }, []);

  useEffect(() => {
    if (scope === null) return;
    const controller = new AbortController();
    const { fetchPage, onError } = latest.current;
    setHeld((prev) =>
      prev !== null && prev.scope === scope
        ? { ...prev, phase: prev.phase === "ready" ? "ready" : "loading" }
        : empty<T>(scope),
    );
    fetchPage(1, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return;
        const removed = goneIds(scope);
        setHeld((prev) => {
          const base = prev !== null && prev.scope === scope ? prev : empty<T>(scope);
          const drawn = new Set(base.items.map((item) => item.id));
          const fresh = page.items.filter(
            (item) => !removed.has(item.id) && (!saving.current.has(item.id) || drawn.has(item.id)),
          );
          const { cap, replaceOnRefresh } = latest.current;
          const merged = replaceOnRefresh
            ? fresh
            : [...fresh, ...base.items.filter((item) => !fresh.some((f) => f.id === item.id))];
          return {
            ...base,
            items: cap === undefined ? merged : merged.slice(0, cap),
            count: page.count,
            phase: "ready",
            exhausted: false,
          };
        });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        onError?.(error);
        setHeld((prev) =>
          prev !== null && prev.scope === scope && prev.phase === "ready"
            ? prev
            : { ...empty<T>(scope), phase: "failed" },
        );
      },
    );
    return () => controller.abort();
  }, [scope, refresh, attempt, goneIds]);

  const own = held !== null && held.scope === scope ? held : null;

  const loadMore = useCallback(() => {
    if (scope === null || own === null) return;
    if (own.phase !== "ready" || own.more === "loading" || own.exhausted) return;
    if (own.items.length >= own.count) return;
    const page = Math.floor(own.items.length / pageSize) + 1;
    setHeld({ ...own, more: "loading" });
    latest.current.fetchPage(page, new AbortController().signal).then(
      (res) =>
        setHeld((prev) => {
          if (prev === null || prev.scope !== scope) return prev;
          const removed = goneIds(scope);
          const added = appendUnseen(
            prev.items,
            res.items.filter((item) => !removed.has(item.id)),
          );
          return {
            ...prev,
            items: added,
            count: res.count,
            more: "idle",
            exhausted: added.length === prev.items.length,
          };
        }),
      () => setHeld((prev) => (prev !== null && prev.scope === scope ? { ...prev, more: "failed" } : prev)),
    );
  }, [scope, own, pageSize, goneIds]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const remove = useCallback(
    (id: string) => {
      if (scope === null) return;
      goneIds(scope).add(id);
      setHeld((prev) =>
        prev !== null && prev.scope === scope
          ? {
              ...prev,
              items: prev.items.filter((item) => item.id !== id),
              count: Math.max(0, prev.count - 1),
            }
          : prev,
      );
    },
    [scope, goneIds],
  );

  const setSaving = useCallback((id: string, on: boolean) => {
    if (on) saving.current.add(id);
    else saving.current.delete(id);
  }, []);

  const phase: PagedPhase = own?.phase ?? "loading";
  return {
    phase,
    items: own?.items ?? [],
    count: own?.count ?? 0,
    more: own?.more ?? "idle",
    hasMore: own !== null && !own.exhausted && own.items.length < own.count,
    loadMore,
    retry,
    remove,
    setSaving,
  };
}
