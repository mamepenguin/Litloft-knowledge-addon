"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { FileSearch } from "lucide-react";

import { useGlobalSearch, useSearchScope, type SearchScope } from "@/components/search/GlobalSearchProvider";
import { formatShortcut } from "@/lib/shortcuts";
import { isTextKind } from "@/lib/textKind";

interface Props {
  drive: string;
  filename: string;
  mimeType?: string | null;
}

export default function GoToNoteAction({ drive, filename, mimeType }: Props) {
  const t = useTranslations("knowledge.goToNote");
  const search = useGlobalSearch();
  const isNote = isTextKind(mimeType, filename);
  const label = t("scope");

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

  if (!isNote) return null;

  return (
    <button
      type="button"
      onClick={() => search.open()}
      className="inline-flex items-center gap-2 rounded-2xl border border-bg-border py-1.5 pr-2.5 pl-3 text-[13px] whitespace-nowrap text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary pointer-coarse:min-h-11"
    >
      <FileSearch size={14} aria-hidden="true" />
      {t("button")}
      <kbd aria-hidden="true" className="rounded-lg bg-sand px-1.5 py-px font-sans text-[11px] pointer-coarse:hidden">
        {formatShortcut("ctrl+k")}
      </kbd>
    </button>
  );
}
