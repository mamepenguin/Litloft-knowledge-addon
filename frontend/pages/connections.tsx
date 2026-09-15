"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Waypoints } from "lucide-react";

import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { PageFrame } from "@/components/PageFrame";
import { PageHeader } from "@/components/PageHeader";

import ConnectionsGraph from "../ConnectionsGraph";

export default function ConnectionsPage() {
  const drive = useCurrentDrive() ?? "";
  const focusId = useSearchParams()?.get("focus") || null;
  const t = useTranslations("knowledge.notes");

  return (
    <PageFrame
      width="wide"
      header={
      <PageHeader
        titleIcon={Waypoints}
        title={t("connections")}
        scope={
          <Link
            href={`/drive/${encodeURIComponent(drive)}/addons/knowledge`}
            className="hover:text-text-primary"
          >
            {t("back")}
          </Link>
        }
      />
      }
    >
      <div className="px-4 pb-10 pt-4">
        <ConnectionsGraph drive={drive} initialFocusId={focusId} />
      </div>
    </PageFrame>
  );
}
