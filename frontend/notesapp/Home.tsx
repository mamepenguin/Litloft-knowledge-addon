"use client";

import { useNoteClock } from "../useNoteClock";
import ContinueWritingSection from "./ContinueWritingSection";
import NotesWithSourcesSection from "./NotesWithSourcesSection";
import RecentlyUpdatedSection from "./RecentlyUpdatedSection";
import type { NotesTarget } from "./useNotesTarget";

export default function Home({ drive, target }: { drive: string; target: NotesTarget }) {
  // One clock for the whole render, so every row agrees on what "today" is.
  const now = useNoteClock();
  return (
    <div className="flex flex-col gap-12">
      <ContinueWritingSection drive={drive} now={now} />
      <NotesWithSourcesSection drive={drive} target={target} now={now} />
      <RecentlyUpdatedSection drive={drive} target={target} now={now} />
    </div>
  );
}
