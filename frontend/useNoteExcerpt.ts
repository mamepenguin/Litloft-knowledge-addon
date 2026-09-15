"use client";

import { useEffect, useState } from "react";

import { stripPreviewText } from "@/components/TextThumbnail";

const EXCERPT_WINDOW_BYTES = 1024;

/** The body's opening text, with a leading line that only repeats the title removed. */
export function excerptFromText(raw: string, title: string): string {
  const lines = stripPreviewText(raw).split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first >= 0 && lines[first].trim() === title.trim()) lines.splice(first, 1);
  return lines.join("\n").trim();
}

/** `null` until the fetch settles; `""` when there is no body text or the fetch failed. */
export function useNoteExcerpt(fileId: string, title: string): string | null {
  const [excerpt, setExcerpt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setExcerpt(null);
    fetch(`/api/files/${encodeURIComponent(fileId)}/stream`, {
      headers: { Range: `bytes=0-${EXCERPT_WINDOW_BYTES - 1}` },
      credentials: "include",
    })
      .then((res) => (res.ok ? res.text() : ""))
      .then((raw) => {
        if (!cancelled) setExcerpt(raw ? excerptFromText(raw, title) : "");
      })
      .catch(() => {
        if (!cancelled) setExcerpt("");
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, title]);

  return excerpt;
}
