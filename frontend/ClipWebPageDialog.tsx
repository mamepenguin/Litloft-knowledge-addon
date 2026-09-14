"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { useDialogPortalTarget } from "@/components/DialogPortal";
import { useShortcuts } from "@/hooks/useShortcuts";
import { OVERLAY_PRIORITY } from "@/lib/shortcuts";

import type { ClipJob } from "./api";
import ClipDuplicateDialog from "./ClipDuplicateDialog";
import ClipForm from "./ClipForm";
import { addPendingClip } from "./pendingClips";

interface Props {
  drive: string;
  path: string;
  onCancel: () => void;
  onDone: () => void;
}

interface Duplicate {
  url: string;
  subfolder: string;
  existing: ClipJob[];
}

/**
 * The destination starts at the Add menu's `path`; the Knowledge page's
 * remembered subfolder is not read, because the drive root (`""`) is a
 * real destination here. The dialog closes as soon as the clip is
 * accepted: `ClipNotifier` announces the result.
 */
export default function ClipWebPageDialog({ drive, path, onCancel, onDone }: Props) {
  const t = useTranslations("knowledge.clipWebPage");
  const tc = useTranslations("common");
  const host = useDialogPortalTarget();
  const router = useRouter();
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);

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

  if (!host) return null;

  const accepted = (job: ClipJob) => {
    addPendingClip(job.job_id);
    onDone();
  };

  if (duplicate) {
    return createPortal(
      <ClipDuplicateDialog
        drive={drive}
        url={duplicate.url}
        subfolder={duplicate.subfolder}
        existing={duplicate.existing}
        onOpenExisting={(fileId) => {
          onDone();
          router.push(`/files/${fileId}`);
        }}
        onCreated={accepted}
        onClose={onCancel}
      />,
      host,
    );
  }

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
          <ClipForm
            drive={drive}
            initialSubfolder={path}
            onSubmitted={({ job }) => accepted(job)}
            onDuplicate={(url, subfolder, existing) =>
              setDuplicate({ url, subfolder, existing })
            }
          />
        </div>
      </div>
    </div>,
    host,
  );
}
