"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { NotebookPen } from "lucide-react";
import { listVaults, type CoreFileItem, type Vault } from "./api";
import VaultSetup from "./VaultSetup";
import Sidebar from "./Sidebar";
import Editor from "./Editor";

type Mode =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "addNew" }
  | { kind: "list" }
  | { kind: "edit"; file: CoreFileItem };

async function fetchFileMeta(fileId: string): Promise<CoreFileItem | null> {
  const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return res.json();
}

export default function KnowledgePage() {
  const t = useTranslations("knowledge");
  const searchParams = useSearchParams();
  const editParam = searchParams.get("edit");
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await listVaults();
      setVaults(res.vaults);
      setActiveId(res.active_vault_id);
      if (editParam) {
        const file = await fetchFileMeta(editParam);
        if (file) {
          setMode({ kind: "edit", file });
          return;
        }
      }
      setMode(res.vaults.length === 0 ? { kind: "setup" } : { kind: "list" });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [editParam]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 text-sm text-red-400">
        {error}
      </div>
    );
  }
  if (mode.kind === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-text-muted">
        {t("loading")}
      </div>
    );
  }

  if (mode.kind === "setup" || mode.kind === "addNew") {
    return (
      <VaultSetup
        onCreated={(v) => {
          setVaults((prev) => [...prev, v]);
          setActiveId(v.id);
          setMode({ kind: "list" });
        }}
        onCancel={
          mode.kind === "addNew" ? () => setMode({ kind: "list" }) : undefined
        }
      />
    );
  }

  const active = vaults.find((v) => v.id === activeId) ?? vaults[0];
  const selectedFile = mode.kind === "edit" ? mode.file : null;

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-bg-primary">
      {active && (
        <Sidebar
          vaults={vaults}
          active={active}
          selectedFileId={selectedFile?.id ?? null}
          onSwitchVault={(v) => {
            setActiveId(v.id);
            setMode({ kind: "list" });
          }}
          onAddVault={() => setMode({ kind: "addNew" })}
          onSelectFile={(f) => setMode({ kind: "edit", file: f })}
        />
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        {selectedFile ? (
          <Editor
            fileId={selectedFile.id}
            filename={selectedFile.title || selectedFile.filename}
            onBack={() => setMode({ kind: "list" })}
          />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  const t = useTranslations("knowledge.empty");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated text-text-muted">
        <NotebookPen size={28} strokeWidth={1.6} />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{t("title")}</h2>
        <p className="mt-1 max-w-sm text-sm text-text-muted">{t("description")}</p>
      </div>
    </div>
  );
}
