"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FilePlus, NotebookPen, Waypoints } from "lucide-react";

import { Button } from "@/components/Button";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { PageHeader } from "@/components/PageHeader";

import ClipSection from "./ClipSection";
import NoteResults from "./NoteResults";
import { ContinueWriting, FindNote, RecentNotes } from "./NotesLanding";
import { useNewNote } from "./useNewNote";

export default function NotesPage() {
  const drive = useCurrentDrive() ?? "";
  const t = useTranslations("knowledge.notes");
  const searchParams = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const showAll = searchParams.get("view") === "all";
  // A bookmarklet landing submits the clip form on mount, so the form is
  // what the reader has to see first.
  const clipFirst = Boolean(searchParams.get("prefill"));
  const newNote = useNewNote({ drive });

  const inResults = Boolean(query) || showAll;
  // One ClipSection for the page's lifetime: unmounting it would re-run the
  // bookmarklet's autosubmit on the way back and drop a clip still being sent.
  // Keyed siblings are reordered by React rather than remounted.
  const clip = (
    <div key="clip" hidden={inResults}>
      <ClipSection />
    </div>
  );
  let body: React.ReactNode[];
  if (inResults) {
    body = [
      query ? (
        <NoteResults key={`q:${drive}:${query}`} drive={drive} query={query} />
      ) : (
        <NoteResults key={`all:${drive}`} drive={drive} />
      ),
      clip,
    ];
  } else {
    const notes = [
      <FindNote key="find" />,
      <ContinueWriting key="continue" drive={drive} />,
      <RecentNotes key="recent" drive={drive} />,
    ];
    body = clipFirst ? [clip, ...notes] : [...notes, clip];
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 py-10">
      <PageHeader
        titleIcon={NotebookPen}
        title={t("heading")}
        scope={t("description")}
        actions={
          newNote.available ? (
            <Button variant="primary" onClick={newNote.open}>
              <FilePlus size={14} strokeWidth={1.8} />
              {t("newNote")}
            </Button>
          ) : undefined
        }
      />
      <div className="px-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-10">{body}</div>
      </div>
      {!inResults && (
        <div className="px-4">
          <div className="mx-auto w-full max-w-2xl">
            <Link
              href={`/drive/${encodeURIComponent(drive)}/addons/knowledge/connections`}
              className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary"
            >
              <Waypoints size={14} strokeWidth={1.6} />
              {t("connections")}
            </Link>
          </div>
        </div>
      )}
      {newNote.dialog}
    </div>
  );
}
