"use client";

import { useCallback, useEffect, useRef } from "react";

import { useLoad, type LoadState } from "@/components/appshell/useLoad";
import { getFile, getFileRelations, getStreamUrl, type FileRelationItem } from "@/lib/api";
import type { FileItem } from "@/types";

import { getNoteSources, type NoteSource } from "../../notesapp/sourcesApi";

export interface LoadedNote {
  file: FileItem;
  content: string;
}

async function loadNote(noteId: string): Promise<LoadedNote> {
  // `getFile` (not the opener's shared request): after a save this must see the write.
  const [file, content] = await Promise.all([
    getFile(noteId),
    fetch(getStreamUrl(noteId), { credentials: "include" }).then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    }),
  ]);
  return { file, content };
}

/**
 * The note's metadata and content, together: the pane draws nothing of the note
 * until both are in, and never mounts the editor before. `retry` asks again.
 */
export function useNoteData(noteId: string, revision = 0): { note: LoadState<LoadedNote>; retry: () => void } {
  const load = useCallback(() => loadNote(noteId), [noteId]);
  const { state, retry } = useLoad(load);
  const last = useRef(revision);
  useEffect(() => {
    if (last.current === revision) return;
    last.current = revision;
    retry();
  }, [revision, retry]);
  return { note: state, retry };
}

export interface Connections {
  relations: LoadState<FileRelationItem[]>;
  sources: LoadState<NoteSource[]>;
  /** Asks both again. */
  reload: () => void;
}

/** Related files and sources; each fails on its own. */
export function useConnections(drive: string, noteId: string): Connections {
  const loadRelations = useCallback(async () => (await getFileRelations(noteId)).relations, [noteId]);
  const loadSources = useCallback(
    async () => (await getNoteSources(drive, [noteId]))[noteId] ?? [],
    [drive, noteId],
  );
  const relations = useLoad(loadRelations);
  const sources = useLoad(loadSources);
  const { retry: retryRelations } = relations;
  const { retry: retrySources } = sources;
  const reload = useCallback(() => {
    retryRelations();
    retrySources();
  }, [retryRelations, retrySources]);
  return { relations: relations.state, sources: sources.state, reload };
}
