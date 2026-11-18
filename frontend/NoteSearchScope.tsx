"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { useSearchScope, type SearchScope } from "@/components/search/GlobalSearchProvider";
import { isTextKind } from "@/lib/textKind";

interface Props {
  drive: string;
  filename: string;
  mimeType?: string | null;
}

export default function NoteSearchScope({ drive, filename, mimeType }: Props) {
  const t = useTranslations("knowledge.noteScope");
  const isNote = isTextKind(mimeType, filename);
  const label = t("label");

  const scope = useMemo<SearchScope>(
    () => ({
      label,
      type: "text",
      seeAllHref: (query) =>
        `/drive/${encodeURIComponent(drive)}/addons/knowledge?view=all&q=${encodeURIComponent(query)}`,
    }),
    [drive, label],
  );
  useSearchScope(isNote ? scope : null);

  return null;
}
