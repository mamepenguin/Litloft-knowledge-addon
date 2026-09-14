"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useState,
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
} from "lucide-react";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { useWebSocket } from "@/hooks/useWebSocket";
import { findClipsByUrl, type ClipJob } from "./api";
import ClipForm from "./ClipForm";
import ClipPasteForm from "./ClipPasteForm";
import BookmarkletDialog from "./BookmarkletDialog";
import ClipDuplicateDialog from "./ClipDuplicateDialog";

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
  | { type: "settle"; fileId: string; status: "ready" | "failed" }
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
    case "settle": {
      // A WS event may have settled the row while the lookup was in flight.
      const cur = next.get(action.fileId);
      if (!cur || cur.status !== "fetching") return state;
      next.set(action.fileId, { ...cur, status: action.status });
      return next;
    }
  }
}

// ---- Helpers ---------------------------------------------------------

function timeAgo(
  ms: number,
  t: (key: string, values: { count: number }) => string,
): string {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return t("seconds", { count: diff });
  if (diff < 3600) return t("minutes", { count: Math.floor(diff / 60) });
  if (diff < 86400) return t("hours", { count: Math.floor(diff / 3600) });
  return t("days", { count: Math.floor(diff / 86400) });
}

// ---- Zone 1: Capture -------------------------------------------------

function lastSubfolderKey(drive: string) {
  return `knowledge:lastSubfolder:${drive}`;
}

function readLastSubfolder(drive: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(lastSubfolderKey(drive)) ?? "";
  } catch {
    return "";
  }
}

function writeLastSubfolder(drive: string, subfolder: string) {
  try {
    window.localStorage.setItem(lastSubfolderKey(drive), subfolder);
  } catch {}
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
  const tDash = useTranslations("knowledge.dashboard");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const [bookmarkletOpen, setBookmarkletOpen] = useState(false);

  return (
    <section className="flex flex-col gap-3">
      {/* The dashboard's own "Quick memo" button is gone: Core's Quick Note
          action sits in the header on every screen, so a second entry point
          buried in the dashboard had no reason to exist.
          Spec 2026-08-13-global-quick-note.md §11. */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-text-muted">
          {tDash("capture")}
        </p>
      </div>

      <ClipForm
        drive={drive}
        submitVariant="secondary"
        initialSubfolder={readLastSubfolder(drive)}
        initialUrl={initialUrl}
        initialTitle={initialTitle}
        autoSubmit={autoSubmit}
        onSubmitted={({ job, url, subfolder }) => {
          writeLastSubfolder(drive, subfolder);
          onJobAdded(job.file_id, {
            status: "fetching",
            url,
            subfolder,
            addedAt: Date.now(),
          });
        }}
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
          {tDash("pasteHtml")}
        </button>
        <button
          type="button"
          onClick={() => setBookmarkletOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
        >
          <Bookmark size={12} strokeWidth={1.6} />
          {tDash("bookmarklet")}
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
  const tDash = useTranslations("knowledge.dashboard");
  const rows = Array.from(jobs.entries())
    .sort(([, a], [, b]) => b.addedAt - a.addedAt)
    .slice(0, JOB_MAX);

  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold text-text-muted">
        {tDash("clipHistory")}
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
  const tDash = useTranslations("knowledge.dashboard");
  const tTimeAgo = useTranslations("knowledge.dashboard.timeAgo");
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
        {timeAgo(job.addedAt, tTimeAgo)}
      </span>
      {job.status === "ready" && (
        <a
          href={`/files/${fileId}`}
          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          {tDash("open")}
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
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger/15">
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


// ---- Root ------------------------------------------------------------

export default function ClipSection() {
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

  useEffect(() => {
    if (!drive) return;
    const urls = new Set(
      Array.from(loadJobs(drive).values())
        .filter((job) => job.status === "fetching")
        .map((job) => job.url),
    );
    for (const url of urls) {
      findClipsByUrl(drive, url)
        .then((found) => {
          for (const clip of found) {
            if (clip.status === "ready" || clip.status === "failed") {
              dispatch({ type: "settle", fileId: clip.file_id, status: clip.status });
            }
          }
        })
        .catch(() => {});
    }
  }, [drive]);

  const handleJobAdded = useCallback((fileId: string, job: RecentJob) => {
    dispatch({ type: "add", fileId, job });
  }, []);

  return (
    <div className="flex flex-col gap-10">
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
