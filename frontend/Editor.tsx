"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ArrowLeft } from "lucide-react";
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

const AUTOSAVE_DEBOUNCE_MS = 2000;

export default function Editor({ fileId, filename, onBack }: Props) {
  const t = useTranslations("knowledge.editor");
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
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

  // On unmount, flush any pending unsaved changes instead of discarding
  // the debounce timer. The save runs in the background — we can't await
  // it inside a React cleanup — but the PUT is fire-and-forget at that
  // point, which is the best we can do without a beforeunload guard.
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
    // Restore selection after React re-renders
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
      <div className="p-6 text-accent-danger">
        {t("loadFailed", { error: loadError })}
      </div>
    );
  }
  if (content === null) {
    return <div className="p-6 text-text-muted">{t("loading")}</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <header className="flex items-center justify-between border-b border-border-default bg-surface-elevated px-4 py-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft size={16} />
          {t("back")}
        </button>
        <span className="text-sm font-medium text-text-primary">{filename}</span>
        <SaveIndicator state={saveState} />
      </header>

      <EditorToolbar onAction={handleToolbar} />

      <div className="grid flex-1 min-h-0 md:grid-cols-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="h-full w-full resize-none border-r border-border-default bg-surface-base p-4 font-mono text-sm text-text-primary focus:outline-none"
          aria-label={t("editArea")}
        />
        <div className="h-full overflow-auto bg-surface-base">
          <MarkdownPreview source={content} />
        </div>
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

function SaveIndicator({ state }: { state: SaveState }) {
  const t = useTranslations("knowledge.editor.status");
  if (state.kind === "idle") return null;
  if (state.kind === "saving")
    return <span className="text-xs text-text-muted">{t("saving")}</span>;
  if (state.kind === "saved")
    return <span className="text-xs text-text-muted">{t("saved")}</span>;
  if (state.kind === "conflict")
    return <span className="text-xs text-accent-danger">{t("conflict")}</span>;
  return <span className="text-xs text-accent-danger">{state.message}</span>;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-surface-elevated p-6 shadow-xl">
        <h3 className="mb-2 text-lg font-bold text-text-primary">
          {t("title")}
        </h3>
        <p className="mb-6 text-sm text-text-secondary">{t("description")}</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onReload}
            className="rounded bg-accent-cta px-4 py-2 text-sm font-medium text-white"
          >
            {t("reload")}
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            className="rounded border border-border-default px-4 py-2 text-sm text-text-primary hover:bg-surface-hover"
          >
            {t("overwrite")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded px-4 py-2 text-sm text-text-muted hover:bg-surface-hover"
          >
            {t("dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
