"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Waypoints } from "lucide-react";

import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { PageHeader } from "@/components/PageHeader";

import ConnectionsGraph from "../ConnectionsGraph";

export default function ConnectionsPage() {
  const drive = useCurrentDrive() ?? "";
  const focusId = useSearchParams()?.get("focus") || null;
  const t = useTranslations("knowledge.notes");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-10">
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
      <div className="px-4">
        <ConnectionsGraph drive={drive} initialFocusId={focusId} />
      </div>
    </div>
  );
}
