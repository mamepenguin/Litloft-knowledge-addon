"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { searchKnowledge, type SearchHit } from "./api";

export interface AutocompleteHit extends SearchHit {
  /**
   * Frontmatter ``id`` if the note carries one. Optional because
   * older notes / notes that haven't been backfilled won't have it.
   * When present, ``Shift+Enter`` inserts ``[[<md_id>]]`` for
   * disambiguation; otherwise it falls back to ``[[<basename>]]``.
   */
  md_id?: string;
}

export interface WikiLinkSelection {
  /** ``<basename>`` (filename without ``.md``) — the default insert. */
  basename: string;
  /** ``<md_id>`` when known. */
  mdId?: string;
}

interface Props {
  drive: string;
  /** Text typed AFTER ``[[`` (the active query, may be empty). */
  query: string;
  onSelect: (hit: WikiLinkSelection, shift: boolean) => void;
  onClose: () => void;
  externalKey?: number;
  anchor?: { top: number; left: number; lineHeight: number } | null;
}

const DEBOUNCE_MS = 100;

export interface WikiLinkAutocompleteHandle {
  handleKeyDown: (e: KeyboardEvent | React.KeyboardEvent) => boolean;
}

export const WikiLinkAutocomplete = function WikiLinkAutocomplete({
  drive,
  query,
  onSelect,
  onClose,
  handleRef,
  anchor,
}: Props & { handleRef?: { current: WikiLinkAutocompleteHandle | null } }) {
  const t = useTranslations("knowledge.wikiAutocomplete");
  const [hits, setHits] = useState<AutocompleteHit[]>([]);
  const [highlight, setHighlight] = useState(0);
  const hitsRef = useRef<AutocompleteHit[]>([]);
  const highlightRef = useRef(0);
  hitsRef.current = hits;
  highlightRef.current = highlight;

  const firstFetchRef = useRef(true);
  useEffect(() => {
    if (query.length === 0) {
      setHits([]);
      setHighlight(0);
      return;
    }
    let cancelled = false;
    function run() {
      searchKnowledge(drive, query)
        .then((res) => {
          if (cancelled) return;
          setHits(res.results as AutocompleteHit[]);
          setHighlight(0);
        })
        .catch(() => {
          if (!cancelled) {
            setHits([]);
            setHighlight(0);
          }
        });
    }
    if (firstFetchRef.current) {
      firstFetchRef.current = false;
      run();
      return () => {
        cancelled = true;
      };
    }
    const handle = setTimeout(run, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [drive, query]);

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      handleKeyDown: (e) => {
        const list = hitsRef.current;
        if (e.key === "ArrowDown") {
          if (list.length === 0) return true;
          setHighlight((h) => (h + 1) % list.length);
          e.preventDefault?.();
          return true;
        }
        if (e.key === "ArrowUp") {
          if (list.length === 0) return true;
          setHighlight((h) => (h - 1 + list.length) % list.length);
          e.preventDefault?.();
          return true;
        }
        if (e.key === "Enter") {
          const pick = list[highlightRef.current];
          if (!pick) {
            onClose();
            return true;
          }
          const basename = pick.filename.replace(/\.md$/i, "");
          onSelect(
            { basename, mdId: pick.md_id },
            (e as KeyboardEvent).shiftKey === true,
          );
          e.preventDefault?.();
          return true;
        }
        if (e.key === "Escape") {
          onClose();
          e.preventDefault?.();
          return true;
        }
        return false;
      },
    };
    return () => {
      if (handleRef.current?.handleKeyDown) {
        handleRef.current = null;
      }
    };
  }, [handleRef, onSelect, onClose]);

  const popupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const el = popupRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && el.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("touchstart", onPointerDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("touchstart", onPointerDown, true);
    };
  }, [onClose]);
  const [flipTop, setFlipTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!anchor) {
      setFlipTop(null);
      return;
    }
    const el = popupRef.current;
    if (!el) return;
    const popupHeight = el.offsetHeight;
    const belowTop = anchor.top + anchor.lineHeight + 4;
    if (belowTop + popupHeight <= window.innerHeight) {
      setFlipTop(belowTop);
    } else {
      setFlipTop(Math.max(4, anchor.top - popupHeight - 4));
    }
  }, [anchor, hits.length]);

  const positionedStyle: React.CSSProperties | undefined = anchor
    ? {
        position: "fixed",
        top: flipTop ?? anchor.top + anchor.lineHeight + 4,
        left: anchor.left,
      }
    : undefined;

  const popup = (
    <div
      ref={popupRef}
      data-testid="wiki-link-autocomplete"
      style={positionedStyle}
      className={`${
        anchor ? "z-50" : "absolute z-50 mt-1"
      } max-h-64 w-72 overflow-auto rounded-xl border border-bg-border bg-bg-card shadow-lg`}
    >
      <ul
        role="listbox"
        aria-label={t("placeholder")}
        className="flex flex-col"
      >
        {hits.length === 0 ? (
          <li className="px-3 py-2 text-xs text-text-muted">
            {t("emptyState")}
          </li>
        ) : (
          hits.map((hit, idx) => {
            const isActive = idx === highlight;
            const basename = hit.filename.replace(/\.md$/i, "");
            return (
              <li
                key={hit.file_id}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(
                    { basename, mdId: hit.md_id },
                    e.shiftKey,
                  );
                }}
                className={`cursor-pointer px-3 py-1.5 text-sm ${
                  isActive
                    ? "bg-bg-elevated text-text-primary"
                    : "text-text-muted hover:bg-bg-elevated"
                }`}
              >
                {hit.title || basename}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );

  if (anchor && typeof document !== "undefined") {
    return createPortal(popup, document.body);
  }
  return popup;
};
