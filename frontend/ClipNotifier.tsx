"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/ToastProvider";
import { useWebSocket } from "@/hooks/useWebSocket";

import { takePendingClip } from "./pendingClips";

/**
 * `header-actions` entry that draws nothing. It announces the result of a
 * clip sent from the Add menu in this tab, and ignores every other job.
 * Remounting re-reads the provider's last event, which is how a result that
 * arrived while this was unmounted is still announced.
 */
export default function ClipNotifier() {
  const t = useTranslations("knowledge.clipNotifier");
  const { success, error } = useToast();
  const ready = useWebSocket("knowledge.clip.ready");
  const failed = useWebSocket("knowledge.clip.failed");

  useEffect(() => {
    if (!ready) return;
    const data = ready.data as { job_id?: unknown; title?: unknown };
    if (typeof data.job_id !== "number" || !takePendingClip(data.job_id)) return;
    success(
      typeof data.title === "string" && data.title
        ? t("ready", { title: data.title })
        : t("readyUntitled"),
    );
  }, [ready, t, success]);

  useEffect(() => {
    if (!failed) return;
    const data = failed.data as { job_id?: unknown };
    if (typeof data.job_id !== "number" || !takePendingClip(data.job_id)) return;
    error(t("failed"));
  }, [failed, t, error]);

  return null;
}
