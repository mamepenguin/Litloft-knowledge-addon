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
  Loader2,
  PanelLeft,
  PanelLeftClose,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { useToast } from "@/components/ToastProvider";
import { MarkdownViewModeToggle } from "@/components/MarkdownViewModeToggle";
import { PropertiesPanel } from "@/components/PropertiesPanel";
import { markdownContentRegistry } from "@/lib/markdownContentRegistry";
import {
  useMarkdownChrome,
  type MarkdownSaveState,
} from "@/lib/markdownChromeContext";
import { useDirty } from "@/hooks/useDirty";
import { useShortcuts } from "@/hooks/useShortcuts";
import {
  ConflictError,
  getFileContent,
  putFileContent,
  renameFile,
} from "./api";
import {
  completeUpload,
  getWikiResolutions,
  initUpload,
  uploadChunk,
  type WikiResolveResult,
} from "@/lib/api";
import EditorToolbar, {
  applyEditorAction,
  type EditorAction,
} from "./EditorToolbar";
import FileLinkModal from "./FileLinkModal";
import { applyIndent } from "./editorIndent";
import { getCaretCoordinates } from "./textareaCaret";
import {
  WikiLinkAutocomplete,
  type WikiLinkAutocompleteHandle,
  type WikiLinkSelection,
} from "./WikiLinkAutocomplete";

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
  /**
   * The folder_path of this note on the drive. Used when uploading
   * dropped/pasted files so they land in the same folder as the note.
   * When omitted (callers that only pass fileId), the value is fetched
   * lazily from the file metadata API.
   */
  folderPath?: string;
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

