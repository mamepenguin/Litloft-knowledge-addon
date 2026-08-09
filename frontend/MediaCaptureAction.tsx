"use client";

import { Quote } from "lucide-react";
import { useTranslations } from "next-intl";

import type { MediaController } from "@/lib/mediaController";
import { addSourceCapture } from "@/lib/sourceCapture";
import { useToast } from "@/components/ToastProvider";

export default function MediaCaptureAction({
  fileId,
  drive,
  filename,
  fileType,
  mediaController,
}: {
  fileId: string;
  drive: string;
  filename: string;
  fileType: string;
  mediaController?: MediaController | null;
}) {
  const t = useTranslations("knowledge.captureBasket");
  const toast = useToast();
  if (!mediaController) return null;

  const capture = () => {
    try {
      const seconds = Math.max(0, Math.floor(mediaController.getCurrentTime()));
      const result = addSourceCapture({
        drive,
        sourceFileId: fileId,
        filename,
        fileType,
        kind: "media_timestamp",
        locator: { seconds },
      });
      toast[result.added ? "success" : "info"](
        t(result.added ? "added" : "duplicate"),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("addFailed"));
    }
  };

  return (
    <div className="flex justify-end px-3 pt-2">
      <button
        type="button"
        onClick={capture}
        title={t("capturePosition")}
        aria-label={t("capturePosition")}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-bg-border bg-bg-surface text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
      >
        <Quote size={16} />
      </button>
    </div>
  );
}
