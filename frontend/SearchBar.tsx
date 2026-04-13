"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  searchVault,
  type SearchHit,
  type Vault,
  type CoreFileItem,
} from "./api";

interface Props {
  vault: Vault;
  onSelect: (file: CoreFileItem) => void;
}

export default function SearchBar({ vault, onSelect }: Props) {
  const t = useTranslations("knowledge.search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setError(null);
      return;
    }
    const q = query.trim();
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await searchVault(vault.id, q);
        setResults(res.results);
        setTruncated(res.truncated);
      } catch (e) {
        setError((e as Error).message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, vault.id]);

  const handleHitClick = useCallback(
    (hit: SearchHit) => {
      onSelect({
        id: hit.file_id,
        filename: hit.filename,
        title: hit.title,
        drive: vault.drive,
        folder_path: vault.path,
        file_type: "document",
        mime_type: "text/markdown",
        thumbnail_url: "",
        file_size: 0,
        created_at: "",
        updated_at: "",
      });
    },
    [onSelect, vault.drive, vault.path],
  );

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("placeholder")}
          className="w-full rounded border border-border-default bg-surface-base py-2 pl-9 pr-9 text-sm text-text-primary"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("clear")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {error && <div className="text-sm text-accent-danger">{error}</div>}

      {loading && (
        <div className="text-sm text-text-muted">{t("searching")}</div>
      )}

      {results !== null && !loading && (
        <div className="rounded border border-border-default bg-surface-elevated">
          {results.length === 0 ? (
            <div className="p-4 text-sm text-text-muted">{t("noResults")}</div>
          ) : (
            <ul className="divide-y divide-border-default">
              {results.map((hit) => (
                <li key={hit.file_id}>
                  <button
                    type="button"
                    onClick={() => handleHitClick(hit)}
                    className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-surface-hover"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <FileText size={14} className="text-text-muted" />
                      {hit.title || hit.filename}
                    </span>
                    {hit.snippet && (
                      <span className="text-xs text-text-muted">
                        {hit.snippet}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {truncated && (
            <div className="border-t border-border-default px-4 py-2 text-xs text-text-muted">
              {t("truncated")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
