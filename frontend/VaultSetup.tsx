"use client";

import { useState } from "react";
import { NotebookPen } from "lucide-react";
import { useTranslations } from "next-intl";
import { createVault, type Vault } from "./api";

interface Props {
  drive: string;
  onCreated: (vault: Vault) => void;
  onCancel?: () => void;
}

export default function VaultSetup({ drive, onCreated, onCancel }: Props) {
  const t = useTranslations("knowledge");
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("Knowledge");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const vault = await createVault(drive, {
        label: label.trim(),
        drive,
        path: path.trim(),
      });
      onCreated(vault);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-bg-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring";

  return (
    <div className="flex min-h-[calc(var(--app-height,100dvh)-56px)] items-center justify-center bg-bg-primary p-6">
      <div className="w-full max-w-md rounded-2xl border border-bg-border bg-bg-card p-8 shadow-lg">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <NotebookPen size={22} strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("setup.title")}
            </h2>
          </div>
        </div>
        <p className="mb-6 text-sm leading-relaxed text-text-muted">
          {t("setup.description")}
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
              {t("setup.labelField")}
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              maxLength={100}
              placeholder={t("setup.labelPlaceholder")}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
              {t("setup.driveField")}
            </span>
            <div
              className={`${inputClass} cursor-not-allowed bg-bg-elevated font-mono text-[13px]`}
              aria-readonly="true"
            >
              {drive}
            </div>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
              {t("setup.pathField")}
            </span>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="Knowledge"
              className={`${inputClass} font-mono text-[13px]`}
            />
          </label>
          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-lg border border-bg-border bg-bg-elevated px-4 py-2 text-sm font-medium text-text-primary hover:border-accent/40"
              >
                {t("setup.cancel")}
              </button>
            )}
            <button
              type="submit"
              disabled={submitting || !label.trim()}
              className="flex-1 rounded-lg bg-accent-cta px-4 py-2 text-sm font-medium text-white hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? t("setup.creating") : t("setup.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
