"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FilePlus, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { isInlineKnowledgeEditorEnabled } from "@/lib/featureFlags";
import { usePolicy } from "@/hooks/usePolicy";
import CreateNoteDialog from "./CreateNoteDialog";
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
 * File-detail slot for Knowledge addon actions.
 *
 * Shows an "Edit note" CTA for `.md` files and a "Create note" button for
 * all file types (including `.md`). The "Create note" button opens
 * CreateNoteDialog which lets the user set filename + folder before
 * calling POST /note-from-file.
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
  const tCreate = useTranslations("knowledge.createNote");
  const searchParams = useSearchParams();
  const [file, setFile] = useState<FileMeta | null | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
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

  const createNoteBtn = (
    <button
      onClick={() => setDialogOpen(true)}
      className="inline-flex items-center gap-2 rounded-lg border border-bg-border bg-bg-surface px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-hover"
    >
      <FilePlus size={14} />
      {tCreate("button")}
    </button>
  );

  const stem = file.filename.replace(/\.[^./\\]+$/, "");

  const dialog = (
    <CreateNoteDialog
      drive={drive}
      sourceFileId={fileId}
      defaultStem={stem}
      open={dialogOpen}
      onClose={() => setDialogOpen(false)}
    />
  );

  if (isMarkdown) {
    if (isInlineKnowledgeEditorEnabled()) {
      const autoFocus = searchParams.get("edit") === "1";
      return (
        <>
          <Editor
            fileId={file.id}
            filename={file.filename}
            drive={drive}
            inlineMode
            autoFocus={autoFocus}
            fillHeight={fillHeight}
          />
          <section className="rounded-xl border border-bg-border bg-bg-card p-4">
            {createNoteBtn}
          </section>
          {dialog}
        </>
      );
    }

    const editHref = `/drive/${encodeURIComponent(drive)}/addons/knowledge?edit=${encodeURIComponent(file.id)}`;

    return (
      <>
        <section className="rounded-xl border border-bg-border bg-bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-text-primary">
            {tEdit("title")}
          </h3>
          <p className="mb-3 text-xs text-text-muted">{tEdit("description")}</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={editHref}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-cta px-3 py-1.5 text-sm font-medium text-white hover:bg-accent"
            >
              <Pencil size={14} />
              {tEdit("openEditor")}
            </Link>
            {createNoteBtn}
          </div>
        </section>
        {dialog}
      </>
    );
  }

  return (
    <>
      <section className="rounded-xl border border-bg-border bg-bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-text-primary">
          {tCreate("button")}
        </h3>
        <p className="mb-3 text-xs text-text-muted">{tCreate("description")}</p>
        {createNoteBtn}
      </section>
      {dialog}
    </>
  );
}
