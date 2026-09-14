"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Globe } from "lucide-react";

import { ActionMenuItem } from "@/components/ActionMenuItem";

import ClipWebPageDialog from "./ClipWebPageDialog";

interface Props {
  drive: string;
  path?: string;
  onRequestClose?: () => void;
  onDialogOpenChange?: (open: boolean) => void;
}

/**
 * No `usePolicy` gate: knowledge has no clipping feature key, so the
 * drive catalogue (`index`) is the only switch, and the host already omits
 * the slot when it is off.
 */
export default function ClipWebPageMenuItem({
  drive,
  path = "",
  onRequestClose,
  onDialogOpenChange,
}: Props) {
  const t = useTranslations("knowledge.clipWebPage");
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    setOpen(true);
    onDialogOpenChange?.(true);
  }, [onDialogOpenChange]);

  const handleCancel = useCallback(() => {
    setOpen(false);
    onDialogOpenChange?.(false);
  }, [onDialogOpenChange]);

  const handleDone = useCallback(() => {
    setOpen(false);
    onDialogOpenChange?.(false);
    onRequestClose?.();
  }, [onDialogOpenChange, onRequestClose]);

  return (
    <>
      {drive && <ActionMenuItem icon={Globe} label={t("menuItem")} onClick={handleOpen} />}
      {open && (
        <ClipWebPageDialog
          drive={drive}
          path={path}
          onCancel={handleCancel}
          onDone={handleDone}
        />
      )}
    </>
  );
}
