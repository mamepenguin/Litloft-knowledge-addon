"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DocumentCaptureController } from "@/lib/documentCapture";

import { isInlineKnowledgeEditorEnabled } from "@/lib/featureFlags";
import { usePolicy } from "@/hooks/usePolicy";
import Editor from "./Editor";
import MediaCaptureAction from "./MediaCaptureAction";

interface FileMeta {
  id: string;
  mime_type: string;
  filename: string;
  folder_path: string;
}

// Markdown only. Other text/* mimes fall back to read-only file detail
// (spec docs/superpowers/specs/2026-05-10-markdown-document-layout.md
// §3 C2 採用).
const EDITABLE_MIMES = new Set(["text/markdown"]);

/**
 * File-detail slot for the Knowledge editor.
 *
 * `.md` only, and only the editor: either the inline one, or a link to
 * the full one where the inline editor is switched off. Every other kind
 * of file gets nothing here.
 *
 * "Create note" used to live here too, as a card with a heading and a
 * sentence of explanation drawn on every file detail page whether or not
 * anyone was going to make a note. It is a `file-actions-menu` entry now
 * (`CreateNoteMenuItem`) — an occasional, deliberate act, which is what
 * the `[...]` menu is for — and that is what leaves this component with
 * nothing to say about a video or an archive.
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
  const tEdit = useTranslations("knowledge.editSection");
  const searchParams = useSearchParams();
  const [file, setFile] = useState<FileMeta | null | undefined>(undefined);
  const [documentCaptureController, setDocumentCaptureController] =
    useState<DocumentCaptureController | null>(null);
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
  if (!policy.isLoading && !policy.enabled) return null;

  const isMarkdown = EDITABLE_MIMES.has(file.mime_type);

  if (!isMarkdown) return null;

  if (isInlineKnowledgeEditorEnabled()) {
    const autoFocus = searchParams.get("edit") === "1";
    return (
      <>
        <Editor
          fileId={file.id}
          filename={file.filename}
          folderPath={file.folder_path}
          drive={drive}
          inlineMode
          autoFocus={autoFocus}
          fillHeight={fillHeight}
          onDocumentCaptureController={setDocumentCaptureController}
        />
        {/* The editor's own capture control, holding the editor's
            controller. Distinct from the `file-detail-actions` entry of
            the same component, which holds whichever controller the
            canvas published — and where the inline editor is the canvas,
            there is none, so the two are never both live. */}
        <MediaCaptureAction
          fileId={file.id}
          drive={drive}
          filename={file.filename}
          fileType="document"
          documentCaptureController={documentCaptureController}
        />
      </>
    );
  }

  const editHref = `/drive/${encodeURIComponent(drive)}/addons/knowledge?edit=${encodeURIComponent(file.id)}`;

  return (
    <section className="rounded-xl border border-bg-border bg-bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold text-text-primary">
        {tEdit("title")}
      </h3>
      <p className="mb-3 text-xs text-text-muted">{tEdit("description")}</p>
      <Link
        href={editHref}
        className="inline-flex items-center gap-2 rounded-lg bg-accent-cta px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
      >
        <Pencil size={14} />
        {tEdit("openEditor")}
      </Link>
    </section>
  );
}
