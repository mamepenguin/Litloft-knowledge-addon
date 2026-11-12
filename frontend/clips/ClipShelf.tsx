"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { FileItem } from "@/types";

import { SectionHeading } from "../NotesLanding";
import { NoteRows } from "../NoteRow";
import { notesWithOpenings, useNoteOpenings } from "../useNoteOpenings";
import { isViewerRequired, type ClipLoader } from "./requests";

interface Props {
  drive: string;
  title: string;
  now: Date;
  visible: boolean;
  refreshToken: number;
  load: ClipLoader;
  onViewerRequired?: () => void;
}

export default function ClipShelf({
  drive,
  title,
  now,
  visible,
  refreshToken,
  load,
  onViewerRequired,
}: Props) {
  const tNotes = useTranslations("knowledge.notes");
  const [items, setItems] = useState<FileItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const hasItems = useRef(false);

  useEffect(() => {
    if (!drive) return;
    let cancelled = false;
    setFailed(false);
    load(drive)
      .then((next) => {
        if (cancelled) return;
        hasItems.current = true;
        setItems(next);
      })
      .catch((error) => {
        if (cancelled) return;
        if (isViewerRequired(error)) {
          onViewerRequired?.();
          return;
        }
        if (!hasItems.current) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [drive, refreshToken, load, onViewerRequired]);

  const openings = useNoteOpenings(drive, items?.map((file) => file.id) ?? []);
  const ready = Boolean(items?.every((file) => openings.answered.has(file.id)));

  if (!visible) return null;
  if (failed) {
    return (
      <section className="mt-10">
        <SectionHeading>{title}</SectionHeading>
        <p role="alert" className="text-xs text-danger">
          {tNotes("loadFailed")}
        </p>
      </section>
    );
  }
  if (!items || items.length === 0 || !ready) return null;

  return (
    <section className="mt-10">
      <SectionHeading>{title}</SectionHeading>
      <NoteRows
        files={notesWithOpenings(items, openings)}
        now={now}
        openings={openings.text}
        dateField="created_at"
      />
    </section>
  );
}
