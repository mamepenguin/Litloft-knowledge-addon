"use client";

import {
  Bold,
  BookmarkPlus,
  Code,
  History,
  Heading1,
  Heading2,
  Heading3,
  Link,
  Link2,
  List,
} from "lucide-react";
import { useTranslations } from "next-intl";

export type EditorAction =
  | { kind: "prefix"; text: string }
  | { kind: "wrap"; before: string; after: string }
  | { kind: "link" }
  | { kind: "codeblock" };

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

  const btnClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div
      role="toolbar"
      aria-label={t("label")}
      className="flex flex-wrap items-center gap-0.5 border-b border-bg-border bg-bg-card px-3 py-1.5"
    >
      <button
        type="button"
        className={btnClass}
        aria-label={t("h1")}
        title={t("h1")}
        onClick={() => onAction({ kind: "prefix", text: "# " })}
        disabled={disabled}
      >
        <Heading1 size={15} />
      </button>
      <button
        type="button"
        className={btnClass}
        aria-label={t("h2")}
        title={t("h2")}
        onClick={() => onAction({ kind: "prefix", text: "## " })}
        disabled={disabled}
      >
        <Heading2 size={15} />
      </button>
      <button
        type="button"
        className={btnClass}
        aria-label={t("h3")}
        title={t("h3")}
        onClick={() => onAction({ kind: "prefix", text: "### " })}
        disabled={disabled}
      >
        <Heading3 size={15} />
      </button>
      <span className="mx-1.5 h-4 w-px bg-bg-border" />
      <button
        type="button"
        className={btnClass}
        aria-label={t("bold")}
        title={t("bold")}
        onClick={() => onAction({ kind: "wrap", before: "**", after: "**" })}
        disabled={disabled}
      >
        <Bold size={15} />
      </button>
      <button
        type="button"
        className={btnClass}
        aria-label={t("list")}
        title={t("list")}
        onClick={() => onAction({ kind: "prefix", text: "- " })}
        disabled={disabled}
      >
        <List size={15} />
      </button>
      <button
        type="button"
        className={btnClass}
        aria-label={t("link")}
        title={t("link")}
        onClick={() => onAction({ kind: "link" })}
        disabled={disabled}
      >
        <Link size={15} />
      </button>
      <button
        type="button"
        className={btnClass}
        aria-label={t("code")}
        title={t("code")}
        onClick={() => onAction({ kind: "codeblock" })}
        disabled={disabled}
      >
        <Code size={15} />
      </button>
      {onFileLinkRequest && (
        <>
          <span className="mx-1.5 h-4 w-px bg-bg-border" />
          <button
            type="button"
            className={btnClass}
            aria-label={t("fileLink")}
            title={t("fileLink")}
            onClick={onFileLinkRequest}
            disabled={disabled}
          >
            <Link2 size={15} />
          </button>
        </>
      )}
      <span className="mx-1.5 h-4 w-px bg-bg-border" />
      <button
        type="button"
        className={`${btnClass} w-auto gap-1.5 px-2`}
        aria-label={t("keepVersion")}
        title={t("keepVersion")}
        onClick={onKeepVersion}
        disabled={disabled}
      >
        <BookmarkPlus size={15} />
        <span className="hidden text-xs font-medium sm:inline">
          {t("keepVersion")}
        </span>
      </button>
      {/* Beside "keep this version": where a version is made is where
          someone looks for the ones already made. The panel itself stays
          at the foot of the note, so this reveals it rather than
          replacing it. */}
      {onOpenVersionHistory && (
        <button
          type="button"
          // 32px, like the nine buttons beside it. The 44px coarse-pointer
          // floor is real and this row misses it, but it misses it for every
          // button: at `gap-0.5` there is 2px between items, so a 44px target
          // on one of them either widens the row — which the same rule
          // forbids, and this row already wraps at 375px without this button
          // — or overlaps its neighbour and steals the tap. The rule's own
          // remedy is to carry fewer controls here, which is a change to the
          // whole toolbar and belongs with the mobile work.
          className={btnClass}
          aria-label={t("versionHistory")}
          title={t("versionHistory")}
          onClick={onOpenVersionHistory}
          disabled={disabled}
        >
          <History size={15} />
        </button>
      )}
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
