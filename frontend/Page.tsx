"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { NotebookPen, PanelLeft, PanelLeftClose } from "lucide-react";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { useOverlaySidebar } from "@/components/SidebarProvider";
import { listVaults, type CoreFileItem, type Vault } from "./api";
import VaultSetup from "./VaultSetup";
import Sidebar from "./Sidebar";
import Editor from "./Editor";

const SIDEBAR_HIDDEN_KEY = "knowledge:sidebarHidden";

function loadSidebarHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveSidebarHidden(hidden: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (hidden) window.localStorage.setItem(SIDEBAR_HIDDEN_KEY, "1");
    else window.localStorage.removeItem(SIDEBAR_HIDDEN_KEY);
  } catch {
    // ignore quota / disabled storage
  }
}

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

function lastFileKey(vaultId: number): string {
  return `knowledge:lastFile:${vaultId}`;
}

function loadLastFileId(vaultId: number): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(lastFileKey(vaultId));
  } catch {
    return null;
  }
}

function saveLastFileId(vaultId: number, fileId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (fileId) window.localStorage.setItem(lastFileKey(vaultId), fileId);
    else window.localStorage.removeItem(lastFileKey(vaultId));
  } catch {
    // ignore quota / disabled storage
  }
}

export default function KnowledgePage() {
  useOverlaySidebar();
  const t = useTranslations("knowledge");
  const drive = useCurrentDrive();
  const searchParams = useSearchParams();
  const editParam = searchParams.get("edit");
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() =>
    loadSidebarHidden(),
  );

  const toggleSidebar = useCallback(() => {
    setSidebarHidden((prev) => {
      const next = !prev;
      saveSidebarHidden(next);
      return next;
    });
  }, []);

  // Drive scope: this page only renders under /drive/{drive}/addons/knowledge.
  // Reaching it without a drive context is a routing bug.
  if (drive === null) {
    notFound();
  }

  const refresh = useCallback(async () => {
    try {
      const res = await listVaults(drive);
      setVaults(res.vaults);
      setActiveId(res.active_vault_id);
      if (editParam) {
        const file = await fetchFileMeta(editParam);
        if (file) {
          setMode({ kind: "edit", file });
          return;
        }
      }
      const activeVaultId = res.active_vault_id ?? res.vaults[0]?.id ?? null;
      if (activeVaultId !== null) {
        const lastId = loadLastFileId(activeVaultId);
        if (lastId) {
          const file = await fetchFileMeta(lastId);
          if (file) {
            setMode({ kind: "edit", file });
            return;
          }
          saveLastFileId(activeVaultId, null);
        }
      }
      setMode(res.vaults.length === 0 ? { kind: "setup" } : { kind: "list" });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [editParam, drive]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedFileId = mode.kind === "edit" ? mode.file.id : null;
  useEffect(() => {
    if (activeId === null) return;
    saveLastFileId(activeId, selectedFileId);
  }, [activeId, selectedFileId]);

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
        drive={drive}
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

  // Sidebar wrapper:
  //   - desktop: shown unless user toggled hidden (sidebarHidden)
  //   - mobile: mutually exclusive with main — shown only when no file is selected
  const sidebarWrapperClass = [
    "h-full w-full flex-col md:w-72",
    selectedFile ? "hidden" : "flex",
    sidebarHidden ? "md:hidden" : "md:flex",
  ].join(" ");

  // Main wrapper:
  //   - desktop: always visible
  //   - mobile: shown only when a file is selected
  const mainWrapperClass = [
    "min-w-0 flex-1 flex-col md:flex",
    selectedFile ? "flex" : "hidden",
  ].join(" ");

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-bg-primary">
      {active && (
        <div
          data-testid="knowledge-sidebar-wrapper"
          className={sidebarWrapperClass}
        >
          <Sidebar
            drive={drive}
            vaults={vaults}
            active={active}
            selectedFileId={selectedFile?.id ?? null}
            reloadKey={reloadKey}
            onSwitchVault={(v) => {
              setActiveId(v.id);
              setMode({ kind: "list" });
            }}
            onAddVault={() => setMode({ kind: "addNew" })}
            onSelectFile={(f) => setMode({ kind: "edit", file: f })}
          />
        </div>
      )}
      <main
        data-testid="knowledge-main-wrapper"
        className={mainWrapperClass}
      >
        {selectedFile ? (
          <Editor
            fileId={selectedFile.id}
            filename={selectedFile.filename}
            sidebarHidden={sidebarHidden}
            onToggleSidebar={toggleSidebar}
            onBack={() => setMode({ kind: "list" })}
            onRenamed={(newFilename) => {
              setMode({
                kind: "edit",
                file: { ...selectedFile, filename: newFilename },
              });
              setReloadKey((k) => k + 1);
            }}
          />
        ) : (
          <EmptyState
            sidebarHidden={sidebarHidden}
            onToggleSidebar={toggleSidebar}
          />
        )}
      </main>
      {/* Mobile layout never exposes the sidebar toggle directly on this page
          because the sidebar↔editor transition is state-driven; desktop-only
          toggle lives inside Editor/EmptyState. When no vault exists yet we
          still need a way to surface the hide toggle — but that case is
          handled earlier in the setup flow. */}
      {/* When sidebar is hidden and no file is selected, the Editor branch is
          skipped — EmptyState hosts the show-toggle. */}
    </div>
  );
}

function EmptyState({
  sidebarHidden,
  onToggleSidebar,
}: {
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
}) {
  const t = useTranslations("knowledge.empty");
  const tSide = useTranslations("knowledge.sidebar");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hidden items-center gap-3 border-b border-bg-border px-4 py-2.5 md:flex">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-text-primary"
          aria-label={sidebarHidden ? tSide("show") : tSide("hide")}
          aria-pressed={sidebarHidden}
          title={sidebarHidden ? tSide("show") : tSide("hide")}
        >
          {sidebarHidden ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-elevated text-text-muted">
          <NotebookPen size={28} strokeWidth={1.6} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{t("title")}</h2>
          <p className="mt-1 max-w-sm text-sm text-text-muted">{t("description")}</p>
        </div>
      </div>
    </div>
  );
}
