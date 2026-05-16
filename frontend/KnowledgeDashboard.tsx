"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Bookmark,
  Check,
  ClipboardPaste,
  ExternalLink,
  Loader2,
  SquarePen,
} from "lucide-react";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useCreateFile } from "@/hooks/useCreateFile";
import { FolderPicker } from "@/components/FolderPicker";
import {
  createClip,
  findClipsByUrl,
  type ClipJob,
} from "./api";
import ClipPasteForm from "./ClipPasteForm";
import BookmarkletDialog from "./BookmarkletDialog";
import ClipDuplicateDialog from "./ClipDuplicateDialog";
import ConnectionsGraph from "./ConnectionsGraph";

// ---- RecentJob -------------------------------------------------------

export interface RecentJob {
  status: "fetching" | "ready" | "failed";
  url: string;
  title?: string;
  error?: string;
  subfolder: string;
  addedAt: number;
}

type JobsMap = Map<string, RecentJob>;

const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const JOB_MAX = 10;

function jobsKey(drive: string) {
  return `knowledge:recentJobs:${drive}`;
}

function loadJobs(drive: string): JobsMap {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(jobsKey(drive));
    if (!raw) return new Map();
    const pairs = JSON.parse(raw) as [string, RecentJob][];
    const cutoff = Date.now() - JOB_TTL_MS;
    return new Map(pairs.filter(([, j]) => j.addedAt > cutoff));
  } catch {
    return new Map();
  }
}

function saveJobs(drive: string, map: JobsMap) {
  if (typeof window === "undefined") return;
  try {
    const pairs = Array.from(map.entries()).slice(-JOB_MAX);
    window.localStorage.setItem(jobsKey(drive), JSON.stringify(pairs));
  } catch {
    // ignore quota
  }
}

type JobAction =
  | { type: "add"; fileId: string; job: RecentJob }
  | { type: "update"; fileId: string; patch: Partial<RecentJob> }
  | { type: "init"; map: JobsMap };

function jobsReducer(state: JobsMap, action: JobAction): JobsMap {
  const next = new Map(state);
  switch (action.type) {
    case "init":
      return action.map;
    case "add":
      next.set(action.fileId, action.job);
      if (next.size > JOB_MAX) {
        const oldest = Array.from(next.entries()).sort(
          ([, a], [, b]) => a.addedAt - b.addedAt,
        )[0];
        if (oldest) next.delete(oldest[0]);
      }
      return next;
    case "update": {
      const cur = next.get(action.fileId);
      if (!cur) return state;
      next.set(action.fileId, { ...cur, ...action.patch });
      return next;
    }
  }
}

// ---- Helpers ---------------------------------------------------------

function timeAgo(ms: number): string {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return `${Math.floor(diff / 86400)}日前`;
}

// ---- Zone 1: Capture -------------------------------------------------

interface ClipFormProps {
  drive: string;
  initialUrl?: string;
  initialTitle?: string;
  autoSubmit?: boolean;
  onJobAdded: (fileId: string, job: RecentJob) => void;
  onDuplicate: (url: string, subfolder: string, existing: ClipJob[]) => void;
}

