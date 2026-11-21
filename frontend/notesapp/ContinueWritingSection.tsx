"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { PenLine } from "lucide-react";

import { useLoad } from "@/components/appshell/useLoad";
import { useProfile } from "@/components/ProfileProvider";
import { getWatchHistory } from "@/lib/api";

import ContinueCard from "../ContinueCard";
import { usePageFileLists } from "../cardMenu/PageFileMenu";
import { SectionHeading } from "../NotesLanding";
import { notesWithOpenings, useNoteOpenings } from "../useNoteOpenings";
import { SkeletonCards } from "./Skeleton";

const LIMIT = 4;

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] sm:gap-5";

/**
 * The notes this viewer opened last. It ignores the Target: the history is the
 * viewer's own activity, and `watch-history` takes no target conditions.
 */
export default function ContinueWritingSection({ drive, now }: { drive: string; now: Date }) {
  const t = useTranslations("knowledge.notesApp");
  const { nickname } = useProfile();
  const load = useCallback(
    () => getWatchHistory(drive, LIMIT, "all", "text", { exclude_origin: "webclip" }),
    [drive],
  );
  const { state } = useLoad(nickname ? load : null);
  const lists = usePageFileLists();
  const rows = state.status === "loaded" ? lists.filter("continue", state.data) : [];
  const openings = useNoteOpenings(drive, rows.map((file) => file.id));
  const cards = notesWithOpenings(rows, openings);

  if (!nickname || state.status === "failed" || state.status === "idle") return null;
  if (state.status === "loaded" && rows.length === 0) return null;

  return (
    <section>
      <SectionHeading icon={<PenLine size={18} strokeWidth={1.8} aria-hidden="true" />}>
        {t("continueWriting")}
      </SectionHeading>
      {cards.length === 0 ? (
        <SkeletonCards count={Math.min(rows.length || LIMIT, LIMIT)} />
      ) : (
        <div className={GRID}>
          {cards.map((file) => (
            <ContinueCard key={file.id} file={file} now={now} opening={openings.text[file.id]} listKey="continue" />
          ))}
        </div>
      )}
    </section>
  );
}
