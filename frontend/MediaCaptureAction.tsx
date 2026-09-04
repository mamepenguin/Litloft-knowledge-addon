"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Quote } from "lucide-react";
import { useTranslations } from "next-intl";

import type { MediaController } from "@/lib/mediaController";
import type { DocumentCaptureController } from "@/lib/documentCapture";
import { addSourceCapture } from "@/lib/sourceCapture";
import { useToast } from "@/components/ToastProvider";

export default function MediaCaptureAction({
  fileId,
  drive,
  filename,
  fileType,
  mediaController,
  documentCaptureController,
}: {
  fileId: string;
  drive: string;
  filename: string;
  fileType: string;
  mediaController?: MediaController | null;
  documentCaptureController?: DocumentCaptureController | null;
}) {
  const t = useTranslations("knowledge.captureBasket");
  const toast = useToast();
  const documentCapture = useSyncExternalStore(
    documentCaptureController?.subscribe ?? (() => () => undefined),
    documentCaptureController?.getSnapshot ?? (() => null),
    () => null,
  );
  if (!mediaController && !documentCapture) return null;

  const capture = () => {
    try {
      const item = documentCapture
        ? {
            drive,
            sourceFileId: fileId,
            filename,
            fileType,
            kind: documentCapture.kind === "page"
              ? ("pdf_page" as const)
              : ("document_selection" as const),
            locator: documentCapture.locator,
            quote: documentCapture.quote,
          }
        : {
            drive,
            sourceFileId: fileId,
            filename,
            fileType,
            kind: "media_timestamp" as const,
            locator: {
              seconds: Math.max(
                0,
                Math.floor(mediaController!.getCurrentTime()),
              ),
            },
          };
      const result = addSourceCapture({
        ...item,
      });
      toast[result.added ? "success" : "info"](
        t(result.added ? "added" : "duplicate"),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("addFailed"));
    }
  };

  const label = documentCapture
    ? t(documentCapture.kind === "page" ? "capturePage" : "captureSelection")
    : t("capturePosition");

  const button = (
    <button
      type="button"
      onPointerDown={(event) => event.preventDefault()}
      onClick={capture}
      title={label}
      aria-label={label}
      // 36px drawn, and 44px of target where the pointer is coarse.
      // The host's row grows its children to 44px, but only the compact
      // variant does, and "compact" is a viewport width test — so a
      // coarse-pointer tablet at 768px or wider gets the full row, which
      // has no such rule. `docs/ADDON-DEVELOPMENT.md` states the floor as
      // an obligation of the entry, so the entry keeps it rather than
      // inheriting it from one of the two rows it can land in.
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-bg-border bg-bg-card text-text-muted shadow-sm transition-colors hover:bg-bg-elevated hover:text-text-primary pointer-coarse:h-11 pointer-coarse:w-11"
    >
      <Quote size={16} />
    </button>
  );

  if (documentCapture?.anchor && typeof document !== "undefined") {
    const { anchor } = documentCapture;
    return createPortal(
      <div
        className="fixed z-50"
        style={{
          left: Math.min(
            window.innerWidth - 44,
            Math.max(8, anchor.left + anchor.width / 2 - 18),
          ),
          top: Math.max(8, anchor.top - 44),
        }}
      >
        {button}
      </div>,
      document.body,
    );
  }

  return button;
}
