"use client";

import type { ComponentType } from "react";
import {
  Bold,
  BookmarkPlus,
  Code,
  FileSymlink,
  Heading1,
  Heading2,
  Heading3,
  History,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { ActionMenuItem } from "@/components/ActionMenuItem";
import { Button } from "@/components/Button";
import { OverflowMenu } from "@/components/OverflowMenu";

export type EditorAction =
  | { kind: "prefix"; text: string }
  | { kind: "wrap"; before: string; after: string }
  | { kind: "link" }
  | { kind: "codeblock" };

/**
 * Every formatting control this toolbar offers, in the order it is drawn.
 *
 * The array is the source and the record below is keyed by it, so a control
 * cannot exist in one and not the other, and a test that walks this array
 * walks the whole set rather than the subset someone remembered to list
 * (the same reason `EmptyState.EMPTY_VARIANTS` is an array).
 */
export const FORMAT_ACTIONS = [
  "h1",
  "h2",
  "h3",
  "bold",
  "italic",
  "strike",
  "list",
  "orderedList",
  "taskList",
  "link",
  "code",
  "quote",
] as const;

export type FormatActionId = (typeof FORMAT_ACTIONS)[number];

type FormatGroup = "heading" | "emphasis" | "block" | "insert";

type FormatTier = "narrow" | "mid" | "full";

interface FormatSpec {
  icon: ComponentType<{ size?: number }>;
  group: FormatGroup;
  action: EditorAction;
  /**
   * The narrowest bar this control stays on.
   *
   * A row of controls does not wrap: what will not fit drops into the `…`,
   * and it is the *number* of controls that gives, not their size
   * (`00-basis.md`). Six of the twelve stay at every width; the rest come
   * back in two steps as the bar grows — see `MID_FLOOR` / `FULL_FLOOR`.
   */
  tier: FormatTier;
}

export const FORMAT_SPECS: Record<FormatActionId, FormatSpec> = {
  h1: {
    icon: Heading1,
    group: "heading",
    action: { kind: "prefix", text: "# " },
    tier: "narrow",
  },
  h2: {
    icon: Heading2,
    group: "heading",
    action: { kind: "prefix", text: "## " },
    tier: "narrow",
  },
  h3: {
    icon: Heading3,
    group: "heading",
    action: { kind: "prefix", text: "### " },
    tier: "mid",
  },
  bold: {
    icon: Bold,
    group: "emphasis",
    action: { kind: "wrap", before: "**", after: "**" },
    tier: "narrow",
  },
  italic: {
    icon: Italic,
    group: "emphasis",
    action: { kind: "wrap", before: "*", after: "*" },
    tier: "mid",
  },
  strike: {
    icon: Strikethrough,
    group: "emphasis",
    action: { kind: "wrap", before: "~~", after: "~~" },
    tier: "mid",
  },
  list: {
    icon: List,
    group: "block",
    action: { kind: "prefix", text: "- " },
    tier: "narrow",
  },
  orderedList: {
    icon: ListOrdered,
    group: "block",
    action: { kind: "prefix", text: "1. " },
    tier: "full",
  },
  taskList: {
    icon: ListChecks,
    group: "block",
    action: { kind: "prefix", text: "- [ ] " },
    tier: "full",
  },
  link: {
    icon: Link,
    group: "insert",
    action: { kind: "link" },
    tier: "narrow",
  },
  code: {
    icon: Code,
    group: "insert",
    action: { kind: "codeblock" },
    tier: "narrow",
  },
  quote: {
    icon: Quote,
    group: "insert",
    action: { kind: "prefix", text: "> " },
    tier: "full",
  },
};

const GROUP_ORDER: FormatGroup[] = ["heading", "emphasis", "block", "insert"];

/**
 * What fits is a question about the bar, not about the window.
 *
 * A viewport breakpoint is wrong here, and measurably so: the editor column
 * is the viewport below 1120, but at 768 the folder tree opens beside it and
 * the bar *narrows* — 625px of bar at a 640px viewport, 473px at 768. A
 * `sm:` rule would put more controls on a shorter bar. So the bar is its own
 * container and the thresholds are container widths.
 *
 * Measured widths, all border-box bar widths:
 *
 * - narrow — six formats, the file-link button and the `…`, no separators: 294px
 * - mid    — plus h3, italic, strikethrough, with separators: 456px
 * - full   — all twelve: 558px
 *
 * The thresholds below are those minus the bar's own `px-3` (24px), because
 * a container query measures the content box.
 *
 * Written as literals. Assembling them (`` `@min-[${N}px]:contents` ``) puts
 * the class name beyond Tailwind's scanner, which emits nothing and leaves
 * every tier permanently hidden — measured, and the reason this comment
 * exists.
 */
const MID_ONLY = "hidden @min-[432px]:contents";
const FULL_ONLY = "hidden @min-[534px]:contents";
const MID_ONLY_IN_MENU = "@min-[432px]:hidden";
const FULL_ONLY_IN_MENU = "@min-[534px]:hidden";

/** Groups only read as groups once the mid tier is out. */
const SEPARATOR =
  "mx-1.5 hidden h-4 w-px shrink-0 bg-bg-border @min-[432px]:block";

interface Props {
  onAction: (action: EditorAction) => void;
  /** Called when the user clicks the "insert file link" button. */
  onFileLinkRequest?: () => void;
  /** Records the current body as an explicit, non-collapsible version. */
  onKeepVersion: () => void;
  /** Reveals the version history, which sits at the foot of the note. */
  onOpenVersionHistory?: () => void;
  disabled?: boolean;
}

export default function EditorToolbar({
  onAction,
  onFileLinkRequest,
  onKeepVersion,
  onOpenVersionHistory,
  disabled = false,
}: Props) {
  const t = useTranslations("knowledge.editor.toolbar");

  const formatButton = (id: FormatActionId) => {
    const spec = FORMAT_SPECS[id];
    const Icon = spec.icon;
    const button = (
      <Button
        key={id}
        variant="ghost"
        iconOnly
        // `Button` grows an icon-only control's hit area by 6px a side on a
        // coarse pointer. That is half of the DESIGN.md §Row Actions recipe
        // and, as `Button.tsx` says, the caller owns the other half: the row
        // must carry a pitch the overhang fits in. This row does not — the
        // controls sit 34px apart, so the 44px targets would overlap by 10px
        // and the later button would take the tap.
        //
        // Before this bar was rebuilt it used a local class with no coarse
        // rule at all, so every target was an honest 32px. Suppressing the
        // overhang keeps that, rather than shipping targets that quietly
        // steal from each other. Giving the row a real 44px pitch means
        // showing fewer controls on touch, which is its own change.
        className="shrink-0 pointer-coarse:before:hidden"
        aria-label={t(id)}
        title={t(id)}
        onClick={() => onAction(spec.action)}
        disabled={disabled}
      >
        <Icon size={15} />
      </Button>
    );
    if (spec.tier === "narrow") return button;
    return (
      <span key={id} className={spec.tier === "mid" ? MID_ONLY : FULL_ONLY}>
        {button}
      </span>
    );
  };

  return (
    <div className="@container flex items-center gap-0.5 border-b border-bg-border bg-bg-card px-3 py-1.5">
      {/* The formatting controls, and only those. The `…` beside them holds
          what the document as a whole does — keeping a version, opening the
          history — which is not formatting and does not belong in a group
          named for it. */}
      <div
        role="toolbar"
        aria-label={t("label")}
        className="flex items-center gap-0.5"
      >
        {GROUP_ORDER.map((group, i) => (
          <span key={group} className="contents">
            {i > 0 && <span className={SEPARATOR} />}
            {FORMAT_ACTIONS.filter((id) => FORMAT_SPECS[id].group === group).map(
              formatButton,
            )}
          </span>
        ))}
        {onFileLinkRequest && (
          <>
            <span className={SEPARATOR} />
            {/* `FileSymlink`, not a second chain link: this inserts a
                `loft://` reference to a file in the library, and beside the
                Markdown-link button the two chain glyphs were the same
                picture with two names only a screen reader heard. */}
            <Button
              variant="ghost"
              iconOnly
              className="shrink-0 pointer-coarse:before:hidden"
              aria-label={t("fileLink")}
              title={t("fileLink")}
              onClick={onFileLinkRequest}
              disabled={disabled}
            >
              <FileSymlink size={15} />
            </Button>
          </>
        )}
      </div>

      <div className="ml-auto shrink-0">
        <OverflowMenu label={t("more")}>
          {(close) => (
            <>
              {/* Below `sm` these six are not on the bar, so this is where
                  they are. Above it they are on the bar and this block is
                  `display:none` — one control, one place, at any one width. */}
              {(["mid", "full"] as const).map((tier) => (
                <div
                  key={tier}
                  className={tier === "mid" ? MID_ONLY_IN_MENU : FULL_ONLY_IN_MENU}
                >
                  {FORMAT_ACTIONS.filter((id) => FORMAT_SPECS[id].tier === tier).map(
                    (id) => (
                      <ActionMenuItem
                        key={id}
                        icon={FORMAT_SPECS[id].icon}
                        label={t(id)}
                        disabled={disabled}
                        onClick={() => {
                          close();
                          onAction(FORMAT_SPECS[id].action);
                        }}
                      />
                    ),
                  )}
                </div>
              ))}
              <ActionMenuItem
                icon={BookmarkPlus}
                label={t("keepVersion")}
                disabled={disabled}
                onClick={() => {
                  close();
                  onKeepVersion();
                }}
              />
              {/* Beside "keep this version": where a version is made is where
                  someone looks for the ones already made. The panel itself
                  stays at the foot of the note, so this reveals it rather
                  than replacing it. */}
              {onOpenVersionHistory && (
                <ActionMenuItem
                  icon={History}
                  label={t("versionHistory")}
                  disabled={disabled}
                  onClick={() => {
                    close();
                    onOpenVersionHistory();
                  }}
                />
              )}
            </>
          )}
        </OverflowMenu>
      </div>
    </div>
  );
}

export function applyEditorAction(
  text: string,
  selStart: number,
  selEnd: number,
  action: EditorAction,
): { text: string; selStart: number; selEnd: number } {
  if (action.kind === "prefix") {
    const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
    const newText =
      text.slice(0, lineStart) + action.text + text.slice(lineStart);
    return {
      text: newText,
      selStart: selStart + action.text.length,
      selEnd: selEnd + action.text.length,
    };
  }
  if (action.kind === "wrap") {
    const selected = text.slice(selStart, selEnd);
    const inserted = action.before + selected + action.after;
    const newText = text.slice(0, selStart) + inserted + text.slice(selEnd);
    return {
      text: newText,
      selStart: selStart + action.before.length,
      selEnd: selEnd + action.before.length,
    };
  }
  if (action.kind === "link") {
    const selected = text.slice(selStart, selEnd) || "text";
    const inserted = `[${selected}](url)`;
    const newText = text.slice(0, selStart) + inserted + text.slice(selEnd);
    const urlStart = selStart + selected.length + 3;
    return {
      text: newText,
      selStart: urlStart,
      selEnd: urlStart + 3,
    };
  }
  const selected = text.slice(selStart, selEnd);
  const inserted = `\n\`\`\`\n${selected}\n\`\`\`\n`;
  const newText = text.slice(0, selStart) + inserted + text.slice(selEnd);
  const contentStart = selStart + 5;
  return {
    text: newText,
    selStart: contentStart,
    selEnd: contentStart + selected.length,
  };
}
