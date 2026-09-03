"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  FilePlus2,
  Settings2,
  Quote,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { FileSaveDialog } from "@/components/FileSaveDialog";
import { useShortcuts } from "@/hooks/useShortcuts";
import { OVERLAY_PRIORITY } from "@/lib/shortcuts";
import { useToast } from "@/components/ToastProvider";
import { useSourceCaptures } from "@/hooks/useSourceCaptures";
import {
  removeSourceCapture,
  removeSourceCaptures,
  reorderSourceCaptures,
  updateSourceCaptureNote,
  type SourceCapture,
} from "@/lib/sourceCapture";
import { formatDuration } from "@/lib/format";
import {
  commitSourceCaptures,
  getFileContent,
  searchKnowledge,
  type SearchHit,
} from "./api";
import {
  captureDestinationForDate,
  readCaptureDestination,
  writeCaptureDestination,
  type CaptureDestinationMode,
  type CaptureDestinationSettings,
} from "./captureDestination";

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function defaultCaptureFilename(now = new Date()): string {
  const date = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("-");
  const time = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  return `captures-${date}-${time}-${pad(now.getMilliseconds(), 3)}.md`;
}

function locatorLabel(capture: SourceCapture): string | null {
  if (capture.locator?.label) return capture.locator.label;
  if (capture.locator?.seconds != null) {
    return formatDuration(capture.locator.seconds);
  }
  if (capture.locator?.page != null) return `p. ${capture.locator.page}`;
  return null;
}

