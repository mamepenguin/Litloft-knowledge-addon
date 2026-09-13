"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";

import { useDialogPortalTarget } from "@/components/DialogPortal";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useWebSocket } from "@/hooks/useWebSocket";
import { OVERLAY_PRIORITY } from "@/lib/shortcuts";

import type { ClipJob } from "./api";
import ClipDuplicateDialog from "./ClipDuplicateDialog";
import ClipForm from "./ClipForm";

interface Props {
  drive: string;
  path: string;
  onCancel: () => void;
  onDone: () => void;
}

interface Attempt {
  url: string;
  subfolder: string;
}

type Stage =
  | { kind: "form"; failed: (Attempt & { error: string }) | null }
  | { kind: "duplicate"; attempt: Attempt; existing: ClipJob[] }
  | { kind: "fetching"; attempt: Attempt; jobId: number };

/**
 * The destination starts at the Add menu's `path`. The Knowledge page's
 * remembered subfolder is not read: the drive root (`""`) is a real
 * destination here, not "nothing chosen yet".
 *
 * A clip finishes asynchronously, and nothing outside the Knowledge page
 * listens for the result, so the dialog waits for its own job's event.
 */
export default function ClipWebPageDialog({ drive, path, onCancel, onDone }: Props) {
  const t = useTranslations("knowledge.clipWebPage");
  const tc = useTranslations("common");
  const host = useDialogPortalTarget();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "form", failed: null });
  const [formKey, setFormKey] = useState(0);
  const clipReady = useWebSocket("knowledge.clip.ready");
  const clipFailed = useWebSocket("knowledge.clip.failed");

  useShortcuts(
    "knowledge-clip-web-page-dialog",
    "Dialog",
    [
      {
        key: "escape",
        label: "Cancel",
        editingOnly: false,
        hidden: true,
        handler: onCancel,
      },
    ],
    true,
    OVERLAY_PRIORITY,
  );

  useEffect(() => {
    if (stage.kind !== "fetching" || !clipReady) return;
    const data = clipReady.data as { job_id?: number; file_id?: string };
    if (data.job_id !== stage.jobId || !data.file_id) return;
    onDone();
    router.push(`/files/${data.file_id}`);
  }, [clipReady, stage, onDone, router]);

  useEffect(() => {
    if (stage.kind !== "fetching" || !clipFailed) return;
    const data = clipFailed.data as { job_id?: number; error?: string };
    if (data.job_id !== stage.jobId) return;
    setStage({
      kind: "form",
      failed: { ...stage.attempt, error: data.error || t("failed") },
    });
    setFormKey((k) => k + 1);
  }, [clipFailed, stage, t]);

  if (!host) return null;

  const startFetching = (attempt: Attempt, job: ClipJob) =>
    setStage({ kind: "fetching", attempt, jobId: job.job_id });

  if (stage.kind === "duplicate") {
    return createPortal(
      <ClipDuplicateDialog
        drive={drive}
        url={stage.attempt.url}
        subfolder={stage.attempt.subfolder}
        existing={stage.existing}
        onOpenExisting={(fileId) => {
          onDone();
          router.push(`/files/${fileId}`);
        }}
        onCreated={(job) => startFetching(stage.attempt, job)}
        onClose={onCancel}
      />,
      host,
    );
  }

  const failed = stage.kind === "form" ? stage.failed : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      role="dialog"
      aria-modal
      aria-label={t("title")}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onCancel}
      />
      <div className="relative mx-4 w-full max-w-md animate-fade-in-scale">
        <div className="space-y-4 rounded-xl border border-bg-border bg-bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>
            <button
              type="button"
              onClick={onCancel}
              className="text-text-muted transition-colors hover:text-text-primary"
              aria-label={tc("close")}
            >
              <X size={16} />
            </button>
          </div>
          {stage.kind === "fetching" ? (
            <div role="status" className="space-y-2">
              <p className="flex items-center gap-2 text-sm text-text-primary">
                <Loader2 size={14} className="animate-spin" strokeWidth={1.6} />
                {t("fetching")}
              </p>
              <p className="text-xs text-text-muted">{t("closeWhileFetching")}</p>
            </div>
          ) : (
            <>
              {failed && (
                <p role="alert" className="rounded-2xl bg-danger/10 px-3 py-2 text-sm text-danger">
                  {failed.error}
                </p>
              )}
              <ClipForm
                key={formKey}
                drive={drive}
                initialUrl={failed?.url ?? ""}
                initialSubfolder={failed?.subfolder ?? path}
                onSubmitted={({ job, url, subfolder }) =>
                  startFetching({ url, subfolder }, job)
                }
                onDuplicate={(url, subfolder, existing) =>
                  setStage({ kind: "duplicate", attempt: { url, subfolder }, existing })
                }
              />
            </>
          )}
        </div>
      </div>
    </div>,
    host,
  );
}
