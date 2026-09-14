"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/Button";
import { FolderPicker } from "@/components/FolderPicker";

import { createClip, findClipsByUrl, type ClipJob } from "./api";

export interface ClipSubmitted {
  job: ClipJob;
  url: string;
  subfolder: string;
}

interface Props {
  drive: string;
  initialSubfolder: string;
  initialUrl?: string;
  initialTitle?: string;
  autoSubmit?: boolean;
  onSubmitted: (submitted: ClipSubmitted) => void;
  onDuplicate: (url: string, subfolder: string, existing: ClipJob[]) => void;
}

export default function ClipForm({
  drive,
  initialSubfolder,
  initialUrl = "",
  initialTitle = "",
  autoSubmit = false,
  onSubmitted,
  onDuplicate,
}: Props) {
  const tClip = useTranslations("knowledge.clip");
  const tDash = useTranslations("knowledge.dashboard");
  const [url, setUrl] = useState(initialUrl);
  const [titleHint] = useState(initialTitle);
  const [subfolder, setSubfolder] = useState(initialSubfolder);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl ?? url).trim();
    if (!targetUrl) return;
    setSubmitting(true);
    setError(null);
    try {
      const existing = await findClipsByUrl(drive, targetUrl);
      if (existing.length > 0) {
        onDuplicate(targetUrl, subfolder, existing);
        return;
      }
      const job = await createClip(drive, {
        url: targetUrl,
        subfolder: subfolder || null,
        title: titleHint || null,
      });
      setUrl("");
      onSubmitted({ job, url: targetUrl, subfolder });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [drive, url, subfolder, titleHint, onSubmitted, onDuplicate]);

  useEffect(() => {
    if (autoSubmit && initialUrl) void submit(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={tClip("urlPlaceholder")}
          disabled={submitting}
          aria-label={tDash("clipUrlLabel")}
          className="flex-1 rounded-2xl border border-bg-border bg-bg-card px-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring disabled:opacity-50"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={submitting || !url.trim()}
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin" strokeWidth={1.6} />
          ) : null}
          {tClip("submit")}
        </Button>
      </div>

      <FolderPicker drive={drive} value={subfolder} onChange={setSubfolder} />

      {error && (
        <p className="text-xs text-danger" role="alert">{error}</p>
      )}
    </form>
  );
}
