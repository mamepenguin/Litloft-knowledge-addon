"use client";

import { useEffect, useRef, useState } from "react";

import type { FileItem } from "@/types";

import { fetchNoteOpenings } from "./api";

export interface NoteOpenings {
  /** The opening text of the notes whose answer is in. */
  text: Record<string, string>;
  /** The notes whose opening is known, one way or the other. */
  answered: ReadonlySet<string>;
}

const NONE: NoteOpenings = { text: {}, answered: new Set() };

/**
 * The opening text of the notes in a listing, asked for in one request.
 *
 * A row is drawn once its own opening is known, so a row never grows and a
 * page appended to the listing leaves the rows already on screen alone.
 * Each id is asked about once. A failed request counts as answered: those
 * rows appear without their opening lines rather than waiting for a retry.
 */
/** The notes a listing may draw: the ones whose opening is in hand. */
export function notesWithOpenings(
  files: readonly FileItem[],
  openings: NoteOpenings,
): FileItem[] {
  return files.filter((file) => openings.answered.has(file.id));
}

export function useNoteOpenings(drive: string, fileIds: string[]): NoteOpenings {
  const [state, setState] = useState<NoteOpenings>(NONE);
  // A ref, not state: marking ids as asked must not re-run the effect that
  // is asking about them, which is what would cancel its own request.
  const asked = useRef<Set<string>>(new Set());
  const askedDrive = useRef(drive);
  const onScreen = useRef(true);

  useEffect(() => {
    onScreen.current = true;
    return () => {
      onScreen.current = false;
    };
  }, []);

  if (askedDrive.current !== drive) {
    askedDrive.current = drive;
    asked.current = new Set();
    if (state !== NONE) setState(NONE);
  }

  const key = fileIds.filter((id) => !asked.current.has(id)).join(",");

  useEffect(() => {
    if (key === "") return;
    const ids = key.split(",").filter((id) => !asked.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) asked.current.add(id);

    const settle = (text: Record<string, string>) => {
      if (!onScreen.current || askedDrive.current !== drive) return;
      setState((prev) => ({
        text: { ...prev.text, ...text },
        answered: new Set([...prev.answered, ...ids]),
      }));
    };
    fetchNoteOpenings(drive, ids)
      .then(settle)
      .catch(() => settle({}));
  }, [drive, key]);

  return state;
}
