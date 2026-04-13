"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

interface FileMeta {
  id: string;
  mime_type: string;
  filename: string;
}

const EDITABLE_MIMES = new Set(["text/markdown", "text/plain"]);

/**
 * File-detail slot: deep-links to the knowledge editor when the file
 * is a text note the editor can handle. Hidden otherwise.
 */
export default function KnowledgeEditSection({ fileId }: { fileId: string }) {
  const t = useTranslations("knowledge.editSection");
  const [file, setFile] = useState<FileMeta | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/files/${encodeURIComponent(fileId)}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: FileMeta | null) => {
        if (!cancelled) setFile(data);
      })
      .catch(() => {
        if (!cancelled) setFile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (file === undefined || file === null) return null;
  if (!EDITABLE_MIMES.has(file.mime_type)) return null;

  const href = `/addons/knowledge?edit=${encodeURIComponent(file.id)}`;

  return (
    <section className="rounded-xl border border-bg-border bg-bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold text-text-primary">
        {t("title")}
      </h3>
      <p className="mb-3 text-xs text-text-muted">{t("description")}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-2 rounded-md bg-accent-cta px-3 py-1.5 text-sm font-medium text-white hover:bg-accent"
      >
        <Pencil size={14} />
        {t("openEditor")}
      </Link>
    </section>
  );
}
