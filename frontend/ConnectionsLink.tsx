"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Waypoints } from "lucide-react";

import { isTextKind } from "@/lib/textKind";

interface Props {
  drive: string;
  fileId: string;
  filename: string;
  mimeType?: string | null;
}

export default function ConnectionsLink({ drive, fileId, filename, mimeType }: Props) {
  const t = useTranslations("knowledge.related");
  if (!isTextKind(mimeType, filename)) return null;

  return (
    <Link
      href={`/drive/${encodeURIComponent(drive)}/addons/knowledge/connections?focus=${encodeURIComponent(fileId)}`}
      className="flex items-center gap-2 text-[13px] text-text-muted transition-colors hover:text-text-primary"
    >
      <Waypoints size={14} aria-hidden="true" />
      {t("seeConnections")}
    </Link>
  );
}
