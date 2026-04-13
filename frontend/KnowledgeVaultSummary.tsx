"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { listVaults, type Vault } from "./api";

/**
 * Sidebar-sections slot: shows the currently-active Vault label below
 * the automatic "Knowledge" sidebar link. No-op when the user hasn't
 * configured a Vault yet — the main `/addons/knowledge` page will
 * prompt them to set one up.
 */
export default function KnowledgeVaultSummary() {
  const t = useTranslations("knowledge.sidebar");
  const [active, setActive] = useState<Vault | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    listVaults()
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
  }, []);

  if (active === undefined) return null;
  if (active === null) return null;

  return (
    <Link
      href="/addons/knowledge"
      className="flex items-center gap-2 px-6 py-1 text-xs text-text-muted hover:text-text-primary"
      title={`${active.drive}/${active.path}`}
    >
      <Bookmark size={12} />
      <span className="truncate">{t("activePrefix", { label: active.label })}</span>
    </Link>
  );
}
