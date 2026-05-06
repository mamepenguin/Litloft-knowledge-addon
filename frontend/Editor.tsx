"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Columns,
  Eye,
  Loader2,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { useShortcuts } from "@/hooks/useShortcuts";
import {
  ConflictError,
  getFileContent,
  putFileContent,
  renameFile,
} from "./api";
import EditorToolbar, {
  applyEditorAction,
  type EditorAction,
} from "./EditorToolbar";
import FileLinkModal from "./FileLinkModal";
import { applyIndent } from "./editorIndent";

interface Props {
  fileId: string;
  filename: string;
  /**
   * The drive this note lives on. Needed for drive-scoped tag
   * autocomplete in the preview pane's Properties Panel. Knowledge
   * notes are always ``.md`` so ``mime_type`` is implied and does
   * not need to be plumbed.
   */
  drive: string;
  onBack: () => void;
  onRenamed?: (newFilename: string) => void;
  onDelete?: () => void;
  sidebarHidden?: boolean;
  onToggleSidebar?: () => void;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

type ViewMode = "edit" | "split" | "preview";

const VIEW_MODE_ROTATION: ViewMode[] = ["edit", "split", "preview"];

const AUTOSAVE_DEBOUNCE_MS = 2000;

export default function Editor({
  fileId,
  filename,
  drive,
  onBack,
  onRenamed,
  onDelete,
  sidebarHidden,
  onToggleSidebar,
}: Props) {
  const t = useTranslations("knowledge.editor");
  const tSide = useTranslations("knowledge.sidebar");
  const tShortcuts = useTranslations("knowledge.shortcuts");
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const etagRef = useRef<string>("");
  const lastSavedRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fileLinkModalOpen, setFileLinkModalOpen] = useState(false);
  const savedSelRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setLoadError(null);
    getFileContent(fileId)
      .then(({ content: c, etag }) => {
        if (cancelled) return;
        etagRef.current = etag;
        lastSavedRef.current = c;
        setContent(c);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const performSave = useCallback(
    async (text: string) => {
      setSaveState({ kind: "saving" });
      try {
        const newEtag = await putFileContent(fileId, text, etagRef.current);
        etagRef.current = newEtag;
        lastSavedRef.current = text;
        setSaveState({ kind: "saved", at: Date.now() });
        // Propagate frontmatter tag changes to core File.tags without
        // waiting for the scanner's hourly pass. Every save fires this
        // (idempotent — the scanner just reparses frontmatter). The
        // core FilePreview's chip-edit path does the same trigger via
        // saveFileTags; this covers the Editor's textarea path.
        void fetch(
          `/api/addons/knowledge/resync-tags/${encodeURIComponent(fileId)}`,
          { method: "POST", credentials: "include" },
        ).catch(() => {
          // Best-effort; the scanner's hourly pass is the fallback.
        });
      } catch (err) {
        if (err instanceof ConflictError) {
          setSaveState({ kind: "conflict" });
        } else {
          setSaveState({
            kind: "error",
            message: (err as Error).message,
          });
        }
      }
    },
    [fileId],
  );

  const contentRef = useRef<string | null>(null);
  contentRef.current = content;

  useEffect(() => {
    if (content === null) return;
    if (content === lastSavedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      performSave(content);
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [content, performSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const latest = contentRef.current;
      if (latest !== null && latest !== lastSavedRef.current) {
        performSave(latest);
      }
    };
  }, [performSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.currentTarget.blur();
        return;
      }
      if (e.key !== "Tab") return;
      e.preventDefault();
      const ta = e.currentTarget;
      const { text, selStart, selEnd } = applyIndent(
        ta.value,
        ta.selectionStart,
        ta.selectionEnd,
        e.shiftKey,
      );
      setContent(text);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(selStart, selEnd);
      });
    },
    [],
  );

  const handleToolbar = useCallback((action: EditorAction) => {
    const ta = textareaRef.current;
    if (!ta || content === null) return;
    const { text, selStart, selEnd } = applyEditorAction(
      ta.value,
      ta.selectionStart,
      ta.selectionEnd,
      action,
    );
    setContent(text);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  }, [content]);