function ClipForm({
  drive,
  initialUrl = "",
  initialTitle = "",
  autoSubmit = false,
  onJobAdded,
  onDuplicate,
}: ClipFormProps) {
  const [url, setUrl] = useState(initialUrl);
  const [titleHint] = useState(initialTitle);
  const [subfolder, setSubfolder] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(`knowledge:lastSubfolder:${drive}`) ?? "";
    } catch {
      return "";
    }
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl ?? url).trim();
    if (!targetUrl) return;
    setSubmitting(true);
    setError(null);
    try {
      const existing = await findClipsByUrl(drive, targetUrl);
      if (existing.length > 0) {
        onDuplicate(targetUrl, subfolder, existing);
        return;
      }
      const job = await createClip(drive, {
        url: targetUrl,
        subfolder: subfolder || null,
        title: titleHint || null,
      });
      try {
        window.localStorage.setItem(`knowledge:lastSubfolder:${drive}`, subfolder);
      } catch {}
      setUrl("");
      onJobAdded(job.file_id, {
        status: "fetching",
        url: targetUrl,
        subfolder,
        addedAt: Date.now(),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [drive, url, subfolder, titleHint, onJobAdded, onDuplicate]);

  useEffect(() => {
    if (autoSubmit && initialUrl) void submit(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-3">
      {/* URL input + button */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/article"
          disabled={submitting}
          aria-label="クリップする URL"
          className="flex-1 rounded-2xl border border-bg-border bg-bg-card px-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={submitting || !url.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin" strokeWidth={1.6} />
          ) : null}
          クリップ
        </button>
      </div>

      {/* Folder picker */}
      <FolderPicker drive={drive} value={subfolder} onChange={setSubfolder} />

      {error && (
        <p className="text-xs text-danger" role="alert">{error}</p>
      )}
    </form>
  );
}

interface CaptureZoneProps {
  drive: string;
  initialUrl?: string;
  initialTitle?: string;
  autoSubmit?: boolean;
  onJobAdded: (fileId: string, job: RecentJob) => void;
  onDuplicate: (url: string, subfolder: string, existing: ClipJob[]) => void;
}

function CaptureZone({
  drive,
  initialUrl,
  initialTitle,
  autoSubmit,
  onJobAdded,
  onDuplicate,
}: CaptureZoneProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const [bookmarkletOpen, setBookmarkletOpen] = useState(false);
  // Drive root: the Knowledge dashboard has no folder context (Topic 12
  // specifies drive root as the dashboard's note-creation target).
  const { createFile, isCreating } = useCreateFile(drive, "");

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          キャプチャ
        </p>
        <button
          type="button"
          onClick={() => void createFile()}
          disabled={isCreating}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCreating ? (
            <Loader2 size={12} className="animate-spin" strokeWidth={1.6} />
          ) : (
            <SquarePen size={12} strokeWidth={1.6} />
          )}
          クイックメモ
        </button>
      </div>

      <ClipForm
        drive={drive}
        initialUrl={initialUrl}
        initialTitle={initialTitle}
        autoSubmit={autoSubmit}
        onJobAdded={onJobAdded}
        onDuplicate={(url, subfolder, existing) => {
          setPasteUrl(url);
          onDuplicate(url, subfolder, existing);
        }}
      />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPasteOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
        >
          <ClipboardPaste size={12} strokeWidth={1.6} />
          HTML を貼り付け
        </button>
        <button
          type="button"
          onClick={() => setBookmarkletOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
        >
          <Bookmark size={12} strokeWidth={1.6} />
          ブックマークレット
        </button>
      </div>

      {pasteOpen && (
        <ClipPasteForm
          drive={drive}
          url={pasteUrl}
          subfolder=""
          onSaved={(job) => {
            onJobAdded(job.file_id, {
              status: "ready",
              url: pasteUrl,
              subfolder: "",
              addedAt: Date.now(),
            });
            setPasteOpen(false);
            setPasteUrl("");
          }}
          onCancel={() => {
            setPasteOpen(false);
            setPasteUrl("");
          }}
        />
      )}

      <BookmarkletDialog
        drive={drive}
        open={bookmarkletOpen}
        onClose={() => setBookmarkletOpen(false)}
      />
    </section>
  );
}

// ---- Zone 2: Clip Queue ----------------------------------------------

interface ClipQueueZoneProps {
  drive: string;
  jobs: JobsMap;
}

function ClipQueueZone({ drive: _drive, jobs }: ClipQueueZoneProps) {
  const rows = Array.from(jobs.entries())
    .sort(([, a], [, b]) => b.addedAt - a.addedAt)
    .slice(0, JOB_MAX);

  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        クリップ履歴
      </p>
      <ul className="flex flex-col gap-1.5" role="list">
        {rows.map(([fileId, job]) => (
          <ClipQueueRow key={fileId} fileId={fileId} job={job} />
        ))}
      </ul>
    </section>
  );
}

