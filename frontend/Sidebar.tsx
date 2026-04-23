"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  FileText,
  FilePlus,
  Folder,
  FolderPlus,
  Link2,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  activateVault,
  createFolder,
  createTextFile,
  deleteFolderApi,
  listVaultFiles,
  listVaultFolders,
  moveFile,
  moveFolder,
  renameFile,
  renameFolderApi,
  searchVault,
  trashFile,
  type CoreFileItem,
  type CoreFolderItem,
  type SearchHit,
  type Vault,
} from "./api";
import ContextMenu, { type ContextAction } from "./ContextMenu";
import MoveDialog from "./MoveDialog";
import TagPanel from "./TagPanel";
import {
  useContextMenu,
  type ContextTarget,
} from "./hooks/useContextMenu";
import { sortFiles, useSortMode } from "./hooks/useSortMode";
import {
  loadPinsCollapsed,
  savePinsCollapsed,
  type PinnedNote,
} from "./hooks/usePins";

function untitledFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `untitled-${stamp}.md`;
}

interface Contents {
  folders: CoreFolderItem[];
  files: CoreFileItem[];
}

type DraggedItem =
  | { kind: "file"; item: CoreFileItem }
  | { kind: "folder"; item: CoreFolderItem };

function isAncestorOrSelf(targetPath: string, dragged: DraggedItem): boolean {
  if (dragged.kind !== "folder") return false;
  return (
    targetPath === dragged.item.path ||
    targetPath.startsWith(dragged.item.path + "/")
  );
}

interface Props {
  drive: string;
  vaults: Vault[];
  active: Vault;
  selectedFileId: string | null;
  selectedFolderPath?: string | null;
  reloadKey?: number;
  fetchingClipsCount?: number;
  onSwitchVault: (v: Vault) => void;
  onAddVault: () => void;
  onSelectFile: (f: CoreFileItem) => void;
  onOpenFolder?: (path: string, name: string) => void;
  onOpenClip: () => void;
  onOpenClipHelp: () => void;
  // Pins
  pins?: PinnedNote[];
  onPin?: (file: CoreFileItem) => void;
  onUnpin?: (fileId: string) => void;
  isPinned?: (fileId: string) => boolean;
  onPinReorder?: (from: number, to: number) => void;
  // Delete notifications
  onRequestDelete?: (file: CoreFileItem) => void;
  onRequestDeleteFolder?: (folder: CoreFolderItem) => void;
}

function expandedStorageKey(vaultId: number): string {
  return `knowledge:tree:${vaultId}:expanded`;
}

function loadExpanded(vaultId: number, rootPath: string): Set<string> {
  if (typeof window === "undefined") return new Set([rootPath]);
  try {
    const raw = window.localStorage.getItem(expandedStorageKey(vaultId));
    if (!raw) return new Set([rootPath]);
    const arr = JSON.parse(raw) as string[];
    return new Set([rootPath, ...arr]);
  } catch {
    return new Set([rootPath]);
  }
}

function saveExpanded(vaultId: number, set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      expandedStorageKey(vaultId),
      JSON.stringify([...set]),
    );
  } catch {
    // ignore quota / disabled storage
  }
}

