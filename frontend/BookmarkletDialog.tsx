"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Bookmark, X } from "lucide-react";
import BookmarkletSnippet from "./BookmarkletSnippet";

interface Props {
  drive: string;
  open: boolean;
  onClose: () => void;
}

export default function BookmarkletDialog({ drive, open, onClose }: Props) {
  const t = useTranslations("knowledge.clip");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="knowledge-bookmarklet-dialog-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-10"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-fade-in-scale rounded-2xl border border-bg-border bg-bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-bg-border px-5 py-3">
          <h2
            id="knowledge-bookmarklet-dialog-title"
            className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary"
          >
            <Bookmark size={14} strokeWidth={1.6} className="text-accent" />
            {t("helpModalTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("modalClose")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:bg-bg-elevated hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-sm leading-relaxed text-text-muted">
            {t("helpDescription")}
          </p>
          <BookmarkletSnippet drive={drive} />
        </div>
      </div>
    </div>
  );
}
