"use client";

/**
 * `file-actions-menu` entry that opens `CreateNoteDialog`.
 *
 * It was a card with a heading and a sentence of explanation, drawn on
 * every file detail page whether or not anyone was going to make a note
 * — 130px of a 190-page comic's page spent saying that a feature
 * exists. Making a note from a file is an occasional, deliberate act,
 * which is what the `[...]` menu is for.
 *
 * The host does not close its menu for us: doing so would unmount this
 * component and take the dialog with it. The dialog is reported through
 * `onDialogOpenChange` and the close is asked for only once it is
 * dismissed — the same shape the intelligence addon's index-details
 * entry uses.
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { FilePlus } from "lucide-react";

import { ActionMenuItem } from "@/components/ActionMenuItem";
import { usePolicy } from "@/hooks/usePolicy";
import CreateNoteDialog from "./CreateNoteDialog";

interface CreateNoteMenuItemProps {
  fileId: string;
  drive: string;
  filename?: string;
  onRequestClose?: () => void;
  onDialogOpenChange?: (open: boolean) => void;
}

export default function CreateNoteMenuItem({
  fileId,
  drive,
  filename,
  onRequestClose,
  onDialogOpenChange,
}: CreateNoteMenuItemProps) {
  const t = useTranslations("knowledge.createNote");
  const policy = usePolicy(drive, "knowledge", "editor");
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    setOpen(true);
    onDialogOpenChange?.(true);
  }, [onDialogOpenChange]);

  const handleClose = useCallback(() => {
    setOpen(false);
    onDialogOpenChange?.(false);
    onRequestClose?.();
  }, [onDialogOpenChange, onRequestClose]);

  // `usePolicy` is fail-open, so this is present while the answer is
  // still loading and goes only if the drive has the editor switched
  // off — the same reading the section this replaces used.
  if (!policy.isLoading && !policy.enabled) return null;

  // The stem, not the whole name: the note is a `.md` beside a file that
  // may be an `.mkv`, and offering "holiday.mkv.md" as the default name
  // is offering a mistake.
  const stem = (filename ?? fileId).replace(/\.[^./\\]+$/, "");

  return (
    <>
      <ActionMenuItem icon={FilePlus} label={t("button")} onClick={handleOpen} />
      <CreateNoteDialog
        drive={drive}
        sourceFileId={fileId}
        defaultStem={stem}
        open={open}
        onClose={handleClose}
      />
    </>
  );
}
