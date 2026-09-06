"use client";

/**
 * `file-actions-menu` entry that reveals the note's version history.
 *
 * The history is drawn at the foot of the editor, and on a note of any
 * length that is a screenful of body away from anything the reader is
 * looking at. This is the second way in — the editor toolbar, beside
 * "keep this version", is the other — and neither replaces the panel's
 * own heading, so a reader who already knows where it is keeps that path.
 *
 * Opening a modal instead was considered and dropped: the file detail
 * page asserts, in `escape-listeners.test.ts`, that nothing there speaks
 * Escape, and a modal would have to.
 */

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { History } from "lucide-react";

import { ActionMenuItem } from "@/components/ActionMenuItem";
import {
  hasVersionHistory,
  requestVersionHistory,
  subscribeVersionHistory,
} from "./versionHistoryChannel";

interface VersionHistoryMenuItemProps {
  fileId: string;
  onRequestClose?: () => void;
}

export default function VersionHistoryMenuItem({
  fileId,
  onRequestClose,
}: VersionHistoryMenuItemProps) {
  const t = useTranslations("knowledge.editor.versions");

  // Present only while a panel is mounted for this file. The entry is
  // drawn on every file detail page, but the panel comes with the
  // editor, which is Markdown-only and switched off on drives where the
  // policy says so — asking those questions again here would be a second
  // copy of the answer, and a wrong press if the two ever disagreed.
  const available = useSyncExternalStore(
    subscribeVersionHistory,
    () => hasVersionHistory(fileId),
    () => false,
  );

  if (!available) return null;

  return (
    <ActionMenuItem
      icon={History}
      label={t("heading")}
      onClick={() => {
        requestVersionHistory(fileId);
        onRequestClose?.();
      }}
    />
  );
}
