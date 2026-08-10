"use client";

import { Quote } from "lucide-react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/ToastProvider";
import { addSourceCapture, type NewSourceCapture } from "@/lib/sourceCapture";

/**
 * `search-result-actions` slot entry.
 *
 * The core owns the search snippet itself and hands us the capture it would
 * produce. We only add the affordance, so the row keeps reading as a search
 * result rather than a capture widget — the same shape as the transcript-row
 * and Ask-citation actions (spec `2026-08-09-source-capture-basket.md` §2).
 */
export default function SearchCaptureActions({
  capture,
}: {
  capture?: NewSourceCapture;
}) {
  const t = useTranslations("knowledge.captureBasket");
  const toast = useToast();
  if (!capture) return null;

  const add = (event: React.SyntheticEvent) => {
    // The row sits inside the card's link / click area.
    event.preventDefault();
    event.stopPropagation();
    try {
      const result = addSourceCapture(capture);
      toast[result.added ? "success" : "info"](
        t(result.added ? "added" : "duplicate"),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("addFailed"));
    }
  };

  return (
    <button
      type="button"
      onPointerDown={(event) => event.preventDefault()}
      onClick={add}
      aria-label={t("captureSearchMatch")}
      title={t("captureSearchMatch")}
      className="inline-flex h-5 w-5 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      <Quote size={12} />
    </button>
  );
}
