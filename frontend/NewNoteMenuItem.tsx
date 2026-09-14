"use client";

import { useTranslations } from "next-intl";
import { FilePlus } from "lucide-react";

import { ActionMenuItem } from "@/components/ActionMenuItem";

import { useNewNote } from "./useNewNote";

interface Props {
  drive: string;
  path?: string;
  onRequestClose?: () => void;
  onDialogOpenChange?: (open: boolean) => void;
}

/**
 * `folder-actions-menu` entry: a note in the folder the Add menu was opened
 * from. The file-scoped "Create note" in `file-actions-menu` answers a
 * different question and is a separate component.
 *
 * The dialog lives inside the host's menu, so the menu is asked to close
 * only after the note exists; cancelling returns to it.
 */
export default function NewNoteMenuItem({
  drive,
  path = "",
  onRequestClose,
  onDialogOpenChange,
}: Props) {
  const t = useTranslations("knowledge.newNote");
  const newNote = useNewNote({
    drive,
    path,
    onDialogOpenChange,
    onCreated: onRequestClose,
  });

  return (
    <>
      {newNote.available && (
        <ActionMenuItem icon={FilePlus} label={t("menuItem")} onClick={newNote.open} />
      )}
      {newNote.dialog}
    </>
  );
}
