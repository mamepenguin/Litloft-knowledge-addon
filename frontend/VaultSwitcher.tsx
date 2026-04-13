"use client";

import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { activateVault, type Vault } from "./api";

interface Props {
  vaults: Vault[];
  activeId: number | null;
  onSwitched: (vault: Vault) => void;
  onAddNew: () => void;
}

export default function VaultSwitcher({
  vaults,
  activeId,
  onSwitched,
  onAddNew,
}: Props) {
  const t = useTranslations("knowledge");
  const [open, setOpen] = useState(false);
  const active = vaults.find((v) => v.id === activeId) ?? vaults[0];

  async function handleSelect(vault: Vault) {
    setOpen(false);
    if (vault.id === activeId) return;
    const updated = await activateVault(vault.id);
    onSwitched(updated);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded border border-border-default bg-surface-elevated px-3 py-2 text-text-primary"
      >
        <span className="font-medium">
          {active?.label ?? t("switcher.none")}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded border border-border-default bg-surface-elevated shadow-lg">
          <ul className="max-h-64 overflow-y-auto py-1">
            {vaults.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(v)}
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-hover ${
                    v.id === activeId ? "bg-surface-hover" : ""
                  }`}
                >
                  <span className="text-sm font-medium text-text-primary">
                    {v.label}
                  </span>
                  <span className="text-xs text-text-muted">
                    {v.drive}/{v.path || ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onAddNew();
            }}
            className="flex w-full items-center gap-2 border-t border-border-default px-3 py-2 text-left text-sm text-accent-cta hover:bg-surface-hover"
          >
            <Plus size={14} />
            {t("switcher.addNew")}
          </button>
        </div>
      )}
    </div>
  );
}
