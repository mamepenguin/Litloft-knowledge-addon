"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { useOverlaySidebar } from "@/components/SidebarProvider";
import { useWebSocket } from "@/hooks/useWebSocket";
import {
  listVaults,
  type ClipJob,
  type CoreFileItem,
  type Vault,
} from "./api";
import VaultSetup from "./VaultSetup";
import Sidebar from "./Sidebar";
import Editor from "./Editor";
import ClipDuplicateDialog from "./ClipDuplicateDialog";
import ClipPasteForm from "./ClipPasteForm";
import ClipModal, { type RecentJob } from "./ClipModal";
import BookmarkletDialog from "./BookmarkletDialog";
import EmptyState from "./EmptyState";
import type { ClipDuplicateMatch } from "./ClipInput";

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

interface ClipInit {
  url: string;
  title: string;
  autoSubmit: boolean;
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
  const [recentJobs, setRecentJobs] = useState<Map<string, RecentJob>>(
    () => new Map(),
  );
  const [duplicateMatch, setDuplicateMatch] =
    useState<ClipDuplicateMatch | null>(null);
  const [pasteRetry, setPasteRetry] = useState<{
    fileId: string;
    url: string;
    subfolder: string;
  } | null>(null);

  // Clip modal state. `clipInit` is seeded once from bookmarklet query
  // params and cleared on close/submit so re-opening the modal does not
  // re-trigger auto-submit.
  const [clipOpen, setClipOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [clipInit, setClipInit] = useState<ClipInit>(() => ({
    url: searchParams.get("prefill") ?? "",
    title: searchParams.get("title") ?? "",
    autoSubmit: searchParams.get("autosubmit") === "1",
  }));

  useEffect(() => {
    if (clipInit.url) setClipOpen(true);
    // Only on first mount — subsequent searchParams changes must not reopen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clipReady = useWebSocket("knowledge.clip.ready");
  const clipFailed = useWebSocket("knowledge.clip.failed");

  useEffect(() => {
    if (!clipReady) return;
    const data = clipReady.data as {
      file_id?: string;
      title?: string;
    };
    if (!data.file_id) return;
    setRecentJobs((prev) => {
      const next = new Map(prev);
      const current = next.get(data.file_id!);
      if (!current) return prev;
      next.set(data.file_id!, {
        ...current,
        status: "ready",
        title: data.title ?? current.title,
      });
      return next;
    });
    setReloadKey((k) => k + 1);
  }, [clipReady]);

  useEffect(() => {
    if (!clipFailed) return;
    const data = clipFailed.data as {
      file_id?: string;
      error?: string;
      url?: string;
    };
    if (!data.file_id) return;
    setRecentJobs((prev) => {
      const next = new Map(prev);
      const current = next.get(data.file_id!);
      if (!current) return prev;
      next.set(data.file_id!, {
        ...current,
        status: "failed",
        error: data.error,
      });
      return next;
    });
  }, [clipFailed]);

  const toggleSidebar = useCallback(() => {
    setSidebarHidden((prev) => {
      const next = !prev;
      saveSidebarHidden(next);
      return next;
    });
  }, []);

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

  const fetchingClipsCount = useMemo(() => {
    let n = 0;
    for (const j of recentJobs.values()) if (j.status === "fetching") n += 1;
    return n;
  }, [recentJobs]);

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

  const registerJob = (job: ClipJob, url: string, subfolder: string) => {
    setRecentJobs((prev) => {
      const next = new Map(prev);
      next.set(job.file_id, {
        status: job.status,
        url,
        subfolder,
      });
      return next;
    });
    setReloadKey((k) => k + 1);
  };

  const handleOpenExisting = async (fileId: string) => {
    setDuplicateMatch(null);
    setClipOpen(false);
    const file = await fetchFileMeta(fileId);
    if (file) setMode({ kind: "edit", file });
  };

  const closeClip = () => {
    setClipOpen(false);
    // Clear one-shot prefill so a subsequent open starts blank.
    if (clipInit.url || clipInit.autoSubmit) {
      setClipInit({ url: "", title: "", autoSubmit: false });
    }
  };

  const effectiveSidebarHidden = sidebarHidden && selectedFile !== null;
  const sidebarWrapperClass = [
    "h-full w-full flex-col md:w-72",
    selectedFile ? "hidden" : "flex",
    effectiveSidebarHidden ? "md:hidden" : "md:flex",
  ].join(" ");

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
            fetchingClipsCount={fetchingClipsCount}
            onSwitchVault={(v) => {
              setActiveId(v.id);
              setMode({ kind: "list" });
            }}
            onAddVault={() => setMode({ kind: "addNew" })}
            onSelectFile={(f) => setMode({ kind: "edit", file: f })}
            onOpenClip={() => setClipOpen(true)}
            onOpenClipHelp={() => setHelpOpen(true)}
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
        ) : active ? (
          <EmptyState
            drive={drive}
            vault={active}
            reloadKey={reloadKey}
            onSelectFile={(f) => setMode({ kind: "edit", file: f })}
          />
        ) : null}
      </main>
      {active && (
        <ClipModal
          drive={drive}
          vault={active}
          open={clipOpen}
          onClose={closeClip}
          prefillUrl={clipInit.url}
          prefillTitle={clipInit.title}
          autoSubmit={clipInit.autoSubmit}
          recentJobs={recentJobs}
          onSubmitted={(job, url, subfolder) => {
            registerJob(job, url, subfolder);
            setClipInit({ url: "", title: "", autoSubmit: false });
          }}
          onDuplicate={setDuplicateMatch}
          onRetryPaste={(rj) => setPasteRetry(rj)}
        />
      )}
      <BookmarkletDialog
        drive={drive}
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
      {duplicateMatch && active && (
        <ClipDuplicateDialog
          drive={drive}
          vault={active}
          url={duplicateMatch.url}
          subfolder={duplicateMatch.subfolder}
          existing={duplicateMatch.existing}
          onOpenExisting={handleOpenExisting}
          onCreated={(job) => {
            registerJob(job, duplicateMatch.url, duplicateMatch.subfolder);
            setDuplicateMatch(null);
            setClipInit({ url: "", title: "", autoSubmit: false });
          }}
          onClose={() => setDuplicateMatch(null)}
        />
      )}
      {pasteRetry && active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-2xl">
            <ClipPasteForm
              drive={drive}
              vault={active}
              url={pasteRetry.url}
              subfolder={pasteRetry.subfolder}
              onSaved={(job) => {
                registerJob(job, pasteRetry.url, pasteRetry.subfolder);
                setPasteRetry(null);
              }}
              onCancel={() => setPasteRetry(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
