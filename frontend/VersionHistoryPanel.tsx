"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookmarkCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  History,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  getFileVersion,
  getFileVersionDiff,
  listFileVersions,
  type FileVersionBody,
  type FileVersionDiff,
  type FileVersionListResponse,
} from "./api";
import { decodeLinkTargets } from "./versionPreview";
import { registerVersionHistory } from "./versionHistoryChannel";

const PAGE_SIZE = 50;

interface Props {
  fileId: string;
  refreshKey: number;
  onRestore: (versionId: number) => Promise<boolean>;
}

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(months / 12), "year");
}

function absoluteTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export default function VersionHistoryPanel({
  fileId,
  refreshKey,
  onRestore,
}: Props) {
  const t = useTranslations("knowledge.editor.versions");
  const sectionRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<FileVersionListResponse | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [body, setBody] = useState<FileVersionBody | null>(null);
  const [diff, setDiff] = useState<FileVersionDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffAttempt, setDiffAttempt] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Published for the `[...]` menu and the editor toolbar. Both are
  // outside this subtree, so the panel hands them the way in rather than
  // lifting `open` into a component neither of them shares with it.
  const reveal = useCallback(() => {
    setOpen(true);
    sectionRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => registerVersionHistory(fileId, reveal), [fileId, reveal]);

  useEffect(() => {
    setOffset(0);
    setPage(null);
    setSelectedId(null);
    setBody(null);
    setDiff(null);
    setDiffError(null);
    setError(null);
  }, [fileId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listFileVersions(fileId, { limit: PAGE_SIZE, offset })
      .then((result) => {
        if (cancelled) return;
        setPage(result);
        setSelectedId((current) =>
          current !== null && result.versions.some((item) => item.id === current)
            ? current
            : (result.versions[0]?.id ?? null),
        );
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, offset, open, refreshKey]);

  // The body and the diff are fetched apart so that one failing does not
  // take the other's result off the screen: they used to share a
  // `Promise.all` and a single error band, so a diff that 500s left the
  // reader with no body either, and no way to ask for just the diff again.
  useEffect(() => {
    if (!open || selectedId === null) {
      setBody(null);
      return;
    }
    let cancelled = false;
    setBodyLoading(true);
    setError(null);
    getFileVersion(fileId, selectedId)
      .then((next) => {
        if (!cancelled) setBody(next);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setBodyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, open, selectedId]);

  // `diffAttempt` is the retry, and it is deliberately absent from the
  // effect above: retrying the diff must not re-fetch the body.
  useEffect(() => {
    if (!open || selectedId === null) {
      setDiff(null);
      setDiffError(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);
    getFileVersionDiff(fileId, selectedId)
      .then((next) => {
        if (!cancelled) setDiff(next);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setDiff(null);
        setDiffError(err.message);
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, open, selectedId, diffAttempt]);

  async function handleRestore() {
    if (selectedId === null || restoring) return;
    setRestoring(true);
    setError(null);
    try {
      await onRestore(selectedId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  const hasPrevious = offset > 0;
  const hasNext = page !== null && offset + page.limit < page.total;

  return (
    <section ref={sectionRef} className="border-t border-bg-border bg-bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t(open ? "toggleClose" : "toggleOpen")}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated"
      >
        <History size={16} className="text-text-muted" />
        <span className="flex-1">{t("heading")}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <div className="border-t border-bg-border p-4">
          {error && (
            <div
              role="status"
              className="mb-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span className="break-anywhere">{error}</span>
            </div>
          )}

          {loading && page === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-muted">
              <Loader2 size={15} className="animate-spin" />
              {t("loading")}
            </div>
          ) : page?.versions.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">{t("empty")}</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
              <div className="min-w-0">
                <div className="overflow-hidden rounded-xl border border-bg-border">
                  {page?.versions.map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      data-testid={`version-row-${version.id}`}
                      aria-pressed={selectedId === version.id}
                      onClick={() => setSelectedId(version.id)}
                      className={`flex w-full items-center gap-2 border-b border-bg-border px-3 py-2.5 text-left text-xs last:border-b-0 ${
                        selectedId === version.id
                          ? "bg-bg-elevated text-text-primary"
                          : "bg-bg-card text-text-muted hover:bg-bg-elevated"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {/* Absolute first: two versions saved the same
                              afternoon are both "12 days ago", and the
                              relative form alone cannot tell them apart. */}
                          <time
                            dateTime={version.created_at}
                            className="min-w-0 text-text-primary"
                          >
                            <span className="block font-medium tabular-nums">
                              {absoluteTime(version.created_at)}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-text-muted">
                              {relativeTime(version.created_at)}
                            </span>
                          </time>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-text-muted">
                          {version.kind === "explicit" && (
                            <BookmarkCheck
                              size={12}
                              aria-hidden="true"
                              className="shrink-0 text-accent"
                            />
                          )}
                          <span className="truncate">
                            {t(version.kind === "explicit" ? "explicit" : "auto")}
                            {version.nickname ? ` · ${version.nickname}` : ""}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-accent-teal">
                        +{version.lines_added}
                      </span>
                      <span className="shrink-0 tabular-nums text-danger">
                        −{version.lines_removed}
                      </span>
                    </button>
                  ))}
                </div>

                {page && page.total > page.limit && (
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={!hasPrevious || loading}
                      onClick={() => setOffset(Math.max(0, offset - page.limit))}
                      aria-label={t("previousPage")}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-bg-border text-text-muted hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <span className="text-xs tabular-nums text-text-muted">
                      {t("page", {
                        current: Math.floor(offset / page.limit) + 1,
                        total: Math.ceil(page.total / page.limit),
                      })}
                    </span>
                    <button
                      type="button"
                      disabled={!hasNext || loading}
                      onClick={() => setOffset(offset + page.limit)}
                      aria-label={t("nextPage")}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-bg-border text-text-muted hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                )}
              </div>

              <div className="min-w-0 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {t("selectedTitle")}
                  </h3>
                  <button
                    type="button"
                    disabled={selectedId === null || restoring || bodyLoading}
                    onClick={handleRestore}
                    className="inline-flex items-center gap-2 rounded-lg bg-sand px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-sand-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {restoring ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                    {t(restoring ? "restoring" : "restore")}
                  </button>
                </div>

                <div>
                  <h4 className="mb-2 text-xs font-semibold text-text-muted">
                    {t("diff")}
                  </h4>
                  {/* Waiting, unchanged and failed are three different
                      answers. They used to share one blank `<pre>`, which
                      said "nothing changed" for all three. */}
                  {diffLoading ? (
                    <div
                      role="status"
                      aria-label={t("diffLoading")}
                      data-testid="version-diff-skeleton"
                      className="space-y-2 rounded-xl bg-bg-elevated p-3"
                    >
                      <div className="h-3 w-5/6 animate-pulse rounded bg-bg-border" />
                      <div className="h-3 w-2/3 animate-pulse rounded bg-bg-border" />
                      <div className="h-3 w-3/4 animate-pulse rounded bg-bg-border" />
                    </div>
                  ) : diffError ? (
                    <div
                      role="status"
                      data-testid="version-diff-error"
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
                    >
                      <AlertCircle size={14} className="shrink-0" />
                      <span className="flex-1 break-anywhere">{t("diffFailed")}</span>
                      <button
                        type="button"
                        onClick={() => setDiffAttempt((value) => value + 1)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-danger/30 px-2 py-1 font-medium transition-colors hover:bg-danger/10"
                      >
                        <RotateCcw size={13} />
                        {t("diffRetry")}
                      </button>
                    </div>
                  ) : diff && diff.lines.length === 0 ? (
                    <p
                      data-testid="version-diff-unchanged"
                      className="rounded-xl bg-bg-elevated px-3 py-2 text-xs text-text-muted"
                    >
                      {t("diffUnchanged")}
                    </p>
                  ) : (
                    <pre
                      data-testid="version-diff"
                      className="max-h-64 select-text overflow-auto rounded-xl bg-bg-elevated p-3 font-mono text-xs leading-relaxed text-text-primary"
                    >
                      {diff?.lines.map((line, index) => {
                        const prefix =
                          line.kind === "add"
                            ? "+"
                            : line.kind === "del"
                              ? "−"
                              : " ";
                        const color =
                          line.kind === "add"
                            ? "text-accent-teal"
                            : line.kind === "del"
                              ? "text-danger"
                              : "text-text-primary";
                        return (
                          <span key={index} className={color}>
                            <span aria-hidden="true" className="select-none">
                              {prefix}
                            </span>
                            {line.text}
                          </span>
                        );
                      })}
                    </pre>
                  )}
                </div>

                {/* Closed by default: the panel is here to answer "what
                    changed", and the whole body pushed the diff off the
                    screen on anything longer than a screenful. */}
                <details data-testid="version-preview-disclosure" className="group">
                  <summary className="cursor-pointer list-none text-xs font-semibold text-text-muted transition-colors hover:text-text-primary [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex items-center gap-1">
                      <ChevronRight
                        size={13}
                        aria-hidden="true"
                        className="shrink-0 transition-transform group-open:rotate-90"
                      />
                      {t("preview")}
                    </span>
                  </summary>
                  {bodyLoading ? (
                    <p className="mt-2 text-xs text-text-muted">
                      {t("loadingVersion")}
                    </p>
                  ) : (
                    <pre
                      data-testid="version-preview"
                      className="mt-2 max-h-80 select-text overflow-auto whitespace-pre-wrap rounded-xl border border-bg-border bg-bg-primary p-3 font-mono text-xs leading-relaxed text-text-primary"
                    >
                      {body ? decodeLinkTargets(body.content) : ""}
                    </pre>
                  )}
                </details>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