  const handleFileLinkRequest = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      savedSelRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
    }
    setFileLinkModalOpen(true);
  }, []);

  const handleFileLinkInsert = useCallback(
    ({ filename, fileId }: { filename: string; fileId: string }) => {
      setFileLinkModalOpen(false);
      const ta = textareaRef.current;
      if (!ta || content === null) return;
      const sel = savedSelRef.current ?? { start: ta.selectionStart, end: ta.selectionEnd };
      const inserted = `[${filename}](loft://${fileId})`;
      const newText = content.slice(0, sel.start) + inserted + content.slice(sel.end);
      const cursor = sel.start + inserted.length;
      setContent(newText);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(cursor, cursor);
      });
    },
    [content],
  );

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const latest = contentRef.current;
    if (latest !== null && latest !== lastSavedRef.current) {
      void performSave(latest);
    }
  }, [performSave]);

  const cycleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const idx = VIEW_MODE_ROTATION.indexOf(prev);
      const next = VIEW_MODE_ROTATION[(idx + 1) % VIEW_MODE_ROTATION.length];
      return next;
    });
  }, []);

  useShortcuts(
    "knowledge-editor",
    tShortcuts("knowledgeEditor"),
    [
      { key: "ctrl+s", label: tShortcuts("save"), handler: flushSave, editingOnly: true },
      {
        key: "ctrl+b",
        label: tShortcuts("bold"),
        handler: () =>
          handleToolbar({ kind: "wrap", before: "**", after: "**" }),
        editingOnly: true,
      },
      {
        key: "ctrl+i",
        label: tShortcuts("italic"),
        handler: () => handleToolbar({ kind: "wrap", before: "*", after: "*" }),
        editingOnly: true,
      },
      {
        key: "ctrl+k",
        label: tShortcuts("insertLink"),
        handler: () => handleToolbar({ kind: "link" }),
        editingOnly: true,
      },
      {
        key: "ctrl+e",
        label: tShortcuts("inlineCode"),
        handler: () => handleToolbar({ kind: "wrap", before: "`", after: "`" }),
        editingOnly: true,
      },
      {
        key: "ctrl+shift+k",
        label: tShortcuts("codeBlock"),
        handler: () => handleToolbar({ kind: "codeblock" }),
        editingOnly: true,
      },
      {
        key: "ctrl+shift+\\",
        label: tShortcuts("cycleViewMode"),
        handler: cycleViewMode,
        editingOnly: false,
      },
    ],
    content !== null,
  );

  async function handleReloadFromServer() {
    try {
      const { content: c, etag } = await getFileContent(fileId);
      etagRef.current = etag;
      lastSavedRef.current = c;
      setContent(c);
      setSaveState({ kind: "idle" });
    } catch (e) {
      setSaveState({ kind: "error", message: (e as Error).message });
    }
  }

  async function handleOverwrite() {
    if (content === null) return;
    try {
      const { etag } = await getFileContent(fileId);
      etagRef.current = etag;
      await performSave(content);
    } catch (e) {
      setSaveState({ kind: "error", message: (e as Error).message });
    }
  }

  function handleDelete() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (contentRef.current !== null) {
      lastSavedRef.current = contentRef.current;
    }
    onDelete?.();
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-red-400">
        {t("loadFailed", { error: loadError })}
      </div>
    );
  }
  if (content === null) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin" />
        {t("loading")}
      </div>
    );
  }

  const displayName = filename.replace(/\.md$/i, "");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-bg-border px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-text-primary md:hidden"
          aria-label={t("back")}
        >
          <ArrowLeft size={16} />
        </button>
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="hidden h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-text-primary md:inline-flex"
            aria-label={sidebarHidden ? tSide("show") : tSide("hide")}
            aria-pressed={sidebarHidden}
            title={sidebarHidden ? tSide("show") : tSide("hide")}
          >
            {sidebarHidden ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <TitleField
            fileId={fileId}
            displayName={displayName}
            onRenamed={onRenamed}
          />
        </div>
        <SaveIndicator state={saveState} />
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
        {onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            aria-label={t("delete")}
            title={t("delete")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 size={14} />
          </button>
        )}
      </header>

      {viewMode !== "preview" && (
        <EditorToolbar onAction={handleToolbar} onFileLinkRequest={handleFileLinkRequest} />
      )}

      {/* Keep both panes permanently mounted so that mermaid diagrams and other
          stateful DOM do not get destroyed when switching view modes.
          CSS visibility (hidden / display:none via Tailwind) controls what the
          user sees instead of conditional rendering. */}
      <div
        className={`grid flex-1 min-h-0 ${
          viewMode === "split" ? "md:grid-cols-2" : "grid-cols-1"
        }`}
      >
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className={`h-full w-full resize-none bg-bg-primary px-8 py-6 font-mono text-[13.5px] leading-relaxed text-text-primary focus:outline-none ${
            viewMode === "split" ? "border-r border-bg-border" : ""
          } ${viewMode === "preview" ? "hidden" : ""}`}
          aria-label={t("editArea")}
          placeholder={t("placeholder")}
        />
        <div className={`h-full overflow-auto bg-bg-primary px-8 py-6 ${viewMode === "edit" ? "hidden" : ""}`}>
          <div className="mx-auto max-w-3xl">
            <MarkdownPreview
              source={content}
              className="h-full"
              drive={drive}
              editable={{
                id: fileId,
                mime_type: "text/markdown",
                filename,
                drive,
              }}
              onSourceChange={setContent}
            />
          </div>
        </div>
      </div>

      {saveState.kind === "conflict" && (
        <ConflictModal
          onReload={handleReloadFromServer}
          onOverwrite={handleOverwrite}
          onDismiss={() => setSaveState({ kind: "idle" })}
        />
      )}
      {fileLinkModalOpen && (
        <FileLinkModal
          drive={drive}
          onSelect={handleFileLinkInsert}
          onClose={() => setFileLinkModalOpen(false)}
        />
      )}
    </div>
  );
}

