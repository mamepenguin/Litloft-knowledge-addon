"use client";

import { useEffect, useMemo, useState } from "react";
import { Folder, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { listVaultFolders, type CoreFolderItem } from "./api";

interface FlatFolder {
  path: string;
  name: string;
  depth: number;
}

async function fetchAllFolders(
  drive: string,
  rootPath: string,
): Promise<FlatFolder[]> {
  const result: FlatFolder[] = [];
  const queue: { path: string; depth: number }[] = [{ path: rootPath, depth: 0 }];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    try {
      const folders = await listVaultFolders(drive, item.path);
      for (const f of folders) {
        result.push({ path: f.path, name: f.name, depth: item.depth + 1 });
        queue.push({ path: f.path, depth: item.depth + 1 });
      }
    } catch {
      // skip on error
    }
  }
  return result;
}

interface Props {
  drive: string;
  rootPath: string;
  currentPath: string | null;
  excludePath?: string;
  onConfirm: (targetPath: string) => void;
  onClose: () => void;
}

export default function MoveDialog({
  drive,
  rootPath,
  currentPath,
  excludePath,
  onConfirm,
  onClose,
}: Props) {
  const t = useTranslations("knowledge.move");
  const [folders, setFolders] = useState<FlatFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>(currentPath ?? rootPath);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const all = await fetchAllFolders(drive, rootPath);
        // Add root as first entry
        setFolders([{ path: rootPath, name: "/", depth: 0 }, ...all]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [drive, rootPath]);

  const filteredFolders = useMemo(() => {
    if (!excludePath) return folders;
    // Exclude the folder itself and its descendants
    return folders.filter(
      (f) =>
        f.path !== excludePath &&
        !f.path.startsWith(excludePath + "/"),
    );
  }, [folders, excludePath]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm overflow-hidden rounded-xl border border-bg-border bg-bg-card shadow-lg">
        <div className="flex items-center justify-between border-b border-bg-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-xs text-text-muted">
              {t("loading")}
            </div>
          ) : (
            <ul className="p-2">
              {filteredFolders.map((f) => {
                const isCurrent = f.path === currentPath;
                const isSelected = f.path === selected;
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => setSelected(f.path)}
                      className={[
                        "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                        isSelected
                          ? "bg-accent/15 text-text-primary"
                          : "text-text-primary hover:bg-bg-elevated",
                      ].join(" ")}
                      style={{ paddingLeft: `${f.depth * 12 + 12}px` }}
                    >
                      <Folder
                        size={13}
                        className={isSelected ? "text-accent" : "text-accent/70"}
                      />
                      <span className="flex-1 truncate">
                        {f.name}
                      </span>
                      {isCurrent && (
                        <span className="text-xs text-text-muted">
                          {t("currentLocation")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-bg-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-text-muted hover:bg-bg-elevated hover:text-text-primary"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selected)}
            disabled={selected === currentPath}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
