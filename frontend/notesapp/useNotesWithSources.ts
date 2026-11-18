"use client";

import { useMemo } from "react";

import { useLoad, type LoadState } from "@/components/appshell/useLoad";
import type { FileItem } from "@/types";

import { listNotes } from "./listing";
import { getNotesWithSources, getNoteSources, type NoteSource } from "./sourcesApi";
import type { NotesTarget } from "./useNotesTarget";

export interface SourcedNote {
  file: FileItem;
  /** The note's first source. */
  source: NoteSource;
}

export const WALK_PAGE_SIZE = 60;
export const WALK_MAX_PAGES = 3;
export const WALK_MAX_CANDIDATES = 5;

/**
 * The target's newest notes that cite a source, in walk order. The walk stops
 * after three pages or five candidates, whichever comes first.
 */
export function useNotesWithSources(drive: string, target: NotesTarget): LoadState<SourcedNote[]> {
  const load = useMemo(() => {
    if (target.status !== "ready") return null;
    return async (): Promise<SourcedNote[]> => {
      const withSources = new Set(await getNotesWithSources(drive));
      if (withSources.size === 0) return [];

      const candidates: FileItem[] = [];
      for (let page = 1; page <= WALK_MAX_PAGES && candidates.length < WALK_MAX_CANDIDATES; page++) {
        const answer = await listNotes(drive, target, {
          sort: "updated_at",
          order: "desc",
          page,
          limit: WALK_PAGE_SIZE,
        });
        for (const file of answer.data) {
          if (candidates.length === WALK_MAX_CANDIDATES) break;
          if (withSources.has(file.id)) candidates.push(file);
        }
        if (answer.data.length < WALK_PAGE_SIZE || page * WALK_PAGE_SIZE >= answer.meta.total) break;
      }
      if (candidates.length === 0) return [];

      const sources = await getNoteSources(
        drive,
        candidates.map((file) => file.id),
      );
      return candidates.flatMap((file) => {
        const source = sources[file.id]?.[0];
        return source ? [{ file, source }] : [];
      });
    };
  }, [drive, target]);
  return useLoad(load).state;
}
