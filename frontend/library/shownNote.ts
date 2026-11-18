"use client";

import { checkNote } from "../notesapp/listing";
import type { ListPhase } from "./useNotesList";
import { useScopedLoad } from "./useScopedLoad";

export type NoteCheck =
  | { status: "idle" | "loading" | "failed" }
  | { status: "loaded"; total: number };

export type ShownNote =
  /** Not known yet: nothing is shown, nothing is written to the URL. */
  | { kind: "pending" }
  | { kind: "none"; removeNote: boolean }
  | { kind: "error" }
  /** `setNote` is the id the URL's `note` must be replaced with. */
  | { kind: "show"; id: string; setNote: string | null };

/**
 * Which note the pane shows, from the URL's `note`, the rows loaded so far and
 * the answer of the check of a `note` that is not among them.
 */
export function resolveShownNote(
  noteParam: string | null,
  rowIds: readonly string[],
  listPhase: ListPhase,
  check: NoteCheck,
): ShownNote {
  const first = rowIds[0] ?? null;
  if (noteParam === null) {
    if (first !== null) return { kind: "show", id: first, setNote: null };
    return listPhase === "loading" ? { kind: "pending" } : { kind: "none", removeNote: false };
  }
  if (rowIds.includes(noteParam)) return { kind: "show", id: noteParam, setNote: null };
  if (check.status === "failed") return { kind: "error" };
  if (check.status !== "loaded") return { kind: "pending" };
  if (check.total > 0) return { kind: "show", id: noteParam, setNote: null };
  if (first !== null) return { kind: "show", id: first, setNote: first };
  return listPhase === "loading" ? { kind: "pending" } : { kind: "none", removeNote: true };
}

/**
 * The check of a `note` the loaded rows do not hold. Asked only when `ask` is
 * true, which is when the pane is drawn.
 */
export function useNoteCheck(
  drive: string,
  noteParam: string | null,
  rowIds: readonly string[],
  listPhase: ListPhase,
  ask: boolean,
): { check: NoteCheck; retry: () => void } {
  // The first page may hold the note, so nothing is asked before it answers.
  const needed =
    ask && noteParam !== null && !rowIds.includes(noteParam) && !(listPhase === "loading" && rowIds.length === 0);
  const { phase, data, retry } = useScopedLoad<number>(
    needed ? `${drive}\u0000${noteParam}` : null,
    async (signal) => (await checkNote(drive, noteParam ?? "", { signal })).meta.total,
    0,
  );
  if (!needed) return { check: { status: "idle" }, retry };
  if (phase === "failed") return { check: { status: "failed" }, retry };
  if (data === null) return { check: { status: "loading" }, retry };
  return { check: { status: "loaded", total: data }, retry };
}
