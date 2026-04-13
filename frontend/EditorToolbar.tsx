"use client";

import { Bold, Code, Heading1, Heading2, Heading3, Link, List } from "lucide-react";
import { useTranslations } from "next-intl";

export type EditorAction =
  | { kind: "prefix"; text: string }
  | { kind: "wrap"; before: string; after: string }
  | { kind: "link" }
  | { kind: "codeblock" };

interface Props {
  onAction: (action: EditorAction) => void;
}

export default function EditorToolbar({ onAction }: Props) {
  const t = useTranslations("knowledge.editor.toolbar");

  const btnClass =
    "inline-flex items-center justify-center rounded p-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary";

  return (
    <div
      role="toolbar"
      aria-label={t("label")}
      className="flex flex-wrap items-center gap-1 border-b border-border-default bg-surface-elevated p-1"
    >
      <button
        type="button"
        className={btnClass}
        aria-label={t("h1")}
        onClick={() => onAction({ kind: "prefix", text: "# " })}
      >
        <Heading1 size={16} />
      </button>
      <button
        type="button"
        className={btnClass}
        aria-label={t("h2")}
        onClick={() => onAction({ kind: "prefix", text: "## " })}
      >
        <Heading2 size={16} />
      </button>
      <button
        type="button"
        className={btnClass}
        aria-label={t("h3")}
        onClick={() => onAction({ kind: "prefix", text: "### " })}
      >
        <Heading3 size={16} />
      </button>
      <span className="mx-1 h-4 w-px bg-border-default" />
      <button
        type="button"
        className={btnClass}
        aria-label={t("bold")}
        onClick={() => onAction({ kind: "wrap", before: "**", after: "**" })}
      >
        <Bold size={16} />
      </button>
      <button
        type="button"
        className={btnClass}
        aria-label={t("list")}
        onClick={() => onAction({ kind: "prefix", text: "- " })}
      >
        <List size={16} />
      </button>
      <button
        type="button"
        className={btnClass}
        aria-label={t("link")}
        onClick={() => onAction({ kind: "link" })}
      >
        <Link size={16} />
      </button>
      <button
        type="button"
        className={btnClass}
        aria-label={t("code")}
        onClick={() => onAction({ kind: "codeblock" })}
      >
        <Code size={16} />
      </button>
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
  // codeblock
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
