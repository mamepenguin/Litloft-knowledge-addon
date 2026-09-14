"use client";

import { useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useDialogPortalTarget } from "@/components/DialogPortal";
import { FileSaveDialog } from "@/components/FileSaveDialog";
import { usePolicy } from "@/hooks/usePolicy";

import { createTextFile } from "./api";

function timestampedName(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `untitled-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}.md`;
}

interface Options {
  drive: string;
  path?: string;
  onDialogOpenChange?: (open: boolean) => void;
  onCreated?: () => void;
}

interface NewNote {
  /** False once the editor policy has answered "off". */
  available: boolean;
  open: () => void;
  dialog: ReactNode;
}

/**
 * New note: confirm a folder and name, create the file, open it in the
 * editor. The availability gate is for the entry point only; a dialog opened
 * while the policy was still loading stays until the user leaves it.
 */
export function useNewNote({ drive, path = "", onDialogOpenChange, onCreated }: Options): NewNote {
  const t = useTranslations("knowledge.newNote");
  const router = useRouter();
  const host = useDialogPortalTarget();
  const policy = usePolicy(drive, "knowledge", "editor");
  const [defaultFilename, setDefaultFilename] = useState<string | null>(null);

  const open = useCallback(() => {
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
      onCreated?.();
      router.push(`/files/${file.id}?edit=1`);
    },
    [drive, onDialogOpenChange, onCreated, router],
  );

  const dialog =
    defaultFilename !== null && host
      ? createPortal(
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
        )
      : null;

  return {
    available: Boolean(drive) && (policy.isLoading || policy.enabled),
    open,
    dialog,
  };
}
