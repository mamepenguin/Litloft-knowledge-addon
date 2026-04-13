"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createVault, listDrives, type CoreDrive, type Vault } from "./api";

interface Props {
  onCreated: (vault: Vault) => void;
}

export default function VaultSetup({ onCreated }: Props) {
  const t = useTranslations("knowledge");
  const [drives, setDrives] = useState<CoreDrive[]>([]);
  const [label, setLabel] = useState("");
  const [drive, setDrive] = useState("");
  const [path, setPath] = useState("Knowledge");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDrives()
      .then((d) => {
        setDrives(d);
        if (d.length > 0) setDrive(d[0].name);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !drive) return;
    setSubmitting(true);
    setError(null);
    try {
      const vault = await createVault({
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

  return (
    <div className="mx-auto max-w-md p-6">
      <h2 className="mb-4 text-xl font-bold text-text-primary">
        {t("setup.title")}
      </h2>
      <p className="mb-6 text-sm text-text-muted">{t("setup.description")}</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-text-secondary">
            {t("setup.labelField")}
          </span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={100}
            placeholder={t("setup.labelPlaceholder")}
            className="rounded border border-border-default bg-surface-base px-3 py-2 text-text-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-text-secondary">
            {t("setup.driveField")}
          </span>
          <select
            value={drive}
            onChange={(e) => setDrive(e.target.value)}
            required
            className="rounded border border-border-default bg-surface-base px-3 py-2 text-text-primary"
          >
            {drives.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-text-secondary">
            {t("setup.pathField")}
          </span>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="Knowledge"
            className="rounded border border-border-default bg-surface-base px-3 py-2 text-text-primary"
          />
        </label>
        {error && <div className="text-sm text-accent-danger">{error}</div>}
        <button
          type="submit"
          disabled={submitting || !label.trim() || !drive}
          className="rounded bg-accent-cta px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {submitting ? t("setup.creating") : t("setup.create")}
        </button>
      </form>
    </div>
  );
}
