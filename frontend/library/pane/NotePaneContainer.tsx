"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type MutableRefObject,
} from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { usePlainTextDocument } from "@/components/FileDetail/hooks/usePlainTextDocument";
import { MarkdownPreview, type WikiResolveResult } from "@/components/MarkdownPreview";
import { TextPreview } from "@/components/TextPreview";
import { usePolicy } from "@/hooks/usePolicy";
import { getWikiResolutions, recordFileView } from "@/lib/api";
import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import { isInlineKnowledgeEditorEnabled } from "@/lib/featureFlags";
import {
  MarkdownChromeProvider,
  type MarkdownChromeContextValue,
  type MarkdownSaveState,
} from "@/lib/markdownChromeContext";
import { navigationGuard } from "@/lib/navigationGuard";

import type { EditorSaveHandle } from "../../editorSaveHandle";
import KnowledgeEditSection from "../../KnowledgeEditSection";
import { formatNoteTime } from "../../noteDates";
import NotePanePresenter, { type PaneMode } from "./NotePanePresenter";
import { useConnections, useNoteData } from "./useNoteData";

/** Runs `proceed` once the editor's text is on the server, or the viewer agrees to lose it. */
export type PaneGate = (proceed: () => void) => void;

export interface NotePaneProps {
  drive: string;
  noteId: string;
  /** Bumped when the note was renamed or moved, to read it anew. */
  revision?: number;
  saveHandle: MutableRefObject<EditorSaveHandle | null>;
  /** Set to this pane's gate while it is mounted. */
  gateRef: MutableRefObject<PaneGate | null>;
  onModeChange: (mode: PaneMode) => void;
  /** The text was saved: the list and the rail are asked for again. */
  onSaved: () => void;
  /** The viewer chose this note, so opening it counts as a view. */
  recordView: boolean;
}

type FlushNote = "failed" | "conflict" | null;

const noop = () => {};

async function flushHandle(ref: MutableRefObject<EditorSaveHandle | null>): Promise<"saved" | "failed" | "conflict"> {
  const handle = ref.current;
  if (handle === null) return "saved";
  try {
    return await handle.flush();
  } catch {
    return "failed";
  }
}

function hasHandle(ref: MutableRefObject<EditorSaveHandle | null>): boolean {
  return ref.current !== null;
}

