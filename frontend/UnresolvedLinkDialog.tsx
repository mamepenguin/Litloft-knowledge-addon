"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createTextFile, type CoreFileItem } from "./api";

interface Props {
  drive: string;
  /**
   * The raw wiki-link target text the user clicked on (e.g. ``Year in
   * review`` from ``[[Year in review]]``). Used as the default
   * filename — the user can edit it before confirming.
   */
  target: string;
  /**
   * The folder the source note lives in. Used as the default
   * destination so a click on an unresolved link doesn't scatter
   * notes across the vault.
   */
  defaultFolder: string;
  open: boolean;
  onClose: () => void;
  /**
   * Fires after a successful create so the caller can refetch wiki
   * resolutions / navigate to the new note. Receives the
   * ``CoreFileItem`` from ``POST /api/drives/{drive}/files``.
   */
  onCreated?: (file: CoreFileItem) => void;
}

/**
 * Modal dialog that lets the user mint a new Knowledge note from an
 * unresolved wiki-link. Spec 2026-05-12 §3.8.
 *
 * - Pre-fills filename ``<target>.md`` and folder = ``defaultFolder``.
 * - Confirm calls ``createTextFile(drive, {path, content})`` with an
 *   H1 header so the resolver picks the new note up on the next
 *   render cycle.
 * - Rejects path-traversal segments (``..``) client-side as a defense
 *   in depth (the backend also rejects).
 * - 409 / 5xx surfaces as a ``role="alert"`` error message; the
 *   dialog stays open so the user can pick another name.
 * - Escape / Cancel close without an API call.
 *
 * Owned by the knowledge addon because only knowledge knows how to
 * mint a fresh ``.md`` file — core only exposes the CSS class so
 * this dialog can find the unresolved link targets and act on them.
 */
export default function UnresolvedLinkDialog({
  drive,
  target,
  defaultFolder,
  open,
  onClose,
  onCreated,
}: Props) {
  const t = useTranslations("knowledge.unresolvedLinkDialog");
  const [filename, setFilename] = useState(defaultName(target));
  const [folder, setFolder] = useState(defaultFolder);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filenameRef = useRef<HTMLInputElement | null>(null);

  // Reset state whenever the dialog opens with a new target so a
  // second click doesn't carry over stale input.
  useEffect(() => {
    if (open) {
      setFilename(defaultName(target));
      setFolder(defaultFolder);
      setError(null);
      setSubmitting(false);
    }
  }, [open, target, defaultFolder]);

  // Escape closes the dialog. Attached at document level so the
  // handler fires regardless of where focus lives.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) filenameRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const trimmedFilename = filename.trim();
  const hasPathTraversal =
    trimmedFilename.split(/[\\/]/).some((seg) => seg === ".." || seg === ".") ||
    folder.split(/[\\/]/).some((seg) => seg === "..");
  const disabled =
    submitting || trimmedFilename.length === 0 || hasPathTraversal;

  async function handleCreate() {
    if (disabled) return;
    const finalName = ensureMdExtension(trimmedFilename);
    const cleanFolder = folder.replace(/^\/+|\/+$/g, "");
    const path = cleanFolder ? `${cleanFolder}/${finalName}` : finalName;
    setSubmitting(true);
    setError(null);
    try {
      const file = await createTextFile(drive, {
        path,
        content: `# ${target}\n`,
      });
      onCreated?.(file);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

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
      <div className="flex w-full max-w-md flex-col gap-3 rounded-xl bg-bg-card p-4 shadow-lg">
        <h3 className="text-sm font-semibold text-text-primary">
          {t("title")}
        </h3>

        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("filenameLabel")}
          <input
            ref={filenameRef}
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            aria-label={t("filenameLabel")}
            className="rounded-lg border border-bg-border bg-bg-primary px-2 py-1 text-sm text-text-primary focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("folderLabel")}
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            aria-label={t("folderLabel")}
            className="rounded-lg border border-bg-border bg-bg-primary px-2 py-1 text-sm text-text-primary focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring"
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
            className="rounded-lg px-3 py-1.5 text-sm text-text-muted hover:bg-bg-elevated"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={disabled}
            className="rounded-lg bg-accent-cta px-3 py-1.5 text-sm font-medium text-white hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("create")}
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultName(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return "";
  return ensureMdExtension(trimmed);
}

function ensureMdExtension(name: string): string {
  return /\.md$/i.test(name) ? name : `${name}.md`;
}