function TitleField({
  fileId,
  displayName,
  onRenamed,
}: {
  fileId: string;
  displayName: string;
  onRenamed?: (newFilename: string) => void;
}) {
  const t = useTranslations("knowledge.editor.title");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(displayName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setValue(displayName);
  }, [displayName, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  async function commit() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === displayName) {
      setEditing(false);
      setValue(displayName);
      setError(null);
      return;
    }
    const clean = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
    setSaving(true);
    setError(null);
    try {
      const updated = await renameFile(fileId, clean);
      onRenamed?.(updated.filename);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={t("editHint")}
        className="block w-full truncate rounded px-1 py-0.5 text-left text-base font-semibold text-text-primary hover:bg-bg-elevated"
      >
        {displayName}
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      className="flex items-center gap-2"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (!saving) commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setEditing(false);
            setValue(displayName);
            setError(null);
          }
        }}
        disabled={saving}
        aria-label={t("label")}
        className="w-full rounded border border-bg-border bg-bg-primary px-2 py-1 text-base font-semibold text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {error && (
        <span className="text-xs text-red-400" title={error}>
          <AlertCircle size={12} />
        </span>
      )}
    </form>
  );
}

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  const t = useTranslations("knowledge.editor.view");
  const options: { id: ViewMode; icon: typeof Pencil; label: string }[] = [
    { id: "edit", icon: Pencil, label: t("edit") },
    { id: "split", icon: Columns, label: t("split") },
    { id: "preview", icon: Eye, label: t("preview") },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-bg-border bg-bg-card p-0.5">
      {options.map((o) => {
        const Icon = o.icon;
        const isActive = mode === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-label={o.label}
            title={o.label}
            aria-pressed={isActive}
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              isActive
                ? "bg-bg-elevated text-text-primary"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const t = useTranslations("knowledge.editor.status");
  if (state.kind === "idle") return <span className="w-16" />;
  if (state.kind === "saving")
    return (
      <span className="flex items-center gap-1 text-xs text-text-muted">
        <Loader2 size={12} className="animate-spin" />
        {t("saving")}
      </span>
    );
  if (state.kind === "saved")
    return (
      <span className="flex items-center gap-1 text-xs text-text-muted">
        <CheckCircle2 size={12} className="text-accent-teal" />
        {t("saved")}
      </span>
    );
  if (state.kind === "conflict")
    return (
      <span className="flex items-center gap-1 text-xs text-red-400">
        <AlertCircle size={12} />
        {t("conflict")}
      </span>
    );
  return (
    <span
      className="flex max-w-[180px] items-center gap-1 truncate text-xs text-red-400"
      title={state.message}
    >
      <AlertCircle size={12} />
      {state.message}
    </span>
  );
}

function ConflictModal({
  onReload,
  onOverwrite,
  onDismiss,
}: {
  onReload: () => void;
  onOverwrite: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("knowledge.editor.conflict");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in">
      <div className="w-full max-w-md rounded-xl border border-bg-border bg-bg-card p-6 shadow-2xl animate-fade-in-scale">
        <div className="mb-3 flex items-center gap-2 text-red-400">
          <AlertCircle size={18} />
          <h3 className="text-base font-semibold text-text-primary">
            {t("title")}
          </h3>
        </div>
        <p className="mb-6 text-sm text-text-muted">{t("description")}</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onReload}
            className="rounded-md bg-accent-cta px-4 py-2 text-sm font-medium text-white hover:bg-accent"
          >
            {t("reload")}
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            className="rounded-md border border-bg-border bg-bg-elevated px-4 py-2 text-sm text-text-primary hover:border-accent/40"
          >
            {t("overwrite")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-4 py-2 text-sm text-text-muted hover:bg-bg-elevated"
          >
            {t("dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