// Unique-enough id for upload placeholders. We intentionally avoid
// crypto.randomUUID() because it is only defined in secure contexts
// (HTTPS / localhost); Litloft is served over plain HTTP on the home
// LAN, where crypto.randomUUID is undefined and calling it throws.
// This only needs to be unique among concurrent in-flight uploads, so
// a counter + timestamp + random suffix is sufficient.
let uploadIdCounter = 0;
function nextUploadPlaceholderId(): string {
  uploadIdCounter += 1;
  return `${Date.now()}-${uploadIdCounter}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

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
  folderPath,
}: Props) {
  const t = useTranslations("knowledge.editor");
  const tSide = useTranslations("knowledge.sidebar");
  const tShortcuts = useTranslations("knowledge.shortcuts");
  const toast = useToast();
  // When mounted under MarkdownDocumentLayout the host owns the
  // unified chrome (view-mode toggle + save dot). The Editor then
  // suppresses its own inline header and reads/writes those bits
  // through the context. Standalone mounts (e.g. the bare /addons/
  // knowledge route) keep their fully local fallback.
  const chrome = useMarkdownChrome();
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
  const [fetchedFolderPath, setFetchedFolderPath] = useState<string | null>(null);
  // Always-current folder path ref for use inside async upload callbacks.
  const folderPathRef = useRef<string>("");
  folderPathRef.current = folderPath ?? fetchedFolderPath ?? "";

  useEffect(() => {
    if (filename !== undefined) return;
    setFetchedFilename(null);
    let cancelled = false;
    fetch(`/api/files/${encodeURIComponent(fileId)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { filename?: string; folder_path?: string } | null) => {
        if (!cancelled && data?.filename) setFetchedFilename(data.filename);
        if (!cancelled && data?.folder_path !== undefined)
          setFetchedFolderPath(data.folder_path);
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
  // wiki-link resolutions for the preview pane — fetched on mount and
  // re-fetched after each successful save (so newly-added [[X]] in the
  // body get drawn as clickable links once the backend has indexed
  // them). Optional: fetch failure degrades to all-unresolved spans.
  const [wikiResolution, setWikiResolution] = useState<
    Record<string, WikiResolveResult> | undefined
  >(undefined);
  // When the chrome context is present, the host owns viewMode. Keep
  // a local state for the standalone fallback so this hook stays
  // unconditional (Rules of Hooks).
  const [localViewMode, setLocalViewMode] = useState<ViewMode>("edit");
  const viewMode: ViewMode = chrome ? chrome.viewMode : localViewMode;
  const setViewMode = (m: ViewMode) => {
    if (chrome) chrome.setViewMode(m);
    else setLocalViewMode(m);
  };
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
    // setViewMode is a stable identity when ``chrome`` is null, and
    // chrome.setViewMode is stable for the lifetime of the chrome
    // value (memoised in MarkdownDocumentLayout). Excluding it from
    // deps keeps this effect from firing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileWidth, viewMode]);

  // Publish save lifecycle upward so the host chrome's save dot can
  // reflect the current state. No-op when standalone.
  useEffect(() => {
    if (!chrome) return;
    const next: MarkdownSaveState =
      saveState.kind === "error"
        ? { status: "error", message: saveState.message }
        : { status: saveState.kind };
    chrome.publishSaveState(next);
  }, [chrome, saveState]);
  const etagRef = useRef<string>("");
  const lastSavedRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fileLinkModalOpen, setFileLinkModalOpen] = useState(false);
  const savedSelRef = useRef<{ start: number; end: number } | null>(null);
  // Wiki-link autocomplete state. ``triggerStart`` is the offset
  // immediately AFTER the opening ``[[`` (so substring(triggerStart,
  // caret) gives the query). null = popup closed. Spec 2026-05-12 §3.9.
  const [wikiTrigger, setWikiTrigger] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const wikiAutocompleteRef = useRef<WikiLinkAutocompleteHandle | null>(null);
  // Viewport-space anchor for the autocomplete popup. Recomputed
  // whenever the trigger moves or the textarea scrolls / the viewport
  // resizes. ``null`` falls the popup back to legacy in-flow placement.
  const [wikiAnchor, setWikiAnchor] = useState<
    { top: number; left: number; lineHeight: number } | null
  >(null);

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

  // Fetch wiki-link resolutions whenever the file changes or a save
  // lands — the resolver re-runs against the new on-disk body, so we
  // re-pull to pick up freshly-added [[X]] targets. Errors degrade to
  // undefined (all wiki-links render as unresolved spans).
  //
  // The previous keying on `saveState.kind === "saved" ? at : 0`
  // fetched twice per save: once when transitioning to "saving"
  // (savedAtKey -> 0) and once when transitioning to "saved"
  // (savedAtKey -> at). Bump a counter only on successful save so
  // each save cycle triggers exactly one refetch.
  const [savedRefetchSeq, setSavedRefetchSeq] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getWikiResolutions(fileId)
      .then((r) => {
        if (!cancelled) setWikiResolution(r);
      })
      .catch(() => {
        if (!cancelled) setWikiResolution(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, savedRefetchSeq]);

  const autoFocusedFileIdRef = useRef<string | null>(null);
  // Depend on the boolean "content has loaded" rather than `content`
  // itself so we don't re-evaluate on every keystroke. The effect only
  // needs to fire once per file load transition; the ref guard handles
  // re-mount idempotency.
  const contentLoaded = content !== null;
  useEffect(() => {
    if (!autoFocus) return;
    if (!contentLoaded) return;
    if (autoFocusedFileIdRef.current === fileId) return;
    const ta = textareaRef.current;
    if (!ta) return;
    autoFocusedFileIdRef.current = fileId;
    ta.focus();
  }, [autoFocus, contentLoaded, fileId]);

  const performSave = useCallback(
    async (text: string) => {
      setSaveState({ kind: "saving" });
      try {
        const newEtag = await putFileContent(fileId, text, etagRef.current);
        etagRef.current = newEtag;
        lastSavedRef.current = text;
        setSaveState({ kind: "saved", at: Date.now() });
        // Trigger one wiki-resolutions refetch per successful save
        // (see comment on the useEffect below).
        setSavedRefetchSeq((s) => s + 1);
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
        // Fire-and-forget direct PUT instead of `performSave` — the
        // component is unmounting, so its `setSaveState` calls would
        // warn ("update on unmounted component") and have no UI to
        // reflect anyway. We only care that the bytes reach disk.
        void putFileContent(fileId, latest, etagRef.current).catch(() => {
          // best-effort; the next mount refetches authoritative state
        });
      }
    };
    // Intentionally key on `fileId` (not `performSave`) — we want the
    // cleanup to run exactly when the editor unmounts or switches
    // files, not on every callback identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const uploadFile = useCallback(
    async (file: File, placeholder: string) => {
      const isImage = file.type.startsWith("image/");
      const CHUNK_SIZE = 5 * 1024 * 1024;
      try {
        const initResult = await initUpload(drive, {
          filename: file.name,
          file_size: file.size,
          folder_path: folderPathRef.current,
          chunk_size: CHUNK_SIZE,
        });
        for (let i = 0; i < initResult.total_chunks; i++) {
          const start = i * CHUNK_SIZE;
          await uploadChunk(
            drive,
            initResult.upload_id,
            i,
            file.slice(start, Math.min(start + CHUNK_SIZE, file.size)),
          );
        }
        const fileItem = await completeUpload(drive, initResult.upload_id);
        const final = isImage
          ? `![${file.name}](loft://${fileItem.id})`
          : `[${file.name}](loft://${fileItem.id})`;
        // Function replacer: a string replacement would special-case
        // `$&`/`$1`/`$$` if the filename contains `$`, mangling the
        // inserted markdown.
        setContent((prev) =>
          prev === null ? null : prev.replace(placeholder, () => final),
        );
      } catch {
        setContent((prev) =>
          prev === null ? null : prev.replace(placeholder, ""),
        );
        toast.error(t("uploadFailed", { name: file.name }));
      }
    },
    // folderPathRef is a stable ref; setContent is a stable React setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drive, toast, t],
  );

  // Keep a ref to uploadFile so native event listeners always call the
  // latest version without re-attaching on every render.
  const uploadFileRef = useRef(uploadFile);
  uploadFileRef.current = uploadFile;

  // Native event listeners for D&D and image paste. Using addEventListener
  // directly on the textarea element (instead of React's onDrop/onDragOver
  // synthetic events) prevents parent UploadZone handlers from intercepting
  // the events before they reach the textarea.
  useEffect(() => {
    const taOrNull = textareaRef.current;
    if (!taOrNull) return;
    // Assign to a new const so TypeScript carries the narrowed non-null type
    // into the nested event handler closures below.
    const ta = taOrNull;

    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    function onDrop(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const offset = ta.selectionStart;
      const specs = files.map((file) => {
        const uuid = nextUploadPlaceholderId();
        const isImage = file.type.startsWith("image/");
        const placeholder = isImage
          ? `![${file.name} uploading...](loft://pending-${uuid})`
          : `[${file.name} uploading...](loft://pending-${uuid})`;
        return { file, placeholder };
      });
      const insertion = specs.map((s) => s.placeholder).join("\n") + "\n";
      setContent((prev) => {
        if (prev === null) return null;
        return prev.slice(0, offset) + insertion + prev.slice(offset);
      });
      for (const { file, placeholder } of specs) {
        void uploadFileRef.current(file, placeholder);
      }
    }

    function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItems = items.filter((item) =>
        item.type.startsWith("image/"),
      );
      if (imageItems.length === 0) return;
      e.preventDefault();
      const files = imageItems
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length === 0) return;
      const offset = ta.selectionStart;
      const selEnd = ta.selectionEnd;
      const specs = files.map((file) => {
        const uuid = nextUploadPlaceholderId();
        const placeholder = `![${file.name} uploading...](loft://pending-${uuid})`;
        return { file, placeholder };
      });
      const insertion = specs.map((s) => s.placeholder).join("\n") + "\n";
      setContent((prev) => {
        if (prev === null) return null;
        return prev.slice(0, offset) + insertion + prev.slice(selEnd);
      });
      for (const { file, placeholder } of specs) {
        void uploadFileRef.current(file, placeholder);
      }
    }

    ta.addEventListener("dragover", onDragOver);
    ta.addEventListener("drop", onDrop);
    ta.addEventListener("paste", onPaste);
    return () => {
      ta.removeEventListener("dragover", onDragOver);
      ta.removeEventListener("drop", onDrop);
      ta.removeEventListener("paste", onPaste);
    };
    // textareaRef.current is stable once content loads; setContent is a
    // stable React setter. uploadFileRef is updated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentLoaded]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Wiki-link autocomplete intercepts keyboard nav first. If the
      // popup is open and consumed the key (ArrowUp/Down, Enter, Esc),
      // skip the editor's own handling.
      if (
        wikiTrigger &&
        wikiAutocompleteRef.current?.handleKeyDown(e)
      ) {
        return;
      }
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
    [wikiTrigger],
  );

  // Inspects the textarea contents around the caret to decide whether
  // a wiki-link autocomplete popup should be open and, if so, what
  // query to pass to it. Called from the textarea's onChange handler.
  const updateWikiTrigger = useCallback(
    (value: string, caret: number) => {
      // Walk backwards from the caret looking for ``[[``. A whitespace
      // or newline before the search character means the user is not
      // currently inside a wiki-link context — close the popup.
      let i = caret - 1;
      while (i >= 1) {
        const ch = value.charCodeAt(i);
        if (ch === 0x0a) {
          // Newline → not in a wiki-link context.
          setWikiTrigger(null);
          return;
        }
        if (ch === 0x5d /* ] */) {
          // The user typed the closing ``]`` — bail.
          setWikiTrigger(null);
          return;
        }
        if (
          ch === 0x5b /* [ */ &&
          value.charCodeAt(i - 1) === 0x5b /* [ */
        ) {
          const start = i + 1; // First character AFTER the ``[[``.
          const query = value.slice(start, caret);
          setWikiTrigger({ start, query });
          return;
        }
        i -= 1;
      }
      setWikiTrigger(null);
    },
    [],
  );

  // Compute the popup's viewport-space anchor whenever the trigger
  // moves. Re-runs on textarea scroll and window resize so the popup
  // follows the caret instead of getting stranded.
  useEffect(() => {
    if (!wikiTrigger) {
      setWikiAnchor(null);
      return;
    }
    const ta = textareaRef.current;
    if (!ta) return;
    const compute = () => {
      const taLocal = textareaRef.current;
      if (!taLocal) return;
      // Anchor at the position of the opening ``[[`` — wikiTrigger.start
      // is the offset right after ``[[``, so subtract 2 to land on the
      // first ``[``.
      const offset = Math.max(0, wikiTrigger.start - 2);
      try {
        const coords = getCaretCoordinates(taLocal, offset);
        const rect = taLocal.getBoundingClientRect();
        setWikiAnchor({
          top: rect.top + coords.top,
          left: rect.left + coords.left,
          lineHeight: coords.height,
        });
      } catch {
        setWikiAnchor(null);
      }
    };
    compute();
    const onScroll = () => compute();
    const onResize = () => compute();
    ta.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      ta.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [wikiTrigger]);

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      setContent(next);
      updateWikiTrigger(next, e.target.selectionStart);
    },
    [updateWikiTrigger],
  );

  const insertWikiLink = useCallback(
    (sel: WikiLinkSelection, shift: boolean) => {
      const ta = textareaRef.current;
      if (!ta || content === null || !wikiTrigger) return;
      // Replace from the opening ``[[`` (triggerStart - 2) through the
      // current caret with the rendered link form.
      const linkBody =
        shift && sel.mdId ? sel.mdId : sel.basename;
      const inserted = `[[${linkBody}]]`;
      const beforeBracket = content.slice(0, wikiTrigger.start - 2);
      const afterCaret = content.slice(ta.selectionStart);
      const newText = beforeBracket + inserted + afterCaret;
      const cursor = beforeBracket.length + inserted.length;
      setContent(newText);
      setWikiTrigger(null);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(cursor, cursor);
      });
    },
    [content, wikiTrigger],
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
    const idx = VIEW_MODE_ROTATION.indexOf(viewMode);
    const next = VIEW_MODE_ROTATION[(idx + 1) % VIEW_MODE_ROTATION.length];
    setViewMode(next);
    // setViewMode is intentionally excluded — both branches (chrome
    // setter, local setter) are stable for the lifetime of the
    // relevant owner. Including viewMode is enough to keep the next
    // step computed against the current value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

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
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-danger">
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
      {chrome ? null : inlineMode ? (
        <div className="flex items-center justify-end gap-2 border-b border-bg-border px-2 py-1.5">
          <SaveIndicator state={saveState} />
          <MarkdownViewModeToggle
            mode={viewMode}
            onChange={setViewMode}
            hideSplit={isMobileWidth}
          />
        </div>
      ) : (
        <header className="flex items-center gap-3 border-b border-bg-border px-4 py-2.5">
          <button
            type="button"
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary md:hidden"
            aria-label={t("back")}
          >
            <ArrowLeft size={16} />
          </button>
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="hidden h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-bg-elevated hover:text-text-primary md:inline-flex"
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
          <MarkdownViewModeToggle
            mode={viewMode}
            onChange={setViewMode}
            hideSplit={isMobileWidth}
          />
          {onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              aria-label={t("delete")}
              title={t("delete")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          )}
        </header>
      )}

      {viewMode !== "preview" && (
        // Sticky directly below the host chrome (MarkdownDocumentLayout's
        // 48px top bar / Knowledge Page's own header) so the formatting
        // affordances stay reachable while the textarea content scrolls
        // past. `top-0` anchors against the nearest scroll ancestor,
        // which is the layout's main column. The EditorToolbar's own
        // `bg-bg-card` already gives it an opaque backdrop, so we only
        // add the positioning + a low z-index here.
        <div className="sticky top-0 z-10">
          <EditorToolbar onAction={handleToolbar} onFileLinkRequest={handleFileLinkRequest} />
        </div>
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
          onChange={handleContentChange}
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
                className="mb-6 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
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
              wikiResolution={wikiResolution}
            />
          </div>
        </div>
      </div>

      {wikiTrigger && (
        <WikiLinkAutocomplete
          drive={drive}
          query={wikiTrigger.query}
          onSelect={insertWikiLink}
          onClose={() => setWikiTrigger(null)}
          handleRef={wikiAutocompleteRef}
          anchor={wikiAnchor}
        />
      )}

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
        className="block w-full truncate rounded-lg px-1 py-0.5 text-left text-base font-semibold text-text-primary hover:bg-bg-elevated"
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
        className="w-full rounded-lg border border-bg-border bg-bg-primary px-2 py-1 text-base font-semibold text-text-primary focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring"
      />
      {error && (
        <span className="text-xs text-danger" title={error}>
          <AlertCircle size={12} />
        </span>
      )}
    </form>
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
      <span className="flex items-center gap-1 text-xs text-danger">
        <AlertCircle size={12} />
        {t("conflict")}
      </span>
    );
  return (
    <span
      className="flex max-w-[180px] items-center gap-1 truncate text-xs text-danger"
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
      <div className="w-full max-w-md rounded-xl border border-bg-border bg-bg-card p-6 shadow-lg animate-fade-in-scale">
        <div className="mb-3 flex items-center gap-2 text-danger">
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
            className="rounded-lg bg-accent-cta px-4 py-2 text-sm font-medium text-white hover:bg-accent"
          >
            {t("reload")}
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            className="rounded-lg border border-bg-border bg-bg-elevated px-4 py-2 text-sm text-text-primary hover:border-accent/40"
          >
            {t("overwrite")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-4 py-2 text-sm text-text-muted hover:bg-bg-elevated"
          >
            {t("dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
