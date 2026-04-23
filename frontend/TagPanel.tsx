"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { getFileTags, listDriveTags, updateFileTags } from "./api";

interface Props {
  fileId: string;
  drive: string;
  x: number;
  y: number;
  onClose: () => void;
}

export default function TagPanel({ fileId, drive, x, y, onClose }: Props) {
  const t = useTranslations("knowledge.tags");
  const [tags, setTags] = useState<string[]>([]);
  const [driveTags, setDriveTags] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Position correction
  const PANEL_WIDTH = 240;
  const PANEL_HEIGHT = 200;
  const adjustedX = x + PANEL_WIDTH > window.innerWidth ? window.innerWidth - PANEL_WIDTH - 8 : x;
  const adjustedY = y + PANEL_HEIGHT > window.innerHeight ? window.innerHeight - PANEL_HEIGHT - 8 : y;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [fileTags, dTags] = await Promise.all([
          getFileTags(fileId),
          listDriveTags(drive),
        ]);
        setTags(fileTags);
        setDriveTags(dTags.map((d) => d.name));
      } finally {
        setLoading(false);
      }
    }
    void load();
    inputRef.current?.focus();
  }, [fileId, drive]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) {
      setSuggestions([]);
      setActiveSuggestion(-1);
      return;
    }
    const filtered = driveTags
      .filter((t) => t.toLowerCase().startsWith(trimmed) && !tags.includes(t))
      .slice(0, 5);
    setSuggestions(filtered);
    setActiveSuggestion(-1);
  }, [input, driveTags, tags]);

  async function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    const next = [...tags, trimmed];
    setTags(next);
    setInput("");
    setSuggestions([]);
    try {
      await updateFileTags(fileId, next);
    } catch {
      setTags(tags);
    }
  }

  async function removeTag(tag: string) {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    try {
      await updateFileTags(fileId, next);
    } catch {
      setTags(tags);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestion((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeSuggestion >= 0 && suggestions[activeSuggestion]) {
        void addTag(suggestions[activeSuggestion]);
      } else {
        void addTag(input);
      }
    }
  }

  return (
    <div
      ref={panelRef}
      data-context-menu
      style={{ top: adjustedY, left: adjustedX }}
      className="fixed z-50 w-60 overflow-hidden rounded-lg border border-bg-border bg-bg-elevated shadow-xl animate-fade-in-scale"
    >
      <div className="border-b border-bg-border px-3 py-2">
        <p className="text-xs font-semibold text-text-primary">{t("manage")}</p>
      </div>
      <div className="p-2">
        {loading ? (
          <p className="py-2 text-center text-xs text-text-muted">{t("loading")}</p>
        ) : (
          <>
            {tags.length === 0 && (
              <p className="mb-2 text-xs text-text-muted">{t("empty")}</p>
            )}
            {tags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => void removeTag(tag)}
                      aria-label={`Remove tag ${tag}`}
                      className="flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-accent/30"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative flex items-center gap-1">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("addPlaceholder")}
                className="flex-1 rounded-md border border-bg-border bg-bg-primary px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => void addTag(input)}
                aria-label={t("add")}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent hover:bg-accent/25"
              >
                <Plus size={12} />
              </button>
            </div>
            {suggestions.length > 0 && (
              <ul className="mt-1 overflow-hidden rounded-md border border-bg-border bg-bg-primary">
                {suggestions.map((s, i) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => void addTag(s)}
                      className={[
                        "w-full px-2 py-1 text-left text-xs transition-colors",
                        i === activeSuggestion
                          ? "bg-accent/15 text-accent"
                          : "text-text-primary hover:bg-bg-elevated",
                      ].join(" ")}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
