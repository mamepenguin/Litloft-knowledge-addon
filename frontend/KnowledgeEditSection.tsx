"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { isInlineKnowledgeEditorEnabled } from "@/lib/featureFlags";
import { usePolicy } from "@/hooks/usePolicy";
import Editor from "./Editor";

interface FileMeta {
  id: string;
  mime_type: string;
  filename: string;
}

// Markdown only. Other text/* mimes fall back to read-only file detail
// (spec docs/superpowers/specs/2026-05-10-markdown-document-layout.md
// §3 C2 採用).
const EDITABLE_MIMES = new Set(["text/markdown"]);

/**
 * File-detail slot for editable text notes.
 *
 * Two render paths gated by ``NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR``
 * (Phase 2 PR-3, hako ``RGstVXy42Bfw-FlpP8hCx`` case X):
 *
 * - **flag false** (default): legacy "Edit Note" CTA that deep-links
 *   to ``/addons/knowledge?edit={id}``. Behaviour unchanged.
 *
 * - **flag true**: mount the editor inline, flat under the
 *   surrounding ``FileDetailContent`` (no surrounding card frame, no
 *   h3 heading) so the textarea sits in the same visual stack as the
 *   tag chips, summary, related files, etc. ``?edit=1`` (carried via
 *   ``CARRIED_QUERY_KEYS`` from the ``/files/{id}`` redirect, hako
 *   ``fGOUPRw-H4AJ4w12jrxeq`` Pre-PR) tells the editor to focus the
 *   textarea after load so ``useCreateFile`` and "Edit Note" CTAs
 *   land directly in the edit surface.
 */
export default function KnowledgeEditSection({
  fileId,
  drive,
  fillHeight,
}: {
  fileId: string;
  drive: string;
  fillHeight?: boolean;
}) {
  const t = useTranslations("knowledge.editSection");
  const searchParams = useSearchParams();
  const [file, setFile] = useState<FileMeta | null | undefined>(undefined);
  const policy = usePolicy(drive, "knowledge", "editor");

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
  if (!policy.isLoading && !policy.enabled) return null;

  if (isInlineKnowledgeEditorEnabled()) {
    const autoFocus = searchParams.get("edit") === "1";
    return (
      <Editor
        fileId={file.id}
        filename={file.filename}
        drive={drive}
        inlineMode
        autoFocus={autoFocus}
        fillHeight={fillHeight}
      />
    );
  }

  const href = `/drive/${encodeURIComponent(drive)}/addons/knowledge?edit=${encodeURIComponent(file.id)}`;

  return (
    <section className="rounded-xl border border-bg-border bg-bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold text-text-primary">
        {t("title")}
      </h3>
      <p className="mb-3 text-xs text-text-muted">{t("description")}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-2 rounded-lg bg-accent-cta px-3 py-1.5 text-sm font-medium text-white hover:bg-accent"
      >
        <Pencil size={14} />
        {t("openEditor")}
      </Link>
    </section>
  );
}
