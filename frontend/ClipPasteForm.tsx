"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { createClipFromHtml, type ClipJob } from "./api";

// Shared cancel label across clip dialogs — matches duplicate/cancel.

interface Props {
  drive: string;
  url: string;
  subfolder: string;
  onSaved: (job: ClipJob) => void;
  onCancel: () => void;
}

export default function ClipPasteForm({
  drive,
  url,
  subfolder,
  onSaved,
  onCancel,
}: Props) {
  const t = useTranslations("knowledge.clip.paste");
  const tDup = useTranslations("knowledge.clip.duplicate");
  const [html, setHtml] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!html.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const job = await createClipFromHtml(drive, {
        url,
        subfolder: subfolder || null,
        html,
      });
      onSaved(job);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex animate-fade-in-scale flex-col gap-4 rounded-2xl border border-bg-border bg-bg-card p-5 shadow-lg"
    >
      <div>
        <h3 className="text-base font-semibold text-text-primary">
          {t("title")}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">
          {t("description")}
        </p>
      </div>
      <textarea
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        placeholder={t("placeholder")}
        aria-label={t("placeholder")}
        rows={8}
        disabled={submitting}
        className="w-full rounded-2xl border border-bg-border bg-bg-elevated p-3 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring disabled:opacity-50"
      />
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-2xl bg-sand px-4 py-2 text-sm font-medium text-text-primary hover:bg-sand-hover disabled:opacity-50"
        >
          {tDup("cancel")}
        </button>
        <button
          type="submit"
          disabled={submitting || !html.trim()}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin" strokeWidth={1.6} />
          ) : null}
          <span>{submitting ? t("submitting") : t("submit")}</span>
        </button>
      </div>
    </form>
  );
}
