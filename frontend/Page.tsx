"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, X } from "lucide-react";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { useOverlaySidebar } from "@/components/SidebarProvider";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useWebSocket } from "@/hooks/useWebSocket";
import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import { isInlineKnowledgeEditorEnabled } from "@/lib/featureFlags";
import {
  createTextFile,
  deleteFolderApi,
  listVaults,
  restoreFile,
  trashFile,
  type ClipJob,
  type CoreFileItem,
  type CoreFolderItem,
  type Vault,
} from "./api";
import QuickSwitcher, { recordRecent } from "./QuickSwitcher";
import FolderView from "./FolderView";
import { usePins } from "./hooks/usePins";
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
  | { kind: "folder"; path: string; name: string }
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

function untitledFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `untitled-${stamp}.md`;
}

interface ClipInit {
  url: string;
  title: string;
  autoSubmit: boolean;
}

export default function KnowledgePage() {
  useOverlaySidebar();
  const t = useTranslations("knowledge");
  const tShortcuts = useTranslations("knowledge.shortcuts");
  const drive = useCurrentDrive();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editParam = searchParams.get("edit");

  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Pins — initialized with 0, updated once activeId is known
  const pins = usePins(activeId ?? 0);
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
  const [deleteNotice, setDeleteNotice] = useState<
    | { status: "ok"; file: CoreFileItem }
    | { status: "error"; message: string; file: CoreFileItem }
    | null
  >(null);

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;

  const navigateMode = useCallback((next: Mode) => {
    if (next.kind === "edit" && activeIdRef.current !== null) {
      recordRecent(activeIdRef.current, next.file);
    }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const hasEdit = url.searchParams.has("edit");
      if (next.kind === "edit") {
        const targetId = next.file.id;
        const currentId = url.searchParams.get("edit");
        if (currentId !== targetId) {
          url.searchParams.set("edit", targetId);
          const path = url.pathname + url.search;
          if (hasEdit) {
            window.history.replaceState(window.history.state, "", path);
          } else {
            window.history.pushState({ knowledgeEdit: true }, "", path);
          }
        }
      } else if (hasEdit) {
        url.searchParams.delete("edit");
        window.history.replaceState(
          window.history.state,
          "",
          url.pathname + url.search,
        );
      }
    }
    setMode(next);
  }, []);

  useEffect(() => {
    const onPopState = async () => {
      const id = new URLSearchParams(window.location.search).get("edit");
      if (id) {
        const file = await fetchFileMeta(id);
        if (file) {
          setMode({ kind: "edit", file });
          return;
        }
      }
      setMode((prev) => (prev.kind === "edit" ? { kind: "list" } : prev));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const handleEditorBack = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      (window.history.state as { knowledgeEdit?: boolean } | null)?.knowledgeEdit
    ) {
      window.history.back();
    } else {
      navigateMode({ kind: "list" });
    }
  }, [navigateMode]);

  const handleDelete = useCallback(
    async (file: CoreFileItem) => {
      // Optimistic: switch out of the editor immediately. Even on API
      // failure the file still exists in the sidebar, so the user can
      // re-open it by clicking — no need to force-reopen.
      navigateMode({ kind: "list" });
      setActiveId((prev) => {
        if (prev !== null) saveLastFileId(prev, null);
        return prev;
      });
      setReloadKey((k) => k + 1);
      pins.unpin(file.id);
      try {
        await trashFile(file.id);
        setDeleteNotice({ status: "ok", file });
      } catch (e) {
        setReloadKey((k) => k + 1);
        setDeleteNotice({
          status: "error",
          message: (e as Error).message,
          file,
        });
      }
    },
    [pins, navigateMode],
  );

  const handleDeleteFolder = useCallback(
    async (folder: CoreFolderItem) => {
      if (!drive) return;
      try {
        await deleteFolderApi(drive, folder.path);
        setReloadKey((k) => k + 1);
      } catch {
        // swallow — sidebar will re-fetch and show folder still there
      }
    },
    [drive],
  );

  const handleUndoDelete = useCallback(async () => {
    if (!deleteNotice || deleteNotice.status !== "ok") return;
    const file = deleteNotice.file;
    try {
      await restoreFile(file.id);
      setDeleteNotice(null);
      navigateMode({ kind: "edit", file });
      setReloadKey((k) => k + 1);
    } catch (e) {
      setDeleteNotice({
        status: "error",
        message: (e as Error).message,
        file,
      });
    }
  }, [deleteNotice, navigateMode]);

  useEffect(() => {
    if (!deleteNotice) return;
    const delay = deleteNotice.status === "error" ? 8000 : 5000;
    const handle = setTimeout(() => setDeleteNotice(null), delay);
    return () => clearTimeout(handle);
  }, [deleteNotice]);

  if (drive === null) {
    notFound();
  }

  const refresh = useCallback(async () => {
    try {
      // Phase 2 PR-3 case P (hako ``RGstVXy42Bfw-FlpP8hCx``): when the
      // inline-editor flag is on and the legacy ``?edit={id}``
      // deep-link is hit, bounce to the canonical 2-pane URL so the
      // file opens in ``KnowledgeEditSection`` inside ``FileDetailContent``
      // rather than the standalone Knowledge route. We keep the legacy
      // route fully functional when the flag is off.
      if (editParam && isInlineKnowledgeEditorEnabled()) {
        const target = await fetchFileMeta(editParam);
        if (
          target &&
          (target.mime_type === "text/markdown" ||
            target.mime_type === "text/plain")
        ) {
          router.replace(
            buildCanonicalFileUrl(target, target.id, { edit: "1" }),
          );
          return;
        }
      }
      const res = await listVaults(drive);
      setVaults(res.vaults);
      setActiveId(res.active_vault_id);
      if (editParam) {
        const file = await fetchFileMeta(editParam);
        if (file) {
          navigateMode({ kind: "edit", file });
          return;
        }
      }
      const activeVaultId = res.active_vault_id ?? res.vaults[0]?.id ?? null;
      if (activeVaultId !== null) {
        const lastId = loadLastFileId(activeVaultId);
        if (lastId) {
          const file = await fetchFileMeta(lastId);
          if (file) {
            navigateMode({ kind: "edit", file });
            return;
          }
          saveLastFileId(activeVaultId, null);
        }
      }
      navigateMode(
        res.vaults.length === 0 ? { kind: "setup" } : { kind: "list" },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [editParam, drive, navigateMode, router]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      bodyTransform: body.style.transform,
      bodyPosition: body.style.position,
      bodyWidth: body.style.width,
      appHeight: html.style.getPropertyValue("--app-height"),
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.width = "100%";
    body.style.height = "var(--app-height, 100dvh)";

    const vv = window.visualViewport;
    const update = () => {
      const h = vv?.height ?? window.innerHeight;
      const offsetTop = vv?.offsetTop ?? 0;
      html.style.setProperty("--app-height", `${h}px`);
      body.style.transform = offsetTop ? `translateY(${offsetTop}px)` : "";
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("scroll", update, { passive: true });

    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("scroll", update);
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.height = prev.bodyHeight;
      body.style.transform = prev.bodyTransform;
      body.style.position = prev.bodyPosition;
      body.style.width = prev.bodyWidth;
      if (prev.appHeight) html.style.setProperty("--app-height", prev.appHeight);
      else html.style.removeProperty("--app-height");
    };
  }, []);

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

  const focusSearch = useCallback(() => {
    setSidebarHidden((prev) => {
      if (prev) saveSidebarHidden(false);
      return false;
    });
    // Defer focus until the sidebar finishes mounting/un-hiding.
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  const handleCreateNote = useCallback(async () => {
    if (!drive) return;
    const active = vaults.find((v) => v.id === activeId) ?? vaults[0];
    if (!active) return;
    try {
      const name = untitledFilename();
      const path = active.path ? `${active.path}/${name}` : name;
      const file = await createTextFile(drive, { path, content: "" });
      setReloadKey((k) => k + 1);
      navigateMode({ kind: "edit", file });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [drive, vaults, activeId, navigateMode]);

  const shortcutsEnabled = mode.kind !== "loading" && mode.kind !== "setup" && mode.kind !== "addNew";

  useShortcuts(
    "knowledge",
    tShortcuts("knowledge"),
    [
      { key: "/", label: tShortcuts("focusSearch"), handler: focusSearch },
      { key: "ctrl+k", label: tShortcuts("quickSwitcher"), handler: () => setSwitcherOpen(true) },
      { key: "n", label: tShortcuts("newNote"), handler: () => void handleCreateNote() },
    ],
    shortcutsEnabled,
  );

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 text-sm text-danger">
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
          navigateMode({ kind: "list" });
        }}
        onCancel={
          mode.kind === "addNew"
            ? () => navigateMode({ kind: "list" })
            : undefined
        }
      />
    );
  }

  const active = vaults.find((v) => v.id === activeId) ?? vaults[0];
  const selectedFile = mode.kind === "edit" ? mode.file : null;
  const folderMode = mode.kind === "folder" ? mode : null;

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
    if (file) navigateMode({ kind: "edit", file });
  };

  const closeClip = () => {
    setClipOpen(false);
    // Clear one-shot prefill so a subsequent open starts blank.
    if (clipInit.url || clipInit.autoSubmit) {
      setClipInit({ url: "", title: "", autoSubmit: false });
    }
  };

  const hasMainContent = selectedFile !== null || folderMode !== null;
  const effectiveSidebarHidden = sidebarHidden && hasMainContent;
  const sidebarWrapperClass = [
    "h-full w-full flex-col md:w-72",
    hasMainContent ? "hidden" : "flex",
    effectiveSidebarHidden ? "md:hidden" : "md:flex",
  ].join(" ");

  const mainWrapperClass = [
    "min-w-0 flex-1 flex-col md:flex",
    hasMainContent ? "flex" : "hidden",
  ].join(" ");

  return (
    <div className="flex h-[calc(var(--app-height,100dvh)-56px)] overflow-hidden bg-bg-primary">
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
            selectedFolderPath={folderMode?.path ?? null}
            reloadKey={reloadKey}
            fetchingClipsCount={fetchingClipsCount}
            onSwitchVault={(v) => {
              setActiveId(v.id);
              navigateMode({ kind: "list" });
            }}
            onAddVault={() => navigateMode({ kind: "addNew" })}
            onSelectFile={(f) => navigateMode({ kind: "edit", file: f })}
            onOpenFolder={(path, name) =>
              navigateMode({ kind: "folder", path, name })
            }
            onOpenClip={() => setClipOpen(true)}
            onOpenClipHelp={() => setHelpOpen(true)}
            pins={pins.pins}
            onPin={pins.pin}
            onUnpin={pins.unpin}
            isPinned={pins.isPinned}
            onPinReorder={pins.reorder}
            onRequestDelete={handleDelete}
            onRequestDeleteFolder={handleDeleteFolder}
            searchInputRef={searchInputRef}
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
            drive={selectedFile.drive}
            vaultId={activeId ?? undefined}
            sidebarHidden={sidebarHidden}
            onToggleSidebar={toggleSidebar}
            onBack={handleEditorBack}
            onRenamed={(newFilename) => {
              setMode({
                kind: "edit",
                file: { ...selectedFile, filename: newFilename },
              });
              pins.updatePinTitle(selectedFile.id, newFilename, selectedFile.title);
              setReloadKey((k) => k + 1);
            }}
            onDelete={() => handleDelete(selectedFile)}
          />
        ) : folderMode && active ? (
          <FolderView
            drive={drive}
            vault={active}
            path={folderMode.path}
            name={folderMode.name}
            sidebarHidden={sidebarHidden}
            onToggleSidebar={toggleSidebar}
            onBack={() => navigateMode({ kind: "list" })}
            onSelectFile={(f) => navigateMode({ kind: "edit", file: f })}
            onSelectFolder={(path, name) =>
              navigateMode({ kind: "folder", path, name })
            }
            onReload={() => setReloadKey((k) => k + 1)}
          />
        ) : active ? (
          <EmptyState
            drive={drive}
            vault={active}
            reloadKey={reloadKey}
            onSelectFile={(f) => navigateMode({ kind: "edit", file: f })}
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
      {deleteNotice && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
        >
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-bg-border bg-bg-card px-4 py-3 shadow-lg animate-fade-in-scale">
            {deleteNotice.status === "ok" ? (
              <>
                <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                  {t("toast.deleted", { name: deleteNotice.file.filename })}
                </span>
                <button
                  type="button"
                  onClick={handleUndoDelete}
                  className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  {t("toast.undo")}
                </button>
              </>
            ) : (
              <>
                <AlertCircle size={16} className="shrink-0 text-danger" />
                <span className="min-w-0 flex-1 text-sm text-danger">
                  {t("toast.error", { error: deleteNotice.message })}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={() => setDeleteNotice(null)}
              aria-label={t("toast.dismiss")}
              className="shrink-0 rounded-lg p-1 text-text-muted hover:bg-bg-elevated hover:text-text-primary"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {active && (
        <QuickSwitcher
          drive={drive}
          vault={active}
          open={switcherOpen}
          onClose={() => setSwitcherOpen(false)}
          onSelect={(file) => {
            setSwitcherOpen(false);
            navigateMode({ kind: "edit", file });
          }}
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
