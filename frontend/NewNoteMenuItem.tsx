"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FilePlus } from "lucide-react";

import { ActionMenuItem } from "@/components/ActionMenuItem";
import { useDialogPortalTarget } from "@/components/DialogPortal";
import { FileSaveDialog } from "@/components/FileSaveDialog";
import { usePolicy } from "@/hooks/usePolicy";

import { createTextFile } from "./api";

interface Props {
  drive: string;
  path?: string;
  onRequestClose?: () => void;
  onDialogOpenChange?: (open: boolean) => void;
}

function timestampedName(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `untitled-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}.md`;
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
  const router = useRouter();
  const host = useDialogPortalTarget();
  const policy = usePolicy(drive, "knowledge", "editor");
  const [defaultFilename, setDefaultFilename] = useState<string | null>(null);

  const handleOpen = useCallback(() => {
    setDefaultFilename(timestampedName(new Date()));
    onDialogOpenChange?.(true);
  }, [onDialogOpenChange]);

  const handleCancel = useCallback(() => {
    setDefaultFilename(null);
    onDialogOpenChange?.(false);
  }, [onDialogOpenChange]);

  const handleConfirm = useCallback(
    async ({ folder, filename }: { folder: string; filename: string }) => {
      const file = await createTextFile(drive, {
        path: folder ? `${folder}/${filename}` : filename,
      });
      setDefaultFilename(null);
      onDialogOpenChange?.(false);
      onRequestClose?.();
      router.push(`/files/${file.id}?edit=1`);
    },
    [drive, onDialogOpenChange, onRequestClose, router],
  );

  // The gate hides the row only. A dialog opened while the policy was
  // still loading stays until the user leaves it.
  const rowHidden = !drive || (!policy.isLoading && !policy.enabled);

  return (
    <>
      {!rowHidden && (
        <ActionMenuItem icon={FilePlus} label={t("menuItem")} onClick={handleOpen} />
      )}
      {defaultFilename !== null &&
        host &&
        createPortal(
          <FileSaveDialog
            open
            title={t("dialogTitle")}
            drive={drive}
            defaultFolder={path}
            defaultFilename={defaultFilename}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />,
          host,
        )}
    </>
  );
}
