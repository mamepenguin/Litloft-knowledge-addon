"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Film, Image, Music, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { getDriveFiles } from "@/lib/api";
import type { FileItem } from "@/types";

interface Props {
  drive: string;
  onSelect: (file: { filename: string; fileId: string }) => void;
  onClose: () => void;
}

function fileIcon(type: string | undefined) {
  switch (type) {
    case "video": return <Film size={14} className="shrink-0 text-accent-blue" />;
    case "audio": return <Music size={14} className="shrink-0 text-accent-green" />;
    case "image": return <Image size={14} className="shrink-0 text-accent-pink" />;
    default:      return <FileText size={14} className="shrink-0 text-text-muted" />;
  }
}

export default function FileLinkModal({ drive, onSelect, onClose }: Props) {
  const t = useTranslations("knowledge.fileLinkModal");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const tid = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await getDriveFiles(drive, { search: query, limit: 20 }, { signal: ctrl.signal });
        setResults(res.data);
      } catch {
        // AbortError on cleanup is expected; ignore
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(tid);
      abortRef.current?.abort();
    };
  }, [query, drive]);

  function handleSelect(file: FileItem) {
    const raw = file.title || file.filename;
    // Escape Markdown special chars so the filename is safe as link text.
    // Without this, a filename like "evil](url) [" would produce a broken
    // or injected Markdown link when inserted into the editor.
    const safeFilename = raw.replace(/([\[\]()\\])/g, "\\$1");
    onSelect({ filename: safeFilename, fileId: file.id });
  }

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal
      aria-label={t("title")}
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-xl bg-bg-card p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">{t("title")}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-text-primary"
            aria-label={t("close")}
          >
            <X size={14} />
          </button>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-lg border border-bg-border bg-bg-primary py-2 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none"
          />
        </div>

        <div className="max-h-64 overflow-y-auto rounded-lg border border-bg-border">
          {loading && (
            <p className="px-3 py-4 text-center text-xs text-text-muted">{t("searching")}</p>
          )}
          {!loading && query && results.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-text-muted">{t("noResults")}</p>
          )}
          {!loading && !query && (
            <p className="px-3 py-4 text-center text-xs text-text-muted">{t("typeToSearch")}</p>
          )}
          {results.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => handleSelect(file)}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-bg-elevated"
            >
              {fileIcon(file.file_type)}
              <span className="min-w-0 flex-1 truncate text-text-primary">
                {file.title || file.filename}
              </span>
              {file.folder_path && (
                <span className="shrink-0 text-[11px] text-text-muted">
                  {file.folder_path}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
