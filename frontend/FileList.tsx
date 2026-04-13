"use client";

import { useCallback, useEffect, useState } from "react";
import { FilePlus, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createTextFile,
  listVaultFiles,
  type CoreFileItem,
  type Vault,
} from "./api";

interface Props {
  vault: Vault;
  onSelect: (file: CoreFileItem) => void;
}

export default function FileList({ vault, onSelect }: Props) {
  const t = useTranslations("knowledge.fileList");
  const [files, setFiles] = useState<CoreFileItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setFiles(null);
    setError(null);
    try {
      const res = await listVaultFiles(vault.drive, vault.path);
      setFiles(res.data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [vault.drive, vault.path]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleCreate() {
    const name = window.prompt(t("newFilePrompt"), "untitled.md");
    if (!name || !name.trim()) return;
    const clean = name.trim().endsWith(".md") ? name.trim() : `${name.trim()}.md`;
    const rel = vault.path ? `${vault.path}/${clean}` : clean;
    setCreating(true);
    try {
      const created = await createTextFile(vault.drive, {
        path: rel,
        content: "",
      });
      await reload();
      onSelect(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center gap-2 rounded bg-accent-cta px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          <FilePlus size={14} />
          {t("newFile")}
        </button>
      </div>

      {error && <div className="text-sm text-accent-danger">{error}</div>}

      {files === null ? (
        <div className="p-6 text-text-muted">{t("loading")}</div>
      ) : files.length === 0 ? (
        <div className="p-6 text-text-muted">{t("empty")}</div>
      ) : (
        <ul className="flex flex-col divide-y divide-border-default rounded border border-border-default">
          {files.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onSelect(f)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover"
              >
                <FileText size={18} className="text-text-muted" />
                <span className="flex-1 truncate text-text-primary">
                  {f.title || f.filename}
                </span>
                <span className="text-xs text-text-muted">{f.file_type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
