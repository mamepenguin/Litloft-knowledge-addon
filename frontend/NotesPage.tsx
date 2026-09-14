"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FilePlus, NotebookPen } from "lucide-react";

import { Button } from "@/components/Button";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { PageHeader } from "@/components/PageHeader";

import ClipSection from "./ClipSection";
import ConnectionsGraph from "./ConnectionsGraph";
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

  let body: React.ReactNode;
  if (query) {
    body = <NoteResults key={`q:${query}`} drive={drive} query={query} />;
  } else if (showAll) {
    body = <NoteResults key="all" drive={drive} />;
  } else {
    body = (
      <>
        {clipFirst && <ClipSection />}
        <FindNote />
        <ContinueWriting drive={drive} />
        <RecentNotes drive={drive} />
        {!clipFirst && <ClipSection />}
      </>
    );
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
      {!query && !showAll && (
        <div className="px-4">
          <ConnectionsGraph drive={drive} />
        </div>
      )}
      {newNote.dialog}
    </div>
  );
}
