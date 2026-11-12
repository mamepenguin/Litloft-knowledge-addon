"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/Button";
import type { FileItem } from "@/types";

import { groupNotesByAge } from "../noteDates";
import { appendUnseen } from "../notePages";
import { NoteRows } from "../NoteRow";
import { notesWithOpenings, useNoteOpenings } from "../useNoteOpenings";
import { ALL_PAGE_SIZE, loadAllClips } from "./requests";

interface Props {
  drive: string;
  now: Date;
  visible: boolean;
  refreshToken: number;
}

export default function ClipsAll({ drive, now, visible, refreshToken }: Props) {
  const t = useTranslations("knowledge.clips");
  const tNotes = useTranslations("knowledge.notes");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextPage, setNextPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  const hasLoaded = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!drive) return;
    let cancelled = false;
    const initial = !hasLoaded.current;
    setLoading(true);
    loadAllClips(drive, 1)
      .then((res) => {
        if (cancelled || !mounted.current) return;
        hasLoaded.current = true;
        setFiles(res.data);
        setTotal(res.meta.total);
        setNextPage(2);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled || !mounted.current) return;
        if (initial) setFailed(true);
      })
      .finally(() => {
        if (!cancelled && mounted.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drive, refreshToken]);

  const loadMore = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await loadAllClips(drive, nextPage);
      if (!mounted.current) return;
      setFiles((prev) => appendUnseen(prev, res.data));
      setTotal(res.meta.total);
      setNextPage(nextPage + 1);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [drive, nextPage]);

  const openings = useNoteOpenings(drive, files.map((file) => file.id));
  const drawn = notesWithOpenings(files, openings);
  const more = total === null ? failed : (nextPage - 1) * ALL_PAGE_SIZE < total;

  if (!visible) return null;

  return (
    <div className="mt-6 flex flex-col gap-4">
      {groupNotesByAge(drawn, now, "created_at").map(({ group, files: grouped }) => (
        <div key={group}>
          <h3 className="px-1 pb-1 text-xs font-semibold text-text-muted sm:px-3">
            {t(`age.${group}`)}
          </h3>
          <NoteRows files={grouped} now={now} openings={openings.text} dateField="created_at" />
        </div>
      ))}
      {failed && (
        <p role="alert" className="text-xs text-danger">
          {tNotes("loadFailed")}
        </p>
      )}
      {more && (
        <Button variant="secondary" className="self-center" disabled={loading} onClick={() => void loadMore()}>
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}