function ClipQueueRow({ fileId, job }: { fileId: string; job: RecentJob }) {
  const [tick, setTick] = useReducer((x: number) => x + 1, 0);
  void tick;
  useEffect(() => {
    const id = setInterval(setTick, 30_000);
    return () => clearInterval(id);
  }, []);

  const label = job.title ?? job.url;

  return (
    <li className="flex items-center gap-3 rounded-xl border border-bg-border bg-bg-elevated px-3.5 py-2.5">
      <StatusDot status={job.status} />
      <span
        className="min-w-0 flex-1 truncate text-sm text-text-primary"
        title={label}
      >
        {label}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
        {timeAgo(job.addedAt)}
      </span>
      {job.status === "ready" && (
        <a
          href={`/files/${fileId}`}
          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          開く
          <ExternalLink size={11} strokeWidth={1.8} />
        </a>
      )}
    </li>
  );
}

function StatusDot({ status }: { status: RecentJob["status"] }) {
  if (status === "ready") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-teal/15">
        <Check size={10} strokeWidth={2.5} className="text-accent-teal" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger-bg">
        <AlertTriangle size={10} strokeWidth={2.5} className="text-danger" />
      </span>
    );
  }
  return (
    <Loader2
      size={16}
      strokeWidth={1.8}
      className="shrink-0 animate-spin text-accent-amber"
    />
  );
}

// ---- Zone 3: Connections (graph view, see ConnectionsGraph.tsx) ------

// ---- Root ------------------------------------------------------------

export default function KnowledgeDashboard() {
  const drive = useCurrentDrive() ?? "";
  const searchParams = useSearchParams();
  const prefillUrl = searchParams.get("prefill") ?? "";
  const prefillTitle = searchParams.get("title") ?? "";
  const autoSubmit = searchParams.get("autosubmit") === "1";

  const [jobs, dispatch] = useReducer(jobsReducer, undefined, () =>
    loadJobs(drive),
  );
  const [duplicate, setDuplicate] = useState<{
    url: string;
    subfolder: string;
    existing: ClipJob[];
  } | null>(null);

  useEffect(() => {
    saveJobs(drive, jobs);
  }, [drive, jobs]);

  const clipReady = useWebSocket("knowledge.clip.ready");
  useEffect(() => {
    if (!clipReady) return;
    const d = clipReady.data as { file_id?: string; title?: string };
    if (!d.file_id) return;
    dispatch({ type: "update", fileId: d.file_id, patch: { status: "ready", title: d.title } });
  }, [clipReady]);

  const clipFailed = useWebSocket("knowledge.clip.failed");
  useEffect(() => {
    if (!clipFailed) return;
    const d = clipFailed.data as { file_id?: string; error?: string };
    if (!d.file_id) return;
    dispatch({ type: "update", fileId: d.file_id, patch: { status: "failed", error: d.error } });
  }, [clipFailed]);

  const handleJobAdded = useCallback((fileId: string, job: RecentJob) => {
    dispatch({ type: "add", fileId, job });
  }, []);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 px-4 py-10 md:px-6">
      <CaptureZone
        drive={drive}
        initialUrl={prefillUrl}
        initialTitle={prefillTitle}
        autoSubmit={autoSubmit}
        onJobAdded={handleJobAdded}
        onDuplicate={(url, subfolder, existing) =>
          setDuplicate({ url, subfolder, existing })
        }
      />
      <ClipQueueZone drive={drive} jobs={jobs} />
      <ConnectionsGraph drive={drive} />

      {duplicate && (
        <ClipDuplicateDialog
          drive={drive}
          url={duplicate.url}
          subfolder={duplicate.subfolder}
          existing={duplicate.existing}
          onOpenExisting={() => setDuplicate(null)}
          onCreated={(job) => {
            handleJobAdded(job.file_id, {
              status: "fetching",
              url: duplicate.url,
              subfolder: duplicate.subfolder,
              addedAt: Date.now(),
            });
            setDuplicate(null);
          }}
          onClose={() => setDuplicate(null)}
        />
      )}
    </div>
  );
}
