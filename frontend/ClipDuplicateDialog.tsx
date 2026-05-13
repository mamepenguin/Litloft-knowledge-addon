"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { ClipJob } from "./api";
import { createClip } from "./api";

interface Props {
  drive: string;
  url: string;
  subfolder: string;
  existing: ClipJob[];
  onOpenExisting: (fileId: string) => void;
  onCreated: (job: ClipJob) => void;
  onClose: () => void;
}

export default function ClipDuplicateDialog({
  drive,
  url,
  subfolder,
  existing,
  onOpenExisting,
  onCreated,
  onClose,
}: Props) {
  const t = useTranslations("knowledge.clip.duplicate");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = existing[0];

  const handleCreateNew = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const job = await createClip(drive, {
        url,
        subfolder: subfolder || null,
      });
      onCreated(job);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clip-duplicate-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
    >
      <div className="w-full max-w-md animate-fade-in-scale rounded-2xl border border-bg-border bg-bg-card p-5 shadow-lg">
        <h2
          id="clip-duplicate-title"
          className="text-base font-semibold text-text-primary"
        >
          {t("title")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          {t("description")}
        </p>
        <p
          className="mt-3 truncate rounded-xl border border-bg-border bg-bg-elevated px-3 py-2 text-xs text-text-muted"
          title={url}
        >
          {url}
        </p>
        {error && (
          <p className="mt-3 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onOpenExisting(latest.file_id)}
            disabled={submitting}
            className="w-full rounded-2xl bg-sand px-4 py-2 text-sm font-medium text-text-primary hover:bg-sand-hover disabled:opacity-50"
          >
            {t("openExisting")}
          </button>
          <button
            type="button"
            onClick={handleCreateNew}
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" strokeWidth={1.6} />
            ) : null}
            <span>{t("createNew")}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-full rounded-2xl px-4 py-2 text-sm text-text-muted hover:bg-bg-elevated disabled:opacity-50"
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