export default function Sidebar({
  drive,
  vaults,
  active,
  selectedFileId,
  selectedFolderPath,
  reloadKey = 0,
  fetchingClipsCount = 0,
  onSwitchVault,
  onAddVault,
  onSelectFile,
  onOpenFolder,
  onOpenClip,
  onOpenClipHelp,
  pins = [],
  onPin,
  onUnpin,
  isPinned,
  onPinReorder,
  onRequestDelete,
  onRequestDeleteFolder,
}: Props) {
  const tFile = useTranslations("knowledge.fileList");
  const tSearch = useTranslations("knowledge.search");
  const tSidebar = useTranslations("knowledge.sidebar");
  const tPins = useTranslations("knowledge.pins");
  const tRename = useTranslations("knowledge.rename");

  const rootPath = active.path;

  const [contents, setContents] = useState<Map<string, Contents>>(new Map());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    loadExpanded(active.id, rootPath),
  );

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);

  const [pendingFolder, setPendingFolder] = useState<{
    parent: string;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // D&D state
  const [draggedItem, setDraggedItem] = useState<DraggedItem | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  // Context menu
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null); // file id or folder path

  // Sort
  const { sortMode, cycleSortMode } = useSortMode(active.id);

  // Move dialog
  const [moveTarget, setMoveTarget] = useState<ContextTarget | null>(null);

  // Tag panel
  const [tagTarget, setTagTarget] = useState<{
    fileId: string;
    x: number;
    y: number;
  } | null>(null);

  // Pins section collapsed
  const [pinsCollapsed, setPinsCollapsed] = useState(() =>
    loadPinsCollapsed(active.id),
  );

  // Pin DnD
  const [draggedPinIndex, setDraggedPinIndex] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    saveExpanded(active.id, expanded);
  }, [active.id, expanded]);

  const loadPath = useCallback(
    async (path: string): Promise<void> => {
      setLoadingPaths((prev) => {
        if (prev.has(path)) return prev;
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      try {
        const [f, fd] = await Promise.all([
          listVaultFiles(active.drive, path),
          listVaultFolders(active.drive, path),
        ]);
        setContents((prev) => {
          const next = new Map(prev);
          next.set(path, { folders: fd, files: f.data });
          return next;
        });
        setErrors((prev) => {
          if (!prev.has(path)) return prev;
          const next = new Map(prev);
          next.delete(path);
          return next;
        });
      } catch (e) {
        setErrors((prev) => {
          const next = new Map(prev);
          next.set(path, (e as Error).message);
          return next;
        });
      } finally {
        setLoadingPaths((prev) => {
          if (!prev.has(path)) return prev;
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [active.drive],
  );

  useEffect(() => {
    const persisted = loadExpanded(active.id, rootPath);
    setExpanded(persisted);
    setContents(new Map());
    setErrors(new Map());
    for (const p of persisted) void loadPath(p);
    if (!persisted.has(rootPath)) void loadPath(rootPath);
  }, [active.id, rootPath, reloadKey, loadPath]);

  useEffect(() => {
    if (pendingFolder !== null) folderInputRef.current?.focus();
  }, [pendingFolder]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await searchVault(drive, active.id, q);
        setHits(res.results);
        setSearchTruncated(res.truncated);
      } catch {
        setHits([]);
        setSearchTruncated(false);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, active.id, drive]);

  function toggleExpand(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!contents.has(path)) void loadPath(path);
  }

  function ensureExpanded(path: string): void {
    setExpanded((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    if (!contents.has(path)) void loadPath(path);
  }

  async function createNoteIn(parent: string): Promise<void> {
    if (creating) return;
    const name = untitledFilename();
    const rel = parent ? `${parent}/${name}` : name;
    setCreating(true);
    try {
      const created = await createTextFile(active.drive, {
        path: rel,
        content: "",
      });
      await loadPath(parent);
      ensureExpanded(parent);
      onSelectFile(created);
    } catch (e) {
      setErrors((prev) => {
        const next = new Map(prev);
        next.set(parent, (e as Error).message);
        return next;
      });
    } finally {
      setCreating(false);
    }
  }

  async function submitPendingFolder(name: string): Promise<void> {
    if (!pendingFolder) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setPendingFolder(null);
      return;
    }
    const { parent } = pendingFolder;
    setCreating(true);
    try {
      await createFolder(active.drive, parent, trimmed);
      setPendingFolder(null);
      await loadPath(parent);
      ensureExpanded(parent);
    } catch (e) {
      setErrors((prev) => {
        const next = new Map(prev);
        next.set(parent, (e as Error).message);
        return next;
      });
    } finally {
      setCreating(false);
    }
  }

  // D&D handlers
  async function handleDrop(dragged: DraggedItem, targetFolderPath: string): Promise<void> {
    setMoving(true);
    try {
      if (dragged.kind === "file") {
        if (dragged.item.folder_path === targetFolderPath) return;
        await moveFile(dragged.item.id, active.drive, targetFolderPath);
        await Promise.all([
          loadPath(dragged.item.folder_path),
          loadPath(targetFolderPath),
        ]);
      } else {
        const parentOfDragged = dragged.item.path.includes("/")
          ? dragged.item.path.split("/").slice(0, -1).join("/")
          : rootPath;
        if (parentOfDragged === targetFolderPath) return;
        await moveFolder(active.drive, dragged.item.path, targetFolderPath);
        await Promise.all([
          loadPath(parentOfDragged),
          loadPath(targetFolderPath),
        ]);
      }
    } catch {
      // errors are visible via reload failure
    } finally {
      setMoving(false);
      setDraggedItem(null);
    }
  }

  // Context menu action handler
  async function handleContextAction(action: ContextAction, target: ContextTarget): Promise<void> {
    if (target.kind === "file") {
      const file = target.item;
      switch (action.type) {
        case "open":
          onSelectFile(file);
          break;
        case "openNewTab":
          window.open(`/drive/${encodeURIComponent(drive)}/addons/knowledge?edit=${file.id}`, "_blank");
          break;
        case "rename":
          setRenamingId(file.id);
          break;
        case "move":
          setMoveTarget(target);
          break;
        case "pin":
          onPin?.(file);
          break;
        case "unpin":
          onUnpin?.(file.id);
          break;
        case "tags":
          // Tag panel position comes from contextMenu state which is already set
          if (contextMenu) {
            setTagTarget({ fileId: file.id, x: contextMenu.x + 200, y: contextMenu.y });
          }
          break;
        case "trash":
          if (onRequestDelete) {
            onRequestDelete(file);
          } else {
            try {
              await trashFile(file.id);
              onUnpin?.(file.id);
              await loadPath(file.folder_path);
            } catch {
              // swallow
            }
          }
          break;
      }
    } else {
      const folder = target.item;
      switch (action.type) {
        case "openFolder":
          onOpenFolder?.(folder.path, folder.name);
          break;
        case "newNoteHere":
          await createNoteIn(folder.path);
          break;
        case "newFolderHere":
          setPendingFolder({ parent: folder.path });
          ensureExpanded(folder.path);
          break;
        case "rename":
          setRenamingId(folder.path);
          break;
        case "move":
          setMoveTarget(target);
          break;
        case "deleteFolder":
          if (folder.file_count === 0) {
            if (onRequestDeleteFolder) {
              onRequestDeleteFolder(folder);
            } else {
              try {
                const parentPath = folder.path.includes("/")
                  ? folder.path.split("/").slice(0, -1).join("/")
                  : rootPath;
                await deleteFolderApi(active.drive, folder.path);
                await loadPath(parentPath);
              } catch {
                // swallow
              }
            }
          }
          break;
      }
    }
  }

  // Inline rename handlers
  async function commitRenameFile(id: string, newName: string, currentFolderPath: string): Promise<void> {
    const trimmed = newName.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    const finalName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
    try {
      await renameFile(id, finalName);
      await loadPath(currentFolderPath);
    } catch {
      // swallow rename error
    } finally {
      setRenamingId(null);
    }
  }

  async function commitRenameFolder(path: string, newName: string): Promise<void> {
    const trimmed = newName.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    const parentPath = path.includes("/")
      ? path.split("/").slice(0, -1).join("/")
      : rootPath;
    try {
      await renameFolderApi(active.drive, path, trimmed);
      await loadPath(parentPath);
    } catch {
      // swallow rename error
    } finally {
      setRenamingId(null);
    }
  }

  // Move dialog handler
  async function handleMoveConfirm(targetPath: string): Promise<void> {
    if (!moveTarget) return;
    setMoveTarget(null);
    if (moveTarget.kind === "file") {
      const file = moveTarget.item;
      try {
        await moveFile(file.id, active.drive, targetPath);
        await Promise.all([loadPath(file.folder_path), loadPath(targetPath)]);
      } catch {
        // swallow
      }
    } else {
      const folder = moveTarget.item;
      const parentPath = folder.path.includes("/")
        ? folder.path.split("/").slice(0, -1).join("/")
        : rootPath;
      try {
        await moveFolder(active.drive, folder.path, targetPath);
        await Promise.all([loadPath(parentPath), loadPath(targetPath)]);
      } catch {
        // swallow
      }
    }
  }

  // Toggle pins collapsed
  function togglePinsCollapsed() {
    setPinsCollapsed((prev) => {
      const next = !prev;
      savePinsCollapsed(active.id, next);
      return next;
    });
  }

  const showSearch = query.trim().length > 0;
  const rootContents = contents.get(rootPath);
  const rootLoading = loadingPaths.has(rootPath) && !rootContents;

  return (
    <aside className="flex h-full w-full flex-col border-r border-bg-border bg-bg-card">
      <VaultHeader
        drive={drive}
        vaults={vaults}
        active={active}
        onSwitch={onSwitchVault}
        onAddNew={onAddVault}
      />

      <div className="flex items-center gap-1 border-b border-bg-border px-2 py-1.5">
        <button
          type="button"
          onClick={onOpenClip}
          className="relative flex flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-elevated"
        >
          <Link2 size={14} className="text-accent" strokeWidth={1.8} />
          <span>{tSidebar("clipAction")}</span>
          {fetchingClipsCount > 0 && (
            <span
              className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent-amber/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-amber"
              title={tSidebar("clipBadge", { count: fetchingClipsCount })}
              aria-label={tSidebar("clipBadge", { count: fetchingClipsCount })}
            >
              {fetchingClipsCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenClipHelp}
          title={tSidebar("helpAction")}
          aria-label={tSidebar("helpAction")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-text-primary"
        >
          <CircleHelp size={14} />
        </button>
      </div>

      <div className="border-b border-bg-border px-3 py-2">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tSearch("placeholder")}
            aria-label={tSearch("placeholder")}
            className="w-full rounded-md border border-bg-border bg-bg-primary py-1.5 pl-8 pr-8 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={tSearch("clear")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-bg-elevated hover:text-text-primary"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showSearch ? (
          <SearchResults
            searching={searching}
            hits={hits}
            truncated={searchTruncated}
            onPick={(hit) =>
              onSelectFile({
                id: hit.file_id,
                filename: hit.filename,
                title: hit.title,
                drive: active.drive,
                folder_path: rootPath,
                file_type: "document",
                mime_type: "text/markdown",
                thumbnail_url: "",
                file_size: 0,
                created_at: "",
                updated_at: "",
              })
            }
            selectedFileId={selectedFileId}
          />
        ) : rootLoading ? (
          <div className="px-3 py-6 text-center text-xs text-text-muted">
            {tFile("loading")}
          </div>
        ) : (
          <div className="p-2">
            {/* Pins section */}
            {pins.length > 0 && (
              <div className="mb-1">
                <button
                  type="button"
                  onClick={togglePinsCollapsed}
                  className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-text-muted hover:bg-bg-elevated"
                >
                  <Pin size={11} className="flex-shrink-0" />
                  <span className="flex-1">{tPins("section")}</span>
                  {pinsCollapsed ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </button>
                {!pinsCollapsed && (
                  <ul className="flex flex-col">
                    {pins.map((pin, idx) => {
                      const isActive = pin.id === selectedFileId;
                      return (
                        <li
                          key={pin.id}
                          draggable
                          data-pin-index={idx}
                          onDragStart={() => setDraggedPinIndex(idx)}
                          onDragEnd={() => setDraggedPinIndex(null)}
                          onDragOver={(e) => {
                            if (draggedPinIndex === null) return;
                            e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (draggedPinIndex === null) return;
                            onPinReorder?.(draggedPinIndex, idx);
                            setDraggedPinIndex(null);
                          }}
                          className={draggedPinIndex === idx ? "opacity-40" : ""}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              onSelectFile({
                                id: pin.id,
                                filename: pin.filename,
                                title: pin.title,
                                drive: active.drive,
                                folder_path: rootPath,
                                file_type: "document",
                                mime_type: "text/markdown",
                                thumbnail_url: "",
                                file_size: 0,
                                created_at: "",
                                updated_at: "",
                              })
                            }
                            onContextMenu={(e) =>
                              openContextMenu(e, {
                                kind: "file",
                                item: {
                                  id: pin.id,
                                  filename: pin.filename,
                                  title: pin.title,
                                  drive: active.drive,
                                  folder_path: rootPath,
                                  file_type: "document",
                                  mime_type: "text/markdown",
                                  thumbnail_url: "",
                                  file_size: 0,
                                  created_at: "",
                                  updated_at: "",
                                },
                              })
                            }
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                              isActive
                                ? "bg-accent/15 text-text-primary"
                                : "text-text-primary hover:bg-bg-elevated"
                            }`}
                          >
                            <FileText
                              size={13}
                              className={isActive ? "text-accent" : "text-text-muted"}
                            />
                            <span className="flex-1 truncate text-sm">
                              {pin.title || pin.filename.replace(/\.md$/i, "")}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="my-1 border-t border-bg-border" />
              </div>
            )}

            {/* Sort button row */}
            {!showSearch && (
              <div className="mb-1 flex items-center justify-end">
                <button
                  type="button"
                  onClick={cycleSortMode}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-primary"
                  title={
                    sortMode === "updated_desc"
                      ? "更新日順"
                      : sortMode === "created_desc"
                        ? "作成日順"
                        : "名前順"
                  }
                >
                  <ArrowUpDown size={11} />
                  <span>
                    {sortMode === "updated_desc"
                      ? "更新日"
                      : sortMode === "created_desc"
                        ? "作成日"
                        : "名前"}
                  </span>
                </button>
              </div>
            )}

            {rootContents &&
            rootContents.folders.length === 0 &&
            rootContents.files.length === 0 &&
            !pendingFolder ? (
              <div className="px-3 py-6 text-center text-xs text-text-muted">
                {tFile("empty")}
              </div>
            ) : (
              <FolderBody
                parentPath={rootPath}
                rootPath={rootPath}
                contents={contents}
                loadingPaths={loadingPaths}
                errors={errors}
                expanded={expanded}
                pendingFolder={pendingFolder}
                onPendingFolderChange={setPendingFolder}
                onSubmitPendingFolder={submitPendingFolder}
                creating={creating}
                folderInputRef={folderInputRef}
                selectedFileId={selectedFileId}
                selectedFolderPath={selectedFolderPath ?? null}
                onSelectFile={onSelectFile}
                onToggle={toggleExpand}
                onCreateNote={createNoteIn}
                onStartCreateFolder={(parent) => setPendingFolder({ parent })}
                onOpenFolder={onOpenFolder}
                onContextMenu={openContextMenu}
                draggedItem={draggedItem}
                dropTargetPath={dropTargetPath}
                onDragStart={setDraggedItem}
                onDragEnd={() => setDraggedItem(null)}
                onDragOver={setDropTargetPath}
                onDrop={handleDrop}
                moving={moving}
                renamingId={renamingId}
                onCommitRenameFile={commitRenameFile}
                onCommitRenameFolder={commitRenameFolder}
                onCancelRename={() => setRenamingId(null)}
                sortMode={sortMode}
                depth={0}
              />
            )}
          </div>
        )}
      </div>

      {!showSearch && (
        <div className="flex items-center gap-1 border-t border-bg-border p-2">
          <button
            type="button"
            onClick={() => createNoteIn(rootPath)}
            disabled={creating}
            className="flex flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-text-primary hover:bg-bg-elevated disabled:opacity-50"
          >
            <Plus size={16} className="text-accent" />
            {tFile("newFile")}
          </button>
          <button
            type="button"
            onClick={() => setPendingFolder({ parent: rootPath })}
            disabled={creating || pendingFolder !== null}
            title={tFile("newFolder")}
            aria-label={tFile("newFolder")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-text-primary disabled:opacity-50"
          >
            <FolderPlus size={16} />
          </button>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          isPinned={
            contextMenu.target.kind === "file"
              ? (isPinned?.(contextMenu.target.item.id) ?? false)
              : false
          }
          onAction={handleContextAction}
          onClose={closeContextMenu}
        />
      )}

      {/* Move Dialog */}
      {moveTarget && (
        <MoveDialog
          drive={active.drive}
          rootPath={rootPath}
          currentPath={
            moveTarget.kind === "file"
              ? moveTarget.item.folder_path
              : (() => {
                  const p = moveTarget.item.path;
                  return p.includes("/") ? p.split("/").slice(0, -1).join("/") : rootPath;
                })()
          }
          excludePath={moveTarget.kind === "folder" ? moveTarget.item.path : undefined}
          onConfirm={handleMoveConfirm}
          onClose={() => setMoveTarget(null)}
        />
      )}

      {/* Tag Panel */}
      {tagTarget && (
        <TagPanel
          fileId={tagTarget.fileId}
          drive={active.drive}
          x={tagTarget.x}
          y={tagTarget.y}
          onClose={() => setTagTarget(null)}
        />
      )}

    </aside>
  );
}

interface FolderBodyProps {
  parentPath: string;
  rootPath: string;
  contents: Map<string, Contents>;
  loadingPaths: Set<string>;
  errors: Map<string, string>;
  expanded: Set<string>;
  pendingFolder: { parent: string } | null;
  onPendingFolderChange: (v: { parent: string } | null) => void;
  onSubmitPendingFolder: (name: string) => void;
  creating: boolean;
  folderInputRef: RefObject<HTMLInputElement | null>;
  selectedFileId: string | null;
  selectedFolderPath: string | null;
  onSelectFile: (f: CoreFileItem) => void;
  onToggle: (path: string) => void;
  onCreateNote: (parent: string) => void;
  onStartCreateFolder: (parent: string) => void;
  onOpenFolder?: (path: string, name: string) => void;
  onContextMenu: (e: React.MouseEvent, target: ContextTarget) => void;
  draggedItem: DraggedItem | null;
  dropTargetPath: string | null;
  onDragStart: (item: DraggedItem) => void;
  onDragEnd: () => void;
  onDragOver: (path: string | null) => void;
  onDrop: (item: DraggedItem, targetPath: string) => Promise<void>;
  moving: boolean;
  renamingId: string | null;
  onCommitRenameFile: (id: string, newName: string, folderPath: string) => Promise<void>;
  onCommitRenameFolder: (path: string, newName: string) => Promise<void>;
  onCancelRename: () => void;
  sortMode: import("./hooks/useSortMode").SortMode;
  depth: number;
}

function FolderBody(props: FolderBodyProps) {
  const {
    parentPath,
    contents,
    loadingPaths,
    errors,
    expanded,
    pendingFolder,
    onPendingFolderChange,
    onSubmitPendingFolder,
    creating,
    folderInputRef,
    selectedFileId,
    selectedFolderPath,
    onSelectFile,
    onToggle,
    onCreateNote,
    onStartCreateFolder,
    onOpenFolder,
    onContextMenu,
    draggedItem,
    dropTargetPath,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
    moving,
    renamingId,
    onCommitRenameFile,
    onCommitRenameFolder,
    onCancelRename,
    sortMode,
    depth,
  } = props;
  const tFile = useTranslations("knowledge.fileList");
  const c = contents.get(parentPath);
  const err = errors.get(parentPath);
  const isLoading = loadingPaths.has(parentPath) && !c;

  const sortedFolders = useMemo(
    () => (c ? [...c.folders].sort((a, b) => a.name.localeCompare(b.name)) : []),
    [c],
  );
  const sortedFiles = useMemo(
    () => (c ? sortFiles(c.files, sortMode) : []),
    [c, sortMode],
  );

  const isPendingHere =
    pendingFolder !== null && pendingFolder.parent === parentPath;

  if (isLoading) {
    return (
      <div
        className="px-3 py-2 text-xs text-text-muted"
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
      >
        {tFile("loading")}
      </div>
    );
  }

  return (
    <ul className="flex flex-col">
      {err && (
        <li
          className="mb-1 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400"
          style={{ marginLeft: `${depth * 12}px` }}
        >
          {err}
        </li>
      )}
      {isPendingHere && (
        <li style={{ paddingLeft: `${depth * 12}px` }}>
          <FolderInputRow
            inputRef={folderInputRef}
            disabled={creating}
            onSubmit={(name) => onSubmitPendingFolder(name)}
            onCancel={() => onPendingFolderChange(null)}
          />
        </li>
      )}
      {sortedFolders.map((f) => (
        <FolderRow
          key={`dir:${f.path}`}
          folder={f}
          depth={depth}
          expanded={expanded.has(f.path)}
          isSelected={selectedFolderPath === f.path}
          isDropTarget={dropTargetPath === f.path}
          isDragging={draggedItem?.kind === "folder" && draggedItem.item.path === f.path}
          isRenaming={renamingId === f.path}
          onToggle={() => onToggle(f.path)}
          onOpenFolder={() => onOpenFolder?.(f.path, f.name)}
          onCreateNote={() => onCreateNote(f.path)}
          onStartCreateFolder={() => onStartCreateFolder(f.path)}
          onContextMenu={(e) => onContextMenu(e, { kind: "folder", item: f })}
          onDragStart={() => onDragStart({ kind: "folder", item: f })}
          onDragEnd={onDragEnd}
          onDragOver={(e) => {
            if (!draggedItem) return;
            if (isAncestorOrSelf(f.path, draggedItem)) return;
            e.preventDefault();
            onDragOver(f.path);
          }}
          onDragLeave={() => onDragOver(null)}
          onDrop={async (e) => {
            e.preventDefault();
            onDragOver(null);
            if (!draggedItem) return;
            if (isAncestorOrSelf(f.path, draggedItem)) return;
            await onDrop(draggedItem, f.path);
          }}
          onCommitRename={(newName) => onCommitRenameFolder(f.path, newName)}
          onCancelRename={onCancelRename}
          childContent={
            expanded.has(f.path) ? (
              <FolderBody
                {...props}
                parentPath={f.path}
                depth={depth + 1}
              />
            ) : null
          }
        />
      ))}
      {sortedFiles.map((f) => {
        const isActive = f.id === selectedFileId;
        const isDragging =
          draggedItem?.kind === "file" && draggedItem.item.id === f.id;
        const isRenaming = renamingId === f.id;
        return (
          <li
            key={f.id}
            style={{ paddingLeft: `${depth * 12}px` }}
            draggable={!isRenaming}
            onDragStart={() => !isRenaming && onDragStart({ kind: "file", item: f })}
            onDragEnd={onDragEnd}
            className={[
              "group",
              isDragging || moving ? "opacity-40" : "",
            ].join(" ")}
          >
            {isRenaming ? (
              <InlineRenameInput
                defaultValue={f.title || f.filename.replace(/\.md$/i, "")}
                onCommit={(newName) =>
                  onCommitRenameFile(f.id, newName, f.folder_path)
                }
                onCancel={onCancelRename}
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelectFile(f)}
                onContextMenu={(e) =>
                  onContextMenu(e, { kind: "file", item: f })
                }
                onDoubleClick={() => {
                  // double-click to rename
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                  isActive
                    ? "bg-accent/15 text-text-primary"
                    : "text-text-primary hover:bg-bg-elevated"
                }`}
              >
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  <FileText
                    size={14}
                    className={isActive ? "text-accent" : "text-text-muted"}
                  />
                </span>
                <span className="flex-1 truncate text-sm">
                  {f.title || f.filename.replace(/\.md$/i, "")}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onContextMenu(e, { kind: "file", item: f });
                  }}
                  aria-label="More options"
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-bg-card hover:text-text-primary"
                >
                  <MoreHorizontal size={12} />
                </button>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FolderRow({
  folder,
  depth,
  expanded,
  isSelected,
  isDropTarget,
  isDragging,
  isRenaming,
  onToggle,
  onOpenFolder,
  onCreateNote,
  onStartCreateFolder,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onCommitRename,
  onCancelRename,
  childContent,
}: {
  folder: CoreFolderItem;
  depth: number;
  expanded: boolean;
  isSelected: boolean;
  isDropTarget: boolean;
  isDragging: boolean;
  isRenaming: boolean;
  onToggle: () => void;
  onOpenFolder: () => void;
  onCreateNote: () => void;
  onStartCreateFolder: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => Promise<void>;
  onCommitRename: (newName: string) => void;
  onCancelRename: () => void;
  childContent: React.ReactNode;
}) {
  const tFile = useTranslations("knowledge.fileList");
  return (
    <li className={isDragging ? "opacity-40" : ""}>
      <div
        className={[
          "group flex items-center gap-1 rounded-md pr-1",
          isDropTarget
            ? "ring-2 ring-accent bg-accent/10"
            : isSelected
              ? "bg-bg-elevated"
              : "hover:bg-bg-elevated",
        ].join(" ")}
        style={{ paddingLeft: `${depth * 12}px` }}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={(e) => void onDrop(e)}
        onContextMenu={onContextMenu}
      >
        {/* Chevron button: expand/collapse only */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "折りたたむ" : "展開する"}
          className="flex h-7 w-6 flex-shrink-0 items-center justify-center text-text-muted hover:text-text-primary"
        >
          {expanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>

        {/* Folder name button: opens FolderView */}
        {isRenaming ? (
          <InlineRenameInput
            defaultValue={folder.name}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        ) : (
          <button
            type="button"
            onClick={onOpenFolder}
            onContextMenu={onContextMenu}
            className={`flex flex-1 items-center gap-1.5 overflow-hidden rounded-md px-1 py-1.5 text-left transition-colors ${
              isSelected ? "font-medium text-text-primary" : "text-text-primary"
            }`}
          >
            <Folder
              size={14}
              className={`flex-shrink-0 ${isSelected ? "text-accent" : "text-accent/70"}`}
            />
            <span className="flex-1 truncate text-sm">{folder.name}</span>
          </button>
        )}

        {/* Hover action buttons */}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCreateNote();
            }}
            title={tFile("newFileHere")}
            aria-label={tFile("newFileHere")}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-bg-card hover:text-text-primary"
          >
            <FilePlus size={12} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartCreateFolder();
            }}
            title={tFile("newFolderHere")}
            aria-label={tFile("newFolderHere")}
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-bg-card hover:text-text-primary"
          >
            <FolderPlus size={12} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu(e);
            }}
            aria-label="More options"
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-bg-card hover:text-text-primary"
          >
            <MoreHorizontal size={12} />
          </button>
        </div>
      </div>
      {childContent}
    </li>
  );
}

function InlineRenameInput({
  defaultValue,
  onCommit,
  onCancel,
}: {
  defaultValue: string;
  onCommit: (newName: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim()) onCommit(value);
        else onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (value.trim()) onCommit(value);
          else onCancel();
        } else if (e.key === "Escape") {
          onCancel();
        }
      }}
      className="flex-1 rounded bg-bg-primary px-1 py-0.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
    />
  );
}

function FolderInputRow({
  inputRef,
  disabled,
  onSubmit,
  onCancel,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const tFile = useTranslations("knowledge.fileList");
  const [value, setValue] = useState("");
  return (
    <div className="mb-1 ml-4 flex items-center gap-2 rounded-md bg-bg-elevated px-2 py-1.5">
      <Folder size={14} className="flex-shrink-0 text-text-muted" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (disabled) return;
          if (!value.trim()) onCancel();
          else onSubmit(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value);
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        disabled={disabled}
        placeholder={tFile("newFolderPlaceholder")}
        className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
      />
    </div>
  );
}

function VaultHeader({
  drive,
  vaults,
  active,
  onSwitch,
  onAddNew,
}: {
  drive: string;
  vaults: Vault[];
  active: Vault;
  onSwitch: (v: Vault) => void;
  onAddNew: () => void;
}) {
  const t = useTranslations("knowledge.switcher");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function handlePick(v: Vault) {
    setOpen(false);
    if (v.id === active.id) return;
    const updated = await activateVault(drive, v.id);
    onSwitch(updated);
  }

  return (
    <div ref={ref} className="relative border-b border-bg-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-3 text-left hover:bg-bg-elevated"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
          <span className="text-sm font-semibold">
            {active.label.slice(0, 1).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text-primary">
            {active.label}
          </div>
          <div className="truncate text-xs text-text-muted">
            {active.drive}
            {active.path ? ` / ${active.path}` : ""}
          </div>
        </div>
        <ChevronsUpDown size={14} className="flex-shrink-0 text-text-muted" />
      </button>
      {open && (
        <div className="absolute left-2 right-2 top-full z-20 mt-1 overflow-hidden rounded-lg border border-bg-border bg-bg-elevated shadow-xl animate-fade-in-scale">
          <ul className="max-h-72 overflow-y-auto py-1">
            {vaults.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => handlePick(v)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-bg-primary/60"
                >
                  <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {v.id === active.id && (
                      <Check size={14} className="text-accent" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {v.label}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {v.drive}
                      {v.path ? ` / ${v.path}` : ""}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onAddNew();
            }}
            className="flex w-full items-center gap-2 border-t border-bg-border px-3 py-2 text-sm font-medium text-accent hover:bg-bg-primary/60"
          >
            <Plus size={14} />
            {t("addNew")}
          </button>
        </div>
      )}
    </div>
  );
}

function SearchResults({
  searching,
  hits,
  truncated,
  onPick,
  selectedFileId,
}: {
  searching: boolean;
  hits: SearchHit[] | null;
  truncated: boolean;
  onPick: (h: SearchHit) => void;
  selectedFileId: string | null;
}) {
  const t = useTranslations("knowledge.search");
  if (searching && hits === null) {
    return (
      <div className="px-4 py-6 text-center text-xs text-text-muted">
        {t("searching")}
      </div>
    );
  }
  if (hits === null) return null;
  if (hits.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-text-muted">
        {t("noResults")}
      </div>
    );
  }
  return (
    <div className="p-2">
      <ul className="flex flex-col gap-0.5">
        {hits.map((hit) => {
          const isActive = hit.file_id === selectedFileId;
          return (
            <li key={hit.file_id}>
              <button
                type="button"
                onClick={() => onPick(hit)}
                className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                  isActive ? "bg-accent/15" : "hover:bg-bg-elevated"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <FileText
                    size={13}
                    className={isActive ? "text-accent" : "text-text-muted"}
                  />
                  <span className="truncate">
                    {hit.title || hit.filename}
                  </span>
                </span>
                {hit.snippet && (
                  <span className="ml-5 line-clamp-2 text-xs text-text-muted">
                    {hit.snippet}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {truncated && (
        <div className="mt-2 px-2 text-center text-[11px] text-text-muted">
          {t("truncated")}
        </div>
      )}
    </div>
  );
}
