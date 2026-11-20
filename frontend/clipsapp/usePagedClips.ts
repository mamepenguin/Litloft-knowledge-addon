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
  /** The pages requested so far; after a removal the next request starts from this count, not the shrunken card count. */
  pages: number;
  /** A page that added nothing new ended the list, whatever the count says. */
  exhausted: boolean;
}

export interface PagedOptions<T> {
  /** What the answers belong to; `null` is "nothing to ask". A new scope starts over. */
  scope: string | null;
  fetchPage: (page: number, signal: AbortSignal) => Promise<PagedPage<T>>;
  pageSize: number;
  /** A change re-asks every page drawn (page 1 for a capped or replaced shelf) and merges them into what is drawn. */
  refresh: number;
  /** Home's shelves hold no more than this many cards. */
  cap?: number;
  /** A shelf that is one page: a refresh replaces what is drawn. */
  replaceOnRefresh?: boolean;
  /** The first page's failure, before it is drawn as one. */
  onError?: (error: unknown) => void;
  /** How many of the drawn items the menu has taken out; read when a page is asked. */
  removedBefore?: () => number;
  /** Bumps when the page's menu removes a card, so a page in flight is dropped. */
  revision?: number;
}

function empty<T>(scope: string): Held<T> {
  return { scope, items: [], count: 0, phase: "loading", more: "idle", pages: 0, exhausted: false };
}

function appendUnseen<T extends { id: string }>(drawn: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(drawn.map((item) => item.id));
  return [...drawn, ...page.filter((item) => !seen.has(item.id))];
}

/**
 * Pages of one shelf, in the order the server gave them. A failed refresh
 * (any of its pages) changes nothing.
 * `remove` takes a card out without asking again, a removed card never comes
 * back from a refresh that was already on its way, and a card being saved is
 * not pushed out by one.
 */
export function usePagedClips<T extends { id: string }>(options: PagedOptions<T>) {
  const { scope, pageSize, refresh } = options;
  const [held, setHeld] = useState<Held<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(options);
  const heldRef = useRef(held);
  useEffect(() => {
    latest.current = options;
    heldRef.current = held;
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
    const drawn = heldRef.current;
    const single = latest.current.cap !== undefined || latest.current.replaceOnRefresh;
    const pages =
      single || drawn === null || drawn.scope !== scope
        ? 1
        : Math.max(1, Math.ceil(drawn.items.length / pageSize));
    Promise.all(Array.from({ length: pages }, (_, i) => fetchPage(i + 1, controller.signal))).then(
      (answers) => {
        if (controller.signal.aborted) return;
        const page = {
          items: answers.flatMap((a) => a.items).filter((item, i, all) => all.findIndex((x) => x.id === item.id) === i),
          count: answers[0].count,
        };
        const removed = goneIds(scope);
        setHeld((prev) => {
          const base = prev !== null && prev.scope === scope ? prev : empty<T>(scope);
          const fresh = page.items.filter((item) => !removed.has(item.id));
          const { cap, replaceOnRefresh } = latest.current;
          // Several pages asked again are the whole drawn range in the server's
          // order, so a card they leave out is gone, unless it is being saved.
          const unnamed = base.items.filter(
            (item) => !fresh.some((f) => f.id === item.id) && (pages === 1 || saving.current.has(item.id)),
          );
          const merged = replaceOnRefresh ? fresh : [...fresh, ...unnamed];
          return {
            ...base,
            // A card being saved stays where it is, even past the cap.
            items:
              cap === undefined
                ? merged
                : merged.filter((item, i) => i < cap || saving.current.has(item.id)),
            count: page.count,
            phase: "ready",
            pages,
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
  }, [scope, refresh, attempt, goneIds, pageSize]);

  const own = held !== null && held.scope === scope ? held : null;

  const loadMore = useCallback(() => {
    if (scope === null || own === null) return;
    if (own.phase !== "ready" || own.more === "loading" || own.exhausted) return;
    if (own.items.length >= own.count) return;
    const reread = (latest.current.removedBefore?.() ?? 0) > 0;
    const atRevision = latest.current.revision ?? 0;
    const page = reread ? own.pages + 1 : Math.floor(own.items.length / pageSize) + 1;
    setHeld({ ...own, more: "loading" });
    const answered = reread
      ? Promise.all(
          Array.from({ length: page }, (_, i) =>
            latest.current.fetchPage(i + 1, new AbortController().signal),
          ),
        ).then((answers) => ({
          items: answers.flatMap((answer) => answer.items),
          count: answers[answers.length - 1]?.count ?? own.count,
        }))
      : latest.current.fetchPage(page, new AbortController().signal);
    answered.then(
      (res) =>
        setHeld((prev) => {
          if (prev === null || prev.scope !== scope) return prev;
          // A card left while this page was in flight, so its boundary moved.
          if ((latest.current.revision ?? 0) !== atRevision) return { ...prev, more: "idle" };
          const removed = goneIds(scope);
          const items = reread
            ? res.items.filter((item) => !removed.has(item.id))
            : appendUnseen(
                prev.items,
                res.items.filter((item) => !removed.has(item.id)),
              );
          return {
            ...prev,
            items,
            count: res.count,
            pages: page,
            more: "idle",
            exhausted: items.length === prev.items.length,
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
