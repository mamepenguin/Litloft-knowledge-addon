"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { listVaults, type CoreFileItem, type Vault } from "./api";
import VaultSetup from "./VaultSetup";
import VaultSwitcher from "./VaultSwitcher";
import FileList from "./FileList";
import Editor from "./Editor";
import SearchBar from "./SearchBar";

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
    return <div className="p-6 text-accent-danger">{error}</div>;
  }
  if (mode.kind === "loading") {
    return <div className="p-6 text-text-muted">{t("loading")}</div>;
  }

  if (mode.kind === "setup" || mode.kind === "addNew") {
    return (
      <VaultSetup
        onCreated={(v) => {
          setVaults((prev) => [...prev, v]);
          setActiveId(v.id);
          setMode({ kind: "list" });
        }}
      />
    );
  }

  const active = vaults.find((v) => v.id === activeId) ?? vaults[0];

  if (mode.kind === "edit") {
    return (
      <Editor
        fileId={mode.file.id}
        filename={mode.file.title || mode.file.filename}
        onBack={() => setMode({ kind: "list" })}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-primary">{t("title")}</h1>
        <VaultSwitcher
          vaults={vaults}
          activeId={activeId}
          onSwitched={(v) => setActiveId(v.id)}
          onAddNew={() => setMode({ kind: "addNew" })}
        />
      </header>
      {active && (
        <>
          <SearchBar
            vault={active}
            onSelect={(f) => setMode({ kind: "edit", file: f })}
          />
          <FileList
            vault={active}
            onSelect={(f) => setMode({ kind: "edit", file: f })}
          />
        </>
      )}
    </div>
  );
}
