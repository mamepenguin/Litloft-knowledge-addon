"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createNoteFromFile } from "./api";

interface Props {
  drive: string;
  sourceFileId: string;
  /** Stem of the source file's filename (without extension). Used as the default note filename. */
  defaultStem: string;
  open: boolean;
  onClose: () => void;
}

export default function CreateNoteDialog({
  drive,
  sourceFileId,
  defaultStem,
  open,
  onClose,
}: Props) {
  const t = useTranslations("knowledge.createNoteDialog");
  const tc = useTranslations("knowledge.unresolvedLinkDialog");
  const router = useRouter();

  const [filename, setFilename] = useState(() => `${defaultStem}.md`);
  const [folder, setFolder] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filenameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setFilename(`${defaultStem}.md`);
      setFolder("");
      setError(null);
      setSubmitting(false);
    }
  }, [open, defaultStem]);

  // Focus filename and select the stem (excluding .md extension).
  useEffect(() => {
    if (!open) return;
    const el = filenameRef.current;
    if (!el) return;
    el.focus();
    const dotIdx = el.value.lastIndexOf(".");
    if (dotIdx > 0) el.setSelectionRange(0, dotIdx);
    else el.select();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSubmit = useCallback(async () => {
    const finalFilename = filename.trim() || `${defaultStem}.md`;
    const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, "");

    setSubmitting(true);
    setError(null);
    try {
      const result = await createNoteFromFile(drive, sourceFileId, {
        filename: finalFilename,
        folder: cleanFolder,
      });
      onClose();
      router.push(
        `/drive/${encodeURIComponent(drive)}/addons/knowledge?edit=${encodeURIComponent(result.note_file_id)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }, [drive, sourceFileId, filename, folder, onClose, router]);

  if (!open) return null;

  const trimmed = filename.trim();
  const hasTraversal =
    trimmed.split(/[\\/]/).some((s) => s === ".." || s === ".") ||
    folder.split(/[\\/]/).some((s) => s === "..");
  const disabled = submitting || trimmed.length === 0 || hasTraversal;

  const inputClass =
    "w-full rounded-lg border border-bg-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring font-mono";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-xl bg-bg-card p-5 shadow-lg">
        <h3 className="text-sm font-semibold text-text-primary">{t("title")}</h3>

        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {tc("filenameLabel")}
          <input
            ref={filenameRef}
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !disabled) void handleSubmit(); }}
            aria-label={tc("filenameLabel")}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {tc("folderLabel")}
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !disabled) void handleSubmit(); }}
            placeholder={t("folderPlaceholder")}
            aria-label={tc("folderLabel")}
            className={inputClass}
          />
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger/10 px-2 py-1 text-xs text-danger"
          >
            {error}
          </p>
        )}

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-3 py-1.5 text-sm text-text-muted hover:bg-bg-elevated disabled:opacity-50"
          >
            {tc("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={disabled}
            className="rounded-lg bg-accent-cta px-3 py-1.5 text-sm font-medium text-white hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? t("creating") : tc("create")}
          </button>
        </div>
      </div>
    </div>
  );
}
