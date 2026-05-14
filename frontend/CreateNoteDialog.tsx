"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { FileSaveDialog } from "@/components/FileSaveDialog";
import { createNoteFromFile } from "./api";

interface Props {
  drive: string;
  sourceFileId: string;
  /** Stem of the source file (without extension). Used as the default note filename. */
  defaultStem: string;
  open: boolean;
  onClose: () => void;
}

export default function CreateNoteDialog({
  drive,
  sourceFileId,
  defaultStem,
  open,
  onClose,
}: Props) {
  const t = useTranslations("knowledge.createNoteDialog");
  const router = useRouter();

  async function handleConfirm({
    folder,
    filename,
  }: {
    folder: string;
    filename: string;
  }) {
    const result = await createNoteFromFile(drive, sourceFileId, {
      filename,
      folder,
    });
    onClose();
    router.push(
      `/drive/${encodeURIComponent(drive)}/addons/knowledge?edit=${encodeURIComponent(result.note_file_id)}`,
    );
  }

  return (
    <FileSaveDialog
      open={open}
      title={t("title")}
      drive={drive}
      defaultFolder=""
      defaultFilename={`${defaultStem}.md`}
      onConfirm={handleConfirm}
      onCancel={onClose}
    />
  );
}
