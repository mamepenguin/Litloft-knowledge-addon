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

interface FormatSpec {
  icon: ComponentType<{ size?: number }>;
  group: FormatGroup;
  action: EditorAction;
  /**
   * Whether it keeps its place on the bar at every width.
   *
   * A row of controls does not wrap: what will not fit drops into the `…`,
   * and it is the *number* of controls that gives, not their size
   * (`00-basis.md`). Six of the twelve stay, which is what fits beside the
   * file-link button and the `…` at 320px — measured, see `NARROW_FLOOR`.
   */
  always: boolean;
}

export const FORMAT_SPECS: Record<FormatActionId, FormatSpec> = {
  h1: {
    icon: Heading1,
    group: "heading",
    action: { kind: "prefix", text: "# " },
    always: true,
  },
  h2: {
    icon: Heading2,
    group: "heading",
    action: { kind: "prefix", text: "## " },
    always: true,
  },
  h3: {
    icon: Heading3,
    group: "heading",
    action: { kind: "prefix", text: "### " },
    always: false,
  },
  bold: {
    icon: Bold,
    group: "emphasis",
    action: { kind: "wrap", before: "**", after: "**" },
    always: true,
  },
  italic: {
    icon: Italic,
    group: "emphasis",
    action: { kind: "wrap", before: "*", after: "*" },
    always: false,
  },
  strike: {
    icon: Strikethrough,
    group: "emphasis",
    action: { kind: "wrap", before: "~~", after: "~~" },
    always: false,
  },
  list: {
    icon: List,
    group: "block",
    action: { kind: "prefix", text: "- " },
    always: true,
  },
  orderedList: {
    icon: ListOrdered,
    group: "block",
    action: { kind: "prefix", text: "1. " },
    always: false,
  },
  taskList: {
    icon: ListChecks,
    group: "block",
    action: { kind: "prefix", text: "- [ ] " },
    always: false,
  },
  link: {
    icon: Link,
    group: "insert",
    action: { kind: "link" },
    always: true,
  },
  code: {
    icon: Code,
    group: "insert",
    action: { kind: "codeblock" },
    always: true,
  },
  quote: {
    icon: Quote,
    group: "insert",
    action: { kind: "prefix", text: "> " },
    always: false,
  },
};

const GROUP_ORDER: FormatGroup[] = ["heading", "emphasis", "block", "insert"];

/**
 * The width at which the other six formatting controls come back out of the
 * `…`, written here rather than left implicit in a `sm:` scattered through
 * the markup.
 *
 * It is Tailwind's `sm` (640px) because that is the widest breakpoint the
 * full bar still clears: twelve formatting buttons, the file-link button and
 * the `…` are 14 × 32px, with four 13px separators, thirteen 2px gaps and
 * 24px of horizontal padding — 558px. The narrow set is eight buttons and no
 * separators, 294px, which clears 320px. Between those two counts there is no
 * arrangement that fits 320 and shows more, so there is one threshold and not
 * a scale of them. Measured in Chromium at 320/375/400/430/639/640/768/1512;
 * the editor column is the viewport width below 1120, so a viewport query and
 * a container query answer the same question here.
 */
const NARROW_FLOOR = "sm";

/** Wide-only: `display:contents` keeps the button a direct flex child. */
const WIDE_ONLY = `hidden ${NARROW_FLOOR}:contents`;
const SEPARATOR = `mx-1.5 hidden h-4 w-px bg-bg-border ${NARROW_FLOOR}:block`;

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
        aria-label={t(id)}
        title={t(id)}
        onClick={() => onAction(spec.action)}
        disabled={disabled}
      >
        <Icon size={15} />
      </Button>
    );
    return spec.always ? (
      button
    ) : (
      <span key={id} className={WIDE_ONLY}>
        {button}
      </span>
    );
  };

  return (
    <div className="flex items-center gap-0.5 border-b border-bg-border bg-bg-card px-3 py-1.5">
      {/* The formatting controls, and only those. The `…` beside them holds
          what the document as a whole does — keeping a version, opening the
          history — which is not formatting and does not belong in a group
          named for it. */}
      <div
        role="toolbar"
        aria-label={t("label")}
        className="flex min-w-0 items-center gap-0.5"
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

      <div className="ml-auto">
        <OverflowMenu label={t("more")}>
          {(close) => (
            <>
              {/* Below `sm` these six are not on the bar, so this is where
                  they are. Above it they are on the bar and this block is
                  `display:none` — one control, one place, at any one width. */}
              <div className={`${NARROW_FLOOR}:hidden`}>
                {FORMAT_ACTIONS.filter((id) => !FORMAT_SPECS[id].always).map(
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
