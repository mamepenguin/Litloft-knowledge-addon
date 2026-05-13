"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { listVaults, searchVault, type SearchHit } from "./api";

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
  /**
   * Vault ID for ``searchVault``. The host doesn't always know this
   * (e.g. inline-mounted editor in the file detail page); when 0 the
   * autocomplete still calls searchVault — the test mocks it directly
   * and production will be wired up once the editor has a vault prop.
   */
  vaultId: number;
  /** Text typed AFTER ``[[`` (the active query, may be empty). */
  query: string;
  /**
   * Fired when the user picks an option (Enter / Shift+Enter / click).
   * ``shift`` distinguishes the two insertion forms.
   */
  onSelect: (hit: WikiLinkSelection, shift: boolean) => void;
  /**
   * Fired on Esc / Backspace-past-trigger so the host can both close
   * the popup and (for Esc) keep the typed ``[[`` in the textarea.
   */
  onClose: () => void;
  /** Optional ref so the host can imperatively trigger keyboard nav. */
  externalKey?: number;
  /**
   * Viewport-space anchor point (the caret position right after the
   * ``[[`` trigger). When provided, the popup is rendered with
   * ``position: fixed`` and placed directly below the caret; if it
   * would extend past the viewport bottom, it flips above. When
   * ``null``/omitted, the popup falls back to its legacy in-flow
   * absolute positioning so existing callers don't regress.
   */
  anchor?: { top: number; left: number; lineHeight: number } | null;
}

const DEBOUNCE_MS = 100;

/**
 * Wiki-link autocomplete dropdown. Spec 2026-05-12 §3.9.
 *
 * Renders an ARIA listbox of ``.md`` notes in the active vault, filtered
 * by the current query (debounced 100 ms). Owned by the editor host so
 * keyboard events flow through the textarea — the host calls
 * ``handleKeyDown(event)`` to forward ArrowDown / ArrowUp / Enter / Esc.
 *
 * Exposed via an imperative handle pattern (the host attaches a ref to
 * a ``WikiLinkAutocompleteHandle``) so the editor doesn't need to
 * juggle two sources of truth for "which option is highlighted right
 * now".
 */
export interface WikiLinkAutocompleteHandle {
  handleKeyDown: (e: KeyboardEvent | React.KeyboardEvent) => boolean;
}

export const WikiLinkAutocomplete = function WikiLinkAutocomplete({
  drive,
  vaultId,
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

  // The backend /search endpoint requires vault_id >= 1. When the host
  // mounts the autocomplete without a valid vault id (e.g. the inline
  // file-detail editor doesn't know the active vault), discover the
  // active one ourselves via /vaults and reuse it for subsequent
  // fetches.
  const [effectiveVaultId, setEffectiveVaultId] = useState<number>(
    vaultId > 0 ? vaultId : 0,
  );
  useEffect(() => {
    if (vaultId > 0) {
      setEffectiveVaultId(vaultId);
      return;
    }
    let cancelled = false;
    listVaults(drive)
      .then((res) => {
        if (cancelled) return;
        const fallback =
          res.active_vault_id ?? res.vaults[0]?.id ?? 0;
        setEffectiveVaultId(fallback);
      })
      .catch(() => {
        if (!cancelled) setEffectiveVaultId(0);
      });
    return () => {
      cancelled = true;
    };
  }, [drive, vaultId]);

  // Debounce searchVault calls so a burst of keystrokes doesn't fan
  // out to the network. The very first fetch (empty query, popup just
  // opened) runs synchronously so the listbox is populated by the
  // time the host's ``waitFor("wiki-link-autocomplete")`` resolves.
  const firstFetchRef = useRef(true);
  useEffect(() => {
    if (effectiveVaultId < 1) {
      // No vault yet — keep the listbox empty rather than hitting the
      // endpoint with vault_id=0 (which rejects with 422).
      return;
    }
    if (query.length === 0) {
      // The /search endpoint requires q.min_length=1; firing with an
      // empty query (the moment ``[[`` is typed before any chars) would
      // 422 on every keystroke. Keep the popup open showing the empty
      // state so the user knows to start typing.
      setHits([]);
      setHighlight(0);
      return;
    }
    let cancelled = false;
    function run() {
      searchVault(drive, effectiveVaultId, query)
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
  }, [drive, effectiveVaultId, query]);

  // Expose keyboard handling to the host.
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

  // After mount, measure the popup and flip above the caret when there
  // isn't enough room below. Recomputed whenever the anchor moves or
  // the result list changes (which alters the popup's height).
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Dismiss on pointer activity outside the popup. Critical on mobile,
  // where ``Esc`` isn't available — without this the user has no way
  // to close the popup other than typing ``]`` or a newline. We listen
  // in the capture phase so the close fires before any inner handler
  // (the option's ``onMouseDown`` calls ``preventDefault`` and runs
  // ``onSelect`` regardless, so it's safe to also see the event here).
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
                  // Stop the textarea from losing focus before our
                  // click handler fires.
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

  // When the popup is caret-anchored we must escape ancestor
  // ``transform`` / ``contain`` / ``overflow`` rules — when the editor
  // is inline-mounted inside FileDetailContent, sibling sections
  // (e.g. "Generate detailed summary") otherwise cover the popup. The
  // legacy in-flow path keeps the existing positioning so callers that
  // rely on the relative parent don't regress.
  if (anchor && typeof document !== "undefined") {
    return createPortal(popup, document.body);
  }
  return popup;
};
