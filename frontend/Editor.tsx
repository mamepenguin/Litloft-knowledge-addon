"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import matter from "gray-matter";
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
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { markdownContentRegistry } from "@/lib/markdownContentRegistry";
import { useDirty } from "@/hooks/useDirty";
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
  /**
   * Display name shown in the rename field. Optional in inline mode
   * (the host already shows the title in its own h1) — when omitted,
   * the editor fetches it lazily from ``/api/files/{id}`` so a
   * caller that only knows the id (the file-detail slot) doesn't
   * need to plumb metadata through.
   */
  filename?: string;
  /**
   * The drive this note lives on. Needed for drive-scoped tag
   * autocomplete in the preview pane's Properties Panel. Knowledge
   * notes are always ``.md`` so ``mime_type`` is implied and does
   * not need to be plumbed.
   */
  drive: string;
  /**
   * Optional in inline mode (no back button is rendered there); the
   * Knowledge ``Page.tsx`` host still passes a real handler.
   */
  onBack?: () => void;
  onRenamed?: (newFilename: string) => void;
  onDelete?: () => void;
  sidebarHidden?: boolean;
  onToggleSidebar?: () => void;
  /**
   * Phase 2 of the right-pane equivalence spec
   * (docs/superpowers/specs/2026-05-09-right-pane-full-detail.md
   * §4.2.2). When the editor mounts inside the 2-pane right pane via
   * ``KnowledgeEditSection``, the surrounding ``FileDetailContent``
   * already provides the title, breadcrumb, delete affordance and
   * sidebar — re-rendering them here would compete for the same
   * space. ``inlineMode`` strips those bits and lets the editor body
   * (toolbar + textarea/preview) sit flush inside the slot.
   *
   * Also publishes dirty state into ``dirtyRegistry`` (always; the
   * registry is harmless when nothing reads it). The Knowledge
   * ``Page.tsx`` host doesn't currently subscribe but it will once
   * the Phase 2.2 navigation guard ships.
   */
  inlineMode?: boolean;
  /**
   * Phase 2 PR-3 (case P): when ``KnowledgeEditSection`` mounts the
   * editor in response to ``?file={id}&edit=1`` (the canonical URL
   * that ``useCreateFile`` now resolves to), focus the textarea once
   * the content has loaded so the user lands directly in the edit
   * surface. Re-fires when ``fileId`` changes — navigating between
   * notes with ``?edit=1`` keeps focus on the textarea.
   */
  autoFocus?: boolean;
  /**
   * MarkdownDocumentLayout canvas integration: stretch to the full
   * available height instead of the inline-mode 70vh cap. The cap was
   * introduced for the legacy vertical stack so a 5,000-line note
   * wouldn't push other sections off-screen — but in the document
   * layout the canvas IS the editor's home and should fill it
   * (spec 2026-05-10 §3 / E15 fix).
   */
  fillHeight?: boolean;
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
  inlineMode,
  fillHeight,
  autoFocus,
}: Props) {
  const t = useTranslations("knowledge.editor");
  const tSide = useTranslations("knowledge.sidebar");
  const tShortcuts = useTranslations("knowledge.shortcuts");
  const [content, setContent] = useState<string | null>(null);
  // Phase 4 (spec §D5 / hako sFXCwZDluTPZZkbYuozwJ): track mobile
  // breakpoint so the view-mode toggle can drop the "split" option.
  // Split makes no sense at <768px (textarea + preview side-by-side
  // would each be ~half of a 375px viewport). Already implicit in the
  // Knowledge Page.tsx host; centralised here so the inline-mounted
  // Editor in FileDetailContent also gets the right toggle set.
  const [isMobileWidth, setIsMobileWidth] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768;
  });
  useEffect(() => {
    function handleResize() {
      setIsMobileWidth(window.innerWidth < 768);
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  // When the host doesn't know the filename (e.g. KnowledgeEditSection
  // only has fileId + drive from the slot props), fetch it ourselves
  // so the rename field and the .md-stripped display name still work.
  const [fetchedFilename, setFetchedFilename] = useState<string | null>(null);
  useEffect(() => {
    if (filename !== undefined) return;
    setFetchedFilename(null);
    let cancelled = false;
    fetch(`/api/files/${encodeURIComponent(fileId)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { filename?: string } | null) => {
        if (!cancelled && data?.filename) setFetchedFilename(data.filename);
      })
      .catch(() => {
        // Falls through to the empty-string fallback below; rename
        // field is hidden in inlineMode anyway.
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, filename]);
  const effectiveFilename = filename ?? fetchedFilename ?? "";
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  // Snap viewMode out of "split" whenever the viewport drops below
  // the mobile threshold. We prefer "preview" over bouncing back to
  // "edit" — the user was already on a "see the rendered note"
  // intent, so keep them there.
  //
  // Intentionally one-way (Phase 4 review M3, hako 5rtHKXzQd9VJY7WNU5Deg):
  // an iPad rotated portrait → landscape will not return to "split"
  // automatically. We chose not to remember the user's last desktop
  // viewMode separately because the natural usage pattern is "the
  // user picks a mode and stays in it"; auto-restoring "split"
  // after a transient rotation would feel like the toolbar twitched
  // on its own. If a user wants split back they can tap the toggle.
  useEffect(() => {
    if (isMobileWidth && viewMode === "split") {
      setViewMode("preview");
    }
  }, [isMobileWidth, viewMode]);
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

  const autoFocusedFileIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoFocus) return;
    if (content === null) return;
    if (autoFocusedFileIdRef.current === fileId) return;
    const ta = textareaRef.current;
    if (!ta) return;
    autoFocusedFileIdRef.current = fileId;
    ta.focus();
  }, [autoFocus, content, fileId]);

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
        // Signal the host (FileDetailContent) to refetch File.tags.
        // Closes the content-mode UX gap where chip edits + immediate
        // navigation left the file detail page sitting on a stale
        // tags array until the next navigation (hako 0RnZ1KdtomAfIJPLAGIHA).
        markdownContentRegistry.notifySaved(fileId);
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

  // Publish dirty state into the global registry so the Phase 2.2
  // navigation guard / browser unload handler can ask "would
  // navigating away discard unsaved work?". Always on (not gated on
  // inlineMode) — the registry is harmless when nothing reads it,
  // and keeping the contract uniform across the two hosts means the
  // legacy /addons/knowledge route benefits the moment the guard
  // rolls out.
  const isDirty =
    content !== null && content !== lastSavedRef.current;
  useDirty({ fileId, source: "knowledge-editor", dirty: isDirty });

  // Phase 3.5 (spec 2026-05-10 §D2 / hako ZWLqXgdTwt9le4dAI3U8C):
  // expose the editor's content as a (getContent, setContent) pair
  // so the inspector's EditableTagChips can run in content-mode and
  // mutate this same string instead of doing its own GET/PUT round
  // trip. Single writer (the editor's textarea autosave) owns the
  // server etag, eliminating the inspector-vs-editor race.
  //
  // Only published once content has loaded (the registry contract
  // expects getContent() to return the actual current string, not
  // null). Re-registering on every render is fine — register()
  // replaces the entry, so the closure captured `setContent` here
  // is always current. The inner ref capture lets getContent() see
  // the latest content even though the effect only re-runs when the
  // file or load state changes.
  useEffect(() => {
    if (content === null) return;
    const dispose = markdownContentRegistry.register(fileId, {
      getContent: () => contentRef.current ?? "",
      setContent: (next) => setContent(next),
    });
    return dispose;
    // ``content === null`` flips exactly once (load complete); after
    // that the entry stays registered until unmount. Subsequent
    // content edits flow through the ref without re-running this
    // effect, which keeps the registration stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, content === null]);

  // Pulse the registry on every content change so FileDetailContent
  // (subscribed via useSyncExternalStore) re-reads `getContent()` and
  // pushes a fresh `content` prop into the inspector's content-mode
  // tag chips. Without this, the chip's internal ref captures stale
  // content at click time, which is exactly the race Phase 3.5 set
  // out to close.
  useEffect(() => {
    if (content === null) return;
    markdownContentRegistry.touchContent(fileId);
  }, [fileId, content]);

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

  // Phase 3 fm-card (spec 2026-05-10 §D2 / hako B5QG4AcZjbn47MDErmQAO):
  // parse the editor content into a frontmatter dict + body string so
  // the preview pane can render a pinned PropertiesPanel above the
  // body and pass only the body to MarkdownPreview. PropertiesPanel
  // collapses to null on empty frontmatter, but the mocked test
  // double in unit tests does not — so we also guard the JSX with
  // ``hasFrontmatter`` to avoid rendering an empty wrapper above an
  // .md that has no metadata. Declared above the loadError /
  // content === null early returns to keep hook order stable across
  // renders.
  const { frontmatter, body, hasFrontmatter, yamlError } = useMemo(() => {
    if (content === null) {
      return {
        frontmatter: {} as Record<string, unknown>,
        body: "",
        hasFrontmatter: false,
        yamlError: null as string | null,
      };
    }
    try {
      const parsed = matter(content);
      const fm = parsed.data as Record<string, unknown>;
      return {
        frontmatter: fm,
        body: parsed.content,
        hasFrontmatter: Object.keys(fm).length > 0,
        yamlError: null as string | null,
      };
    } catch (err) {
      // Malformed YAML — fall back to treating the whole document as
      // body. The textarea still shows the broken YAML so the user
      // can fix it. Surface the parse error to the preview pane so the
      // user knows why the fm-card disappeared (Phase 3 review
      // follow-up, hako ZWLqXgdTwt9le4dAI3U8C).
      const message = err instanceof Error ? err.message : String(err);
      return {
        frontmatter: {} as Record<string, unknown>,
        body: content,
        hasFrontmatter: false,
        yamlError: message,
      };
    }
  }, [content]);

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

  const displayName = effectiveFilename.replace(/\.md$/i, "");

  // Inline mode collapses the chrome down to status + view-mode
  // toggle; the host (FileDetailContent) already shows the title,
  // breadcrumb, delete affordance and sidebar. The default inline
  // layout is height-bounded so a 5,000-line note doesn't push other
  // sections off-screen in the legacy vertical stack. ``fillHeight``
  // opts into the document-layout canvas where the editor scrolls
  // together with the canvas footer in a single scroll context —
  // no flex-1, no max-h, no internal overflow. Just natural size.
  let containerClass: string;
  if (inlineMode && fillHeight) {
    containerClass = "flex flex-col";
  } else if (inlineMode) {
    containerClass = "flex max-h-[70vh] min-h-[24rem] flex-col";
  } else {
    containerClass = "flex min-h-0 flex-1 flex-col";
  }

  return (
    <div className={containerClass}>
      {inlineMode ? (
        <div className="flex items-center justify-end gap-2 border-b border-bg-border px-2 py-1.5">
          <SaveIndicator state={saveState} />
          <ViewModeToggle mode={viewMode} onChange={setViewMode} hideSplit={isMobileWidth} />
        </div>
      ) : (
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
          <ViewModeToggle mode={viewMode} onChange={setViewMode} hideSplit={isMobileWidth} />
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
      )}

      {viewMode !== "preview" && (
        <EditorToolbar onAction={handleToolbar} onFileLinkRequest={handleFileLinkRequest} />
      )}

      {/* Keep both panes permanently mounted so that mermaid diagrams and other
          stateful DOM do not get destroyed when switching view modes.
          CSS visibility (hidden / display:none via Tailwind) controls what the
          user sees instead of conditional rendering. */}
      <div
        className={`grid ${
          fillHeight ? "" : "flex-1 min-h-0"
        } ${viewMode === "split" ? "md:grid-cols-2" : "grid-cols-1"}`}
      >
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className={`${
            fillHeight ? "w-full" : "h-full w-full"
          } resize-none bg-bg-primary px-8 py-6 font-mono text-[13.5px] leading-relaxed text-text-primary focus:outline-none ${
            viewMode === "split" ? "border-r border-bg-border" : ""
          } ${viewMode === "preview" ? "hidden" : ""}`}
          style={
            fillHeight
              ? ({
                  fieldSizing: "content",
                  minHeight: "24rem",
                } as React.CSSProperties)
              : undefined
          }
          aria-label={t("editArea")}
          placeholder={t("placeholder")}
        />
        <div
          className={`${
            fillHeight ? "min-h-[24rem]" : "h-full overflow-auto"
          } bg-bg-primary px-8 py-6 ${viewMode === "edit" ? "hidden" : ""}`}
        >
          <div className="mx-auto max-w-3xl">
            {yamlError && (
              <div
                className="mb-6 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
                role="status"
                title={yamlError}
              >
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span className="break-anywhere">{t("yamlError")}</span>
              </div>
            )}
            {hasFrontmatter && (
              <div className="mb-6">
                <PropertiesPanel frontmatter={frontmatter} hideTags />
              </div>
            )}
            <MarkdownPreview
              source={body}
              chrome={false}
              className="h-full"
              drive={drive}
            />
          </div>
        </div>
      </div>

      {/*
        PR-6: render the overlay modals into ``document.body`` via
        ``createPortal`` so they are not trapped by ancestor ``transform``
        / ``contain`` / ``overflow`` rules. When the editor is inline-
        mounted inside ``FileDetailContent`` (Phase 2 PR-3 onwards), the
        scroll container above us would otherwise clip a ``fixed`` modal
        and clash with the global ``<DirtyBlocker />`` dialog at the same
        z-index. (Phase 2 PR-6, hako RGstVXy42Bfw-FlpP8hCx.)
      */}
      {saveState.kind === "conflict" &&
        typeof document !== "undefined" &&
        createPortal(
          <ConflictModal
            onReload={handleReloadFromServer}
            onOverwrite={handleOverwrite}
            onDismiss={() => setSaveState({ kind: "idle" })}
          />,
          document.body,
        )}
      {fileLinkModalOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <FileLinkModal
            drive={drive}
            onSelect={handleFileLinkInsert}
            onClose={() => setFileLinkModalOpen(false)}
          />,
          document.body,
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
  hideSplit = false,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
  /**
   * Phase 4: at mobile widths the "split" option is dropped (spec
   * §D5 / hako sFXCwZDluTPZZkbYuozwJ). Split is structurally invalid
   * there — half a 375px viewport per pane leaves neither side
   * usable. The host (Editor) detects the viewport and passes this.
   */
  hideSplit?: boolean;
}) {
  const t = useTranslations("knowledge.editor.view");
  const allOptions: { id: ViewMode; icon: typeof Pencil; label: string }[] = [
    { id: "edit", icon: Pencil, label: t("edit") },
    { id: "split", icon: Columns, label: t("split") },
    { id: "preview", icon: Eye, label: t("preview") },
  ];
  const options = hideSplit
    ? allOptions.filter((o) => o.id !== "split")
    : allOptions;
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
