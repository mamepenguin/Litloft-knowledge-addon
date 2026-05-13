"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  createClip,
  findClipsByUrl,
  listKnowledgeFolders,
  type ClipJob,
  type CoreFolderItem,
} from "./api";

function subfolderKey(drive: string): string {
  return `knowledge:lastSubfolder:${drive}`;
}

function loadLastSubfolder(drive: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(subfolderKey(drive)) ?? "";
  } catch {
    return "";
  }
}

function saveLastSubfolder(drive: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(subfolderKey(drive), value);
    else window.localStorage.removeItem(subfolderKey(drive));
  } catch {
    // ignore quota / disabled storage
  }
}

export interface ClipDuplicateMatch {
  existing: ClipJob[];
  url: string;
  subfolder: string;
}

interface Props {
  drive: string;
  initialUrl?: string;
  initialTitle?: string;
  autoSubmit?: boolean;
  onClipSubmitted: (job: ClipJob) => void;
  onDuplicate: (match: ClipDuplicateMatch) => void;
}

export default function ClipInput({
  drive,
  initialUrl = "",
  initialTitle = "",
  autoSubmit = false,
  onClipSubmitted,
  onDuplicate,
}: Props) {
  const t = useTranslations("knowledge.clip");
  const [url, setUrl] = useState(initialUrl);
  // Title hint is kept in state (not shown in UI) so the prefill title
  // from a bookmarklet flows into the POST body, giving the placeholder
  // a readable filename instead of a timestamped stub.
  const [titleHint] = useState(initialTitle);
  const [subfolder, setSubfolder] = useState<string>(() =>
    loadLastSubfolder(drive),
  );
  const [folders, setFolders] = useState<CoreFolderItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await listKnowledgeFolders(drive, "");
        if (!cancelled) setFolders(items);
      } catch {
        // Folders list is optional — empty list just means "root only".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drive]);

  const submit = useCallback(
    async (overrideUrl?: string) => {
      const targetUrl = (overrideUrl ?? url).trim();
      if (!targetUrl) return;
      setSubmitting(true);
      setError(null);
      try {
        const existing = await findClipsByUrl(drive, targetUrl);
        if (existing.length > 0) {
          onDuplicate({ existing, url: targetUrl, subfolder });
          return;
        }
        const job = await createClip(drive, {
          url: targetUrl,
          subfolder: subfolder || null,
          title: titleHint || null,
        });
        saveLastSubfolder(drive, subfolder);
        setUrl("");
        onClipSubmitted(job);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [drive, onClipSubmitted, onDuplicate, subfolder, titleHint, url],
  );

  useEffect(() => {
    if (autoSubmit && initialUrl) {
      submit(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit();
  };

  return (
    <form
      onSubmit={onFormSubmit}
      className="flex flex-col gap-3"
      aria-label={t("formLabel")}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("urlPlaceholder")}
          aria-label={t("urlPlaceholder")}
          disabled={submitting}
          className="flex-1 rounded-2xl border border-bg-border bg-bg-card px-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring disabled:opacity-50"
        />
        <select
          value={subfolder}
          onChange={(e) => setSubfolder(e.target.value)}
          disabled={submitting}
          aria-label={t("subfolderLabel")}
          className="rounded-2xl border border-bg-border bg-bg-card px-3 py-2 text-sm text-text-primary focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring disabled:opacity-50"
        >
          <option value="">{t("rootFolder")}</option>
          {folders.map((f) => (
            <option key={f.path} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={submitting || !url.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin" strokeWidth={1.6} />
          ) : null}
          <span>{t("submit")}</span>
        </button>
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