export default function CaptureBasket({ drive }: { drive: string }) {
  const t = useTranslations("knowledge.captureBasket");
  const toast = useToast();
  const captures = useSourceCaptures(drive);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveFilename, setSaveFilename] = useState(defaultCaptureFilename);
  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  const [destinationSettings, setDestinationSettings] =
    useState<CaptureDestinationSettings>(() => readCaptureDestination(drive));
  const [draftFolder, setDraftFolder] = useState(destinationSettings.folder);
  const [draftMode, setDraftMode] =
    useState<CaptureDestinationMode>(destinationSettings.mode);
  const [showDestinationSettings, setShowDestinationSettings] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [destinationNow, setDestinationNow] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<
    { fileId: string; filename: string; etag: string } | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const knownCaptureIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const settings = readCaptureDestination(drive);
    setDestinationSettings(settings);
    setDraftFolder(settings.folder);
    setDraftMode(settings.mode);
  }, [drive]);

  useEffect(() => {
    if (!open) return;
    setDestinationNow(new Date());
    const timer = window.setInterval(() => setDestinationNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  // Esc closes the basket — keyboard-shortcuts.md promises that of every
  // overlay. Registering in the shortcut stack rather than listening on
  // `document` is what makes "the topmost one" true: ShortcutsProvider walks
  // the stack and returns on the first match, so the cheat sheet or a search
  // modal above the basket consumes the key alone. A second raw listener would
  // fire alongside whatever the stack picked and close both.
  //
  // The save dialog is the exception: it does listen on `document`, so the
  // basket leaves the stack entirely while that is open.
  useShortcuts(
    "knowledge-capture-basket",
    t("title"),
    [{ key: "escape", label: t("close"), handler: () => setOpen(false), hidden: true }],
    open && !saveDialogOpen,
    OVERLAY_PRIORITY,
  );

  useEffect(() => {
    setSelected((current) => {
      const valid = new Set(captures.map((capture) => capture.id));
      const next = new Set([...current].filter((id) => valid.has(id)));
      for (const capture of captures) {
        if (!knownCaptureIds.current.has(capture.id)) next.add(capture.id);
      }
      knownCaptureIds.current = valid;
      return next;
    });
  }, [captures]);

  useEffect(() => {
    if (targetMode !== "existing" || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await searchKnowledge(drive, query.trim());
        setHits(
          response.results.filter((hit) => hit.filename.toLowerCase().endsWith(".md")),
        );
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [drive, query, targetMode]);

  const chosen = useMemo(
    () => captures.filter((capture) => selected.has(capture.id)),
    [captures, selected],
  );
  const previewDestination = captureDestinationForDate(
    destinationSettings,
    destinationNow,
  );
  const previewPath = [previewDestination.folder, previewDestination.filename]
    .filter(Boolean)
    .join("/");

  const move = (index: number, delta: -1 | 1) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= captures.length) return;
    const ids = captures.map((capture) => capture.id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    reorderSourceCaptures(drive, ids);
  };

  const finishCommit = (ids: readonly string[], notePath: string) => {
    removeSourceCaptures(drive, ids);
    toast.success(t("saved", { path: notePath }));
    setOpen(false);
  };

  const commitNew = async ({ folder, filename }: { folder: string; filename: string }) => {
    if (chosen.length === 0) throw new Error(t("selectAtLeastOne"));
    const result = await commitSourceCaptures(
      drive,
      {
        mode: "new",
        folder,
        filename,
        title: filename.replace(/\.md$/i, ""),
      },
      chosen,
    );
    setSaveDialogOpen(false);
    finishCommit(chosen.map((capture) => capture.id), result.note_path);
  };

  const openSaveDialog = () => {
    setSaveFilename(defaultCaptureFilename());
    setSaveDialogOpen(true);
  };

  const chooseExisting = async (hit: SearchHit) => {
    setSubmitting(true);
    try {
      const loaded = await getFileContent(hit.file_id);
      setTarget({ fileId: hit.file_id, filename: hit.filename, etag: loaded.etag });
      setHits([]);
      setQuery(hit.title || hit.filename);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("loadTargetFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const commitExisting = async () => {
    if (!target || chosen.length === 0) return;
    setSubmitting(true);
    try {
      const result = await commitSourceCaptures(
        drive,
        { mode: "existing", file_id: target.fileId, etag: target.etag },
        chosen,
      );
      finishCommit(chosen.map((capture) => capture.id), result.note_path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const commitQuick = async () => {
    if (chosen.length === 0) return;
    const destination = captureDestinationForDate(destinationSettings, new Date());
    setSubmitting(true);
    try {
      const result = await commitSourceCaptures(
        drive,
        {
          mode: "quick",
          folder: destination.folder,
          filename: destination.filename,
          title: destination.filename.replace(/\.md$/i, ""),
        },
        chosen,
      );
      finishCommit(chosen.map((capture) => capture.id), result.note_path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const saveDestinationSettings = () => {
    const saved = writeCaptureDestination(drive, {
      folder: draftFolder,
      mode: draftMode,
    });
    setDestinationSettings(saved);
    setDraftFolder(saved.folder);
    setDraftMode(saved.mode);
    setDestinationNow(new Date());
    setShowDestinationSettings(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("title")}
        title={t("title")}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
      >
        <Quote size={19} />
        {captures.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
            {captures.length}
          </span>
        )}
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <>
            {open && (
              <div className="fixed inset-0 z-[70]" role="dialog" aria-modal aria-label={t("title")}>
          <button
            type="button"
            className="absolute inset-0 bg-black/50 animate-fade-in"
            onClick={() => setOpen(false)}
            aria-label={t("close")}
          />
          <section className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-lg border border-bg-border bg-bg-primary shadow-xl animate-slide-up-bar sm:inset-y-0 sm:left-auto sm:w-[430px] sm:rounded-none sm:animate-slide-in-right">
            <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-bg-border px-4">
              <div className="flex items-center gap-2">
                <Quote size={18} />
                <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>
                <span className="text-xs text-text-muted">{captures.length}</span>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="rounded-lg p-2 text-text-muted hover:bg-bg-elevated">
                <X size={18} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {captures.length === 0 ? (
                <p className="py-12 text-center text-sm text-text-muted">{t("empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {captures.map((capture, index) => (
                    <li key={capture.id} className="rounded-lg border border-bg-border bg-bg-card p-3">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selected.has(capture.id)}
                          onChange={(event) => {
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(capture.id);
                              else next.delete(capture.id);
                              return next;
                            });
                          }}
                          aria-label={t("select", { filename: capture.filename })}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-text-primary">{capture.filename}</p>
                          {locatorLabel(capture) && (
                            <p className="text-xs font-mono text-accent">{locatorLabel(capture)}</p>
                          )}
                          {capture.quote && (
                            <p className="mt-1 line-clamp-3 text-xs text-text-muted">{capture.quote}</p>
                          )}
                        </div>
                        <div className="flex flex-shrink-0">
                          <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t("moveUp")} className="h-8 w-8 rounded-lg text-text-muted hover:bg-bg-elevated disabled:opacity-30"><ArrowUp size={14} className="mx-auto" /></button>
                          <button type="button" onClick={() => move(index, 1)} disabled={index === captures.length - 1} aria-label={t("moveDown")} className="h-8 w-8 rounded-lg text-text-muted hover:bg-bg-elevated disabled:opacity-30"><ArrowDown size={14} className="mx-auto" /></button>
                          <button type="button" onClick={() => removeSourceCapture(drive, capture.id)} aria-label={t("remove")} className="h-8 w-8 rounded-lg text-danger hover:bg-danger/10"><Trash2 size={14} className="mx-auto" /></button>
                        </div>
                      </div>
                      <textarea
                        value={capture.note ?? ""}
                        onChange={(event) => updateSourceCaptureNote(drive, capture.id, event.target.value)}
                        placeholder={t("notePlaceholder")}
                        rows={2}
                        className="mt-2 w-full resize-y rounded-lg border border-bg-border bg-bg-primary px-2.5 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-focus-ring focus:outline-none"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {captures.length > 0 && (
              <footer className="flex-shrink-0 space-y-3 border-t border-bg-border p-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs text-text-muted" title={previewPath}>
                      {previewPath}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowDestinationSettings((current) => !current)}
                      aria-label={t("destinationSettings")}
                      className="rounded-lg p-2 text-text-muted hover:bg-bg-elevated hover:text-text-primary"
                    >
                      <Settings2 size={15} />
                    </button>
                  </div>
                  {showDestinationSettings && (
                    <div className="space-y-3 rounded-lg border border-bg-border bg-bg-card p-3">
                      <label className="block text-xs text-text-muted">
                        {t("destinationFolder")}
                        <input
                          value={draftFolder}
                          onChange={(event) => setDraftFolder(event.target.value)}
                          placeholder="Captures"
                          className="mt-1.5 w-full rounded-lg border border-bg-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-focus-ring focus:outline-none"
                        />
                      </label>
                      <fieldset className="space-y-1.5">
                        <legend className="text-xs text-text-muted">{t("destinationType")}</legend>
                        <label className="flex items-center gap-2 text-sm text-text-primary">
                          <input type="radio" name="capture-destination-mode" checked={draftMode === "fixed"} onChange={() => setDraftMode("fixed")} />
                          {t("fixedInbox")}
                        </label>
                        <label className="flex items-center gap-2 text-sm text-text-primary">
                          <input type="radio" name="capture-destination-mode" checked={draftMode === "daily"} onChange={() => setDraftMode("daily")} />
                          {t("dailyNote")}
                        </label>
                      </fieldset>
                      <button type="button" onClick={saveDestinationSettings} className="w-full rounded-lg bg-sand px-3 py-2 text-sm font-medium text-text-primary hover:bg-sand-hover">
                        {t("saveDestination")}
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void commitQuick()}
                    disabled={chosen.length === 0 || submitting}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-sand disabled:text-warm-silver disabled:cursor-not-allowed"
                  >
                    <Quote size={16} />
                    {t("quickAppend", { filename: previewDestination.filename })}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvanced((current) => !current)}
                  aria-expanded={showAdvanced}
                  className="flex w-full items-center justify-center gap-1.5 py-1 text-xs font-medium text-text-muted hover:text-text-primary"
                >
                  {t("otherSaveMethods")}
                  <ChevronDown size={14} className={showAdvanced ? "rotate-180" : ""} />
                </button>

                {showAdvanced && <div className="space-y-3">
                <div className="grid grid-cols-2 rounded-lg bg-bg-elevated p-1">
                  {(["new", "existing"] as const).map((mode) => (
                    <button key={mode} type="button" onClick={() => setTargetMode(mode)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${targetMode === mode ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-muted"}`}>{t(mode === "new" ? "newNote" : "existingNote")}</button>
                  ))}
                </div>
                {targetMode === "new" ? (
                  <button type="button" onClick={openSaveDialog} disabled={chosen.length === 0} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-sand disabled:text-warm-silver disabled:cursor-not-allowed"><FilePlus2 size={16} />{t("saveNew", { count: chosen.length })}</button>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-2.5 text-text-muted" />
                      <input value={query} onChange={(event) => { setQuery(event.target.value); setTarget(null); }} placeholder={t("searchNotes")} className="w-full rounded-lg border border-bg-border bg-bg-primary py-2 pl-9 pr-3 text-sm text-text-primary focus:border-focus-ring focus:outline-none" />
                    </div>
                    {(searching || hits.length > 0) && (
                      <div className="max-h-32 overflow-y-auto rounded-lg border border-bg-border bg-bg-card">
                        {searching ? <p className="p-3 text-xs text-text-muted">{t("searching")}</p> : hits.map((hit) => <button key={hit.file_id} type="button" onClick={() => void chooseExisting(hit)} className="block w-full truncate px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-elevated">{hit.title || hit.filename}</button>)}
                      </div>
                    )}
                    <button type="button" onClick={() => void commitExisting()} disabled={!target || chosen.length === 0 || submitting} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-sand disabled:text-warm-silver disabled:cursor-not-allowed">{target ? t("appendTo", { filename: target.filename }) : t("chooseNote")}</button>
                  </div>
                )}
                </div>}
              </footer>
            )}
          </section>
              </div>
            )}

            <FileSaveDialog
              open={saveDialogOpen}
              title={t("saveNewTitle")}
              drive={drive}
              defaultFolder="Captures"
              defaultFilename={saveFilename}
              confirmLabel={t("save")}
              onConfirm={commitNew}
              onCancel={() => setSaveDialogOpen(false)}
            />
          </>,
          document.body,
        )}
    </>
  );
}
