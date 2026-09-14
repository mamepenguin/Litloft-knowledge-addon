"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/ToastProvider";
import { useWebSocket } from "@/hooks/useWebSocket";

import { pendingClipsVersion, subscribePendingClips, takePendingClip } from "./pendingClips";

/**
 * `header-actions` entry that draws nothing. It announces the result of a
 * clip sent from the Add menu in this tab, and ignores every other job.
 * The provider's last event is re-read on remount and whenever a job is
 * added, so a result that arrived while this was unmounted, or before its
 * clip was accepted, is still announced.
 */
export default function ClipNotifier() {
  const t = useTranslations("knowledge.clipNotifier");
  const { success, error } = useToast();
  const ready = useWebSocket("knowledge.clip.ready");
  const failed = useWebSocket("knowledge.clip.failed");
  const added = useSyncExternalStore(subscribePendingClips, pendingClipsVersion, pendingClipsVersion);

  useEffect(() => {
    if (!ready) return;
    const data = ready.data as { job_id?: unknown; title?: unknown };
    if (typeof data.job_id !== "number" || !takePendingClip(data.job_id)) return;
    success(
      typeof data.title === "string" && data.title
        ? t("ready", { title: data.title })
        : t("readyUntitled"),
    );
  }, [ready, added, t, success]);

  useEffect(() => {
    if (!failed) return;
    const data = failed.data as { job_id?: unknown };
    if (typeof data.job_id !== "number" || !takePendingClip(data.job_id)) return;
    error(t("failed"));
  }, [failed, added, t, error]);

  return null;
}
