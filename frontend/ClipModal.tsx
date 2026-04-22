"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link2, X } from "lucide-react";
import ClipInput, { type ClipDuplicateMatch } from "./ClipInput";
import type { ClipJob, Vault } from "./api";

export interface RecentJob {
  status: "fetching" | "ready" | "failed";
  url: string;
  title?: string;
  error?: string;
  subfolder: string;
}

interface Props {
  drive: string;
  vault: Vault;
  open: boolean;
  onClose: () => void;
  prefillUrl?: string;
  prefillTitle?: string;
  autoSubmit?: boolean;
  recentJobs: Map<string, RecentJob>;
  onSubmitted: (job: ClipJob, url: string, subfolder: string) => void;
  onDuplicate: (m: ClipDuplicateMatch) => void;
  onRetryPaste: (rj: {
    fileId: string;
    url: string;
    subfolder: string;
  }) => void;
}

export default function ClipModal({
  drive,
  vault,
  open,
  onClose,
  prefillUrl = "",
  prefillTitle = "",
  autoSubmit = false,
  recentJobs,
  onSubmitted,
  onDuplicate,
  onRetryPaste,
}: Props) {
  const t = useTranslations("knowledge.clip");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const jobsArray = Array.from(recentJobs.entries()).slice(-5).reverse();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="knowledge-clip-modal-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-10"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl animate-fade-in-scale rounded-2xl border border-bg-border bg-bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-bg-border px-5 py-3">
          <h2
            id="knowledge-clip-modal-title"
            className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary"
          >
            <Link2 size={14} strokeWidth={1.6} className="text-accent" />
            {t("modalTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("modalClose")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:bg-bg-elevated hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex flex-col gap-4 px-5 py-4">
          <ClipInput
            drive={drive}
            vault={vault}
            initialUrl={prefillUrl}
            initialTitle={prefillTitle}
            autoSubmit={autoSubmit}
            onClipSubmitted={(job) => onSubmitted(job, prefillUrl || "", "")}
            onDuplicate={onDuplicate}
          />
          {jobsArray.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[11px] font-semibold uppercase text-text-muted">
                {t("recentHeading")}
              </h3>
              <ul className="flex flex-col gap-1">
                {jobsArray.map(([fileId, job]) => (
                  <li
                    key={fileId}
                    className="flex items-center gap-2 rounded-xl border border-bg-border bg-bg-elevated px-3 py-2 text-sm"
                  >
                    <StatusBadge status={job.status} />
                    <span
                      className="flex-1 truncate text-text-primary"
                      title={job.url}
                    >
                      {job.title ?? job.url}
                    </span>
                    {job.status === "failed" && (
                      <button
                        type="button"
                        onClick={() =>
                          onRetryPaste({
                            fileId,
                            url: job.url,
                            subfolder: job.subfolder,
                          })
                        }
                        className="text-xs text-accent hover:underline"
                      >
                        {t("paste.title")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "fetching" | "ready" | "failed";
}) {
  const t = useTranslations("knowledge.clip.status");
  const color =
    status === "ready"
      ? "bg-accent-teal/15 text-accent-teal"
      : status === "failed"
        ? "bg-danger-bg text-danger"
        : "bg-accent-amber/15 text-accent-amber";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}
    >
      {t(status)}
    </span>
  );
}
