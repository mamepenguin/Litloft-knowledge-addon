"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, Clock } from "lucide-react";

import { useLoad } from "@/components/appshell/useLoad";

import { usePageFileLists } from "../cardMenu/PageFileMenu";
import { NoteRows } from "../NoteRow";
import { SectionHeading } from "../NotesLanding";
import { notesWithOpenings, useNoteOpenings } from "../useNoteOpenings";
import { listNotes } from "./listing";
import { RetryLink } from "./RetryLink";
import { SkeletonRows } from "./Skeleton";
import type { NotesTarget } from "./useNotesTarget";

const LIMIT = 5;

export default function RecentlyUpdatedSection({
  drive,
  target,
  now,
}: {
  drive: string;
  target: NotesTarget;
  now: Date;
}) {
  const t = useTranslations("knowledge.notesApp");
  const pathname = usePathname();
  const load = useMemo(
    () =>
      target.status === "ready"
        ? () => listNotes(drive, target, { sort: "updated_at", order: "desc", limit: LIMIT })
        : null,
    [drive, target],
  );
  const { state, retry } = useLoad(load);
  const lists = usePageFileLists();
  const files = state.status === "loaded" ? lists.filter("recent", state.data.data) : [];
  const openings = useNoteOpenings(drive, files.map((file) => file.id));
  const drawn = notesWithOpenings(files, openings);

  if (state.status === "loaded" && files.length === 0) return null;

  const libraryLink = (
    <Link
      href={`${pathname}?${new URLSearchParams({ view: "all", sort: "updated" })}`}
      className="flex items-center gap-0.5 text-sm text-text-muted transition-colors hover:text-accent"
    >
      {t("seeInLibrary")}
      <ChevronRight size={16} aria-hidden="true" />
    </Link>
  );

  return (
    <section>
      <SectionHeading
        icon={<Clock size={18} strokeWidth={1.8} aria-hidden="true" />}
        action={state.status === "failed" ? undefined : libraryLink}
      >
        {t("recent")}
      </SectionHeading>
      {state.status === "failed" ? (
        <RetryLink onRetry={retry} />
      ) : drawn.length === 0 ? (
        <SkeletonRows count={LIMIT} rowClass="h-[62px]" />
      ) : (
        <NoteRows files={drawn} now={now} openings={openings.text} listKey="recent" />
      )}
    </section>
  );
}
