"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { listVaults, type Vault } from "./api";

/**
 * Sidebar-sections slot: shows the currently-active Vault label for
 * the drive the user is viewing. Drive-scoped — when there is no
 * ``currentDrive`` (e.g. on the global dashboard) we render nothing,
 * matching the scope=drive policy in ``manifest.json``.
 */
export default function KnowledgeVaultSummary() {
  const t = useTranslations("knowledge.sidebar");
  const drive = useCurrentDrive();
  const [active, setActive] = useState<Vault | null | undefined>(undefined);

  useEffect(() => {
    if (!drive) {
      setActive(null);
      return;
    }
    let cancelled = false;
    listVaults(drive)
      .then((res) => {
        if (cancelled) return;
        const a = res.vaults.find((v) => v.id === res.active_vault_id) ?? null;
        setActive(a);
      })
      .catch(() => {
        if (!cancelled) setActive(null);
      });
    return () => {
      cancelled = true;
    };
  }, [drive]);

  if (!drive) return null;
  if (active === undefined) return null;
  if (active === null) return null;

  return (
    <Link
      href={`/drive/${encodeURIComponent(drive)}/addons/knowledge`}
      className="flex items-center gap-2 px-6 py-1 text-xs text-text-muted hover:text-text-primary"
      title={`${active.drive}/${active.path}`}
    >
      <Bookmark size={12} />
      <span className="truncate">{t("activePrefix", { label: active.label })}</span>
    </Link>
  );
}
