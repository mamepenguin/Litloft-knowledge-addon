"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FileItem } from "@/types";

import { appendUnseen } from "../notePages";
import { listNotes } from "../notesapp/listing";
import type { ReadyNotesTarget } from "../notesapp/useNotesTarget";
import { SORT_REQUEST, type LibrarySort, type Selection } from "./libraryUrl";

export const LIST_PAGE_SIZE = 60;

export type ListPhase = "loading" | "ready" | "failed";

interface Held {
  scope: string;
  rows: FileItem[];
  total: number | null;
  /** The next page to ask for. */
  nextPage: number;
  phase: ListPhase;
  more: "idle" | "loading" | "failed";
}

export interface NotesListState {
  rows: FileItem[];
  /** The list's own `total`; `null` until the first page has answered. */
  total: number | null;
  phase: ListPhase;
  more: "idle" | "loading" | "failed";
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

export function listScope(
  drive: string,
  target: ReadyNotesTarget,
  selection: Selection,
  sort: LibrarySort,
  query: string,
): string {
  const picked =
    selection.kind === "folder" ? `p:${selection.path}` : selection.kind === "tag" ? `t:${selection.name}` : "all";
  return [drive, target.key, picked, sort, query].join("\u0000");
}

function unique(rows: readonly FileItem[]): FileItem[] {
  const seen = new Set<string>();
  const out: FileItem[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/**
 * The notes of one selection, a page at a time. A new scope starts empty; a
 * `refresh` or a retry keeps the rows drawn until page one answers, and a
 * failure keeps them too.
 *
 * `removedBefore` is how many drawn rows the menu has taken out. A page asked
 * after that starts past the shifted boundary, so the drawn range is read
 * again from the first page rather than asking a page number the server has
 * moved under it.
 */
export function useNotesList(
  drive: string,
  target: ReadyNotesTarget | null,
  selection: Selection,
  sort: LibrarySort,
  query: string,
  refresh: number,
  removedBefore = () => 0,
  revision = 0,
): NotesListState {
  const scope = target === null ? null : listScope(drive, target, selection, sort, query);
  const [held, setHeld] = useState<Held | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useRef({ drive, target, selection, sort, query });
  useEffect(() => {
    request.current = { drive, target, selection, sort, query };
  });
  const revisionRef = useRef(revision);
  revisionRef.current = revision;

  const fetchPage = useCallback((page: number, signal?: AbortSignal) => {
    const { drive: d, target: t, selection: s, sort: so, query: q } = request.current;
    if (t === null) return Promise.reject(new Error("no target"));
    return listNotes(
      d,
      t,
      {
        ...(s.kind === "folder" ? { path: s.path } : {}),
        ...(s.kind === "tag" ? { tag: s.name } : {}),
        ...(q ? { search: q } : {}),
        ...SORT_REQUEST[so],
        page,
        limit: LIST_PAGE_SIZE,
      },
      { signal },
    );
  }, []);

  useEffect(() => {
    if (scope === null) return;
    const controller = new AbortController();
    setHeld((prev) =>
      prev !== null && prev.scope === scope
        ? { ...prev, phase: "loading", more: "idle" }
        : { scope, rows: [], total: null, nextPage: 1, phase: "loading", more: "idle" },
    );
    fetchPage(1, controller.signal).then(
      (res) => {
        if (controller.signal.aborted) return;
        setHeld({
          scope,
          rows: unique(res.data),
          total: res.meta.total,
          nextPage: 2,
          phase: "ready",
          more: "idle",
        });
      },
      () => {
        if (controller.signal.aborted) return;
        setHeld((prev) =>
          prev !== null && prev.scope === scope
            ? { ...prev, phase: "failed" }
            : { scope, rows: [], total: null, nextPage: 1, phase: "failed", more: "idle" },
        );
      },
    );
    return () => controller.abort();
  }, [scope, refresh, attempt, fetchPage]);

  const own = held !== null && held.scope === scope ? held : null;
  const hasMore =
    own !== null &&
    own.phase === "ready" &&
    own.total !== null &&
    (own.nextPage - 1) * LIST_PAGE_SIZE < own.total;

  const loadMore = useCallback(() => {
    if (own === null || !hasMore || own.more === "loading") return;
    const page = own.nextPage;
    const asked = own.scope;
    const atRevision = revisionRef.current;
    const reread = removedBefore() > 0;
    setHeld({ ...own, more: "loading" });
    const answered = reread
      ? Promise.all(Array.from({ length: page }, (_, i) => fetchPage(i + 1)))
      : fetchPage(page).then((res) => [res]);
    answered.then(
      (answers) => {
        const rows = unique(answers.flatMap((res) => res.data));
        setHeld((now) => {
          if (now === null || now.scope !== asked) return now;
          // A card left while this page was in flight, so its boundary moved.
          if (revisionRef.current !== atRevision) return { ...now, more: "idle" };
          return {
            ...now,
            rows: reread ? rows : appendUnseen(now.rows, rows),
            total: answers[answers.length - 1]?.meta.total ?? now.total,
            nextPage: page + 1,
            more: "idle",
          };
        });
      },
      () => setHeld((now) => (now !== null && now.scope === asked ? { ...now, more: "failed" } : now)),
    );
  }, [own, hasMore, fetchPage, removedBefore]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    rows: own?.rows ?? [],
    total: own?.total ?? null,
    phase: own?.phase ?? "loading",
    more: own?.more ?? "idle",
    hasMore,
    loadMore,
    retry,
  };
}
