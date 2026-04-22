"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Bookmark } from "lucide-react";

interface Props {
  drive: string;
}

function buildBookmarklet(origin: string, drive: string): string {
  // Prefill tab-open strategy — no CORS involved. `encodeURIComponent`
  // runs on the *visited page* (inside the javascript: URL body) so the
  // bookmarklet captures the visited URL and title at click time.
  const base = `${origin}/drive/${encodeURIComponent(drive)}/addons/knowledge`;
  const body =
    "(function(){" +
    "var u=encodeURIComponent(location.href);" +
    "var t=encodeURIComponent(document.title);" +
    `window.open(${JSON.stringify(base)}+'?prefill='+u+'&title='+t+'&autosubmit=1','_blank');` +
    "})();";
  return "javascript:" + body;
}

export default function BookmarkletSnippet({ drive }: Props) {
  const t = useTranslations("knowledge.clip.bookmarklet");
  const href = useMemo(() => {
    if (typeof window === "undefined") return "#";
    return buildBookmarklet(window.location.origin, drive);
  }, [drive]);

  return (
    <div className="flex flex-col gap-3">
      {/* The browser needs a real href so the user can drag it to the
          bookmark bar. We keep it clickable in-page too — clicking just
          opens the knowledge page with empty prefill. Low risk. */}
      <a
        href={href}
        draggable
        onClick={(e) => e.preventDefault()}
        className="inline-flex items-center gap-1.5 self-start rounded-2xl border border-bg-border bg-bg-elevated px-4 py-2 text-sm font-medium text-accent hover:bg-bg-elevated/70"
      >
        <Bookmark size={14} strokeWidth={1.6} />
        <span>{t("dragLabel")}</span>
      </a>
    </div>
  );
}
