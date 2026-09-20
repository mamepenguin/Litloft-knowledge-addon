"use client";

import { useEffect, useRef, useState } from "react";

import { fetchNoteOpenings } from "./api";

interface Answered {
  openings: Record<string, string>;
  asked: Set<string>;
}

const NOTHING_ASKED: Answered = { openings: {}, asked: new Set() };

/**
 * The opening text of the notes in a listing, asked for in one request.
 *
 * `null` until every id has an answer, so a caller draws its rows once and
 * at their final height. Each id is asked about once, so a page appended
 * to the listing costs one request for its own ids. A failed request
 * counts as answered: the rows appear without their opening lines rather
 * than waiting for a retry.
 */
export function useNoteOpenings(
  drive: string,
  fileIds: string[] | null,
): Record<string, string> | null {
  const [answered, setAnswered] = useState<Answered>(NOTHING_ASKED);
  const askedDrive = useRef(drive);
  if (askedDrive.current !== drive) {
    askedDrive.current = drive;
    if (answered !== NOTHING_ASKED) setAnswered(NOTHING_ASKED);
  }

  const missing = (fileIds ?? []).filter((id) => !answered.asked.has(id));
  const key = missing.join(",");

  useEffect(() => {
    if (key === "") return;
    let cancelled = false;
    const ids = key.split(",");
    const settle = (openings: Record<string, string>) => {
      if (cancelled) return;
      setAnswered((prev) => ({
        openings: { ...prev.openings, ...openings },
        asked: new Set([...prev.asked, ...ids]),
      }));
    };
    fetchNoteOpenings(drive, ids)
      .then(settle)
      .catch(() => settle({}));
    return () => {
      cancelled = true;
    };
  }, [drive, key]);

  if (fileIds === null) return null;
  return missing.length === 0 ? answered.openings : null;
}