/** Remounted (by key) for each note shown. */
export default function NotePaneContainer({
  drive,
  noteId,
  revision = 0,
  saveHandle,
  gateRef,
  onModeChange,
  onSaved,
  recordView,
}: NotePaneProps) {
  const t = useTranslations("knowledge.notesLibrary");
  const locale = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<PaneMode>("reading");
  const [published, setPublished] = useState<MarkdownSaveState>({ status: "idle" });
  const [flushNote, setFlushNote] = useState<FlushNote>(null);
  const [wiki, setWiki] = useState<Record<string, WikiResolveResult> | undefined>(undefined);

  const { note, retry } = useNoteData(noteId, revision);
  const connections = useConnections(drive, noteId);
  const reloadConnections = connections.reload;
  const loaded = note.status === "loaded" ? note.data : null;
  const file = loaded?.file ?? null;

  const policy = usePolicy(drive, "knowledge", "editor");
  const plainText = usePlainTextDocument(file, drive, policy);
  const canEdit =
    file !== null &&
    !policy.isLoading &&
    policy.enabled &&
    isInlineKnowledgeEditorEnabled() &&
    (file.mime_type === "text/markdown" ||
      (file.mime_type === "text/plain" && plainText.decided && plainText.plainTextDocument));

  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
    onModeChange(mode);
  }, [mode, onModeChange]);
  useEffect(() => () => onModeChange("reading"), [onModeChange]);

  // One empty progress POST per note the viewer chose, so it appears in Continue writing.
  const recorded = useRef(false);
  const isLoaded = loaded !== null;
  useEffect(() => {
    if (!isLoaded || !recordView || recorded.current) return;
    recorded.current = true;
    void recordFileView(noteId);
  }, [isLoaded, recordView, noteId]);

  const isMarkdown = file?.mime_type === "text/markdown";
  useEffect(() => {
    if (loaded === null || !isMarkdown) return;
    let cancelled = false;
    getWikiResolutions(noteId).then(
      (map) => {
        if (!cancelled) setWiki(map);
      },
      () => {
        if (!cancelled) setWiki(undefined);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loaded, isMarkdown, noteId]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    setFlushNote(null);
    setPublished({ status: "idle" });
    setMode("reading");
    retry();
    reloadConnections();
  }, [retry, reloadConnections]);

  const flush = useCallback(() => flushHandle(saveHandle), [saveHandle]);

  const gate = useCallback<PaneGate>(
    (proceed) => {
      if (modeRef.current === "waiting") return;
      if (modeRef.current === "reading") {
        proceed();
        return;
      }
      setMode("waiting");
      void flush().then((result) => {
        if (!mounted.current) return;
        if (result === "saved") {
          reload();
          onSaved();
          proceed();
          return;
        }
        setFlushNote(result);
        setMode("editing");
        navigationGuard.request(() => {
          reload();
          proceed();
        });
      });
    },
    [flush, reload, onSaved],
  );
  useEffect(() => {
    gateRef.current = gate;
    return () => {
      if (gateRef.current === gate) gateRef.current = null;
    };
  }, [gate, gateRef]);

  const onDone = useCallback(() => {
    if (modeRef.current !== "editing") return;
    if (!hasHandle(saveHandle)) {
      reload();
      return;
    }
    setMode("waiting");
    void flush().then((result) => {
      if (!mounted.current) return;
      if (result === "saved") {
        reload();
        onSaved();
        return;
      }
      setFlushNote(result);
      setMode("editing");
    });
  }, [saveHandle, flush, reload, onSaved]);

  const chrome = useMemo<MarkdownChromeContextValue>(
    () => ({
      viewMode: "edit",
      setViewMode: noop,
      publishSaveState: (state) => {
        setPublished(state);
        if (state.status === "saving" || state.status === "saved") setFlushNote(null);
      },
      isMobile: false,
    }),
    [],
  );

  const saveText =
    mode === "waiting"
      ? t("saving")
      : flushNote === "conflict"
        ? t("conflict")
        : flushNote === "failed"
          ? t("saveFailed")
          : published.status === "saving"
            ? t("saving")
            : published.status === "conflict"
              ? t("conflict")
              : published.status === "error"
                ? t("saveFailed")
                : t("saved");

  const fileHref = file !== null ? buildCanonicalFileUrl(file, noteId) : "#";
  const onOpenFile = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    gate(() => router.push(fileHref));
  };

  const body =
    loaded === null ? null : isMarkdown ? (
      <MarkdownPreview source={loaded.content} chrome={false} drive={drive} wikiResolution={wiki} />
    ) : (
      <TextPreview fileId={noteId} fileSize={loaded.file.file_size} filename={loaded.file.filename} />
    );

  const editor =
    loaded !== null && mode !== "reading" ? (
      <MarkdownChromeProvider value={chrome}>
        <KnowledgeEditSection
          fileId={noteId}
          drive={drive}
          fillHeight
          frameless
          plainTextDocument={plainText.plainTextDocument}
          saveHandle={saveHandle}
        />
      </MarkdownChromeProvider>
    ) : null;

  return (
    <NotePanePresenter
      drive={drive}
      mode={mode}
      phase={note.status === "failed" ? "error" : loaded === null ? "loading" : "ready"}
      note={
        file === null
          ? null
          : {
              title: file.title || file.filename,
              folder: file.folder_path || t("rootFolder"),
              updated: t("updated", { time: formatNoteTime(file.updated_at, new Date(), locale) }),
              tags: file.tags ?? [],
            }
      }
      body={body}
      editor={editor}
      canEdit={canEdit}
      saveText={saveText}
      fileHref={fileHref}
      graphHref={`/drive/${encodeURIComponent(drive)}/addons/knowledge/connections?focus=${encodeURIComponent(noteId)}`}
      relations={connections.relations}
      sources={connections.sources}
      onEdit={() => setMode("editing")}
      onDone={onDone}
      onRetry={retry}
      onOpenFile={onOpenFile}
    />
  );
}
