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
  Pencil,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import {
  ConflictError,
  getFileContent,
  putFileContent,
} from "./api";
import EditorToolbar, {
  applyEditorAction,
  type EditorAction,
} from "./EditorToolbar";

interface Props {
  fileId: string;
  filename: string;
  onBack: () => void;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

type ViewMode = "edit" | "split" | "preview";

const AUTOSAVE_DEBOUNCE_MS = 2000;

export default function Editor({ fileId, filename, onBack }: Props) {
  const t = useTranslations("knowledge.editor");
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const etagRef = useRef<string>("");
  const lastSavedRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-text-primary">
            {displayName}
          </h1>
        </div>
        <SaveIndicator state={saveState} />
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
      </header>

      {viewMode !== "preview" && <EditorToolbar onAction={handleToolbar} />}

      <div
        className={`grid flex-1 min-h-0 ${
          viewMode === "split" ? "md:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {viewMode !== "preview" && (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className={`h-full w-full resize-none bg-bg-primary px-8 py-6 font-mono text-[13.5px] leading-relaxed text-text-primary focus:outline-none ${
              viewMode === "split" ? "border-r border-bg-border" : ""
            }`}
            aria-label={t("editArea")}
            placeholder={t("placeholder")}
          />
        )}
        {viewMode !== "edit" && (
          <div className="h-full overflow-auto bg-bg-primary px-8 py-6">
            <div className="mx-auto max-w-3xl">
              <MarkdownPreview source={content} />
            </div>
          </div>
        )}
      </div>

      {saveState.kind === "conflict" && (
        <ConflictModal
          onReload={handleReloadFromServer}
          onOverwrite={handleOverwrite}
          onDismiss={() => setSaveState({ kind: "idle" })}
        />
      )}
    </div>
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
