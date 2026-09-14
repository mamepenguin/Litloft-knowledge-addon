"use client";

import Link from "next/link";

import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import type { FileItem } from "@/types";

export default function NoteList({ files }: { files: FileItem[] }) {
  return (
    <ul className="flex flex-col gap-1.5" role="list">
      {files.map((file) => (
        <li key={file.id}>
          <Link
            href={buildCanonicalFileUrl(file, file.id)}
            className="flex min-w-0 flex-col rounded-xl border border-bg-border bg-bg-elevated px-3.5 py-2.5 transition-colors hover:bg-bg-card"
          >
            <span className="truncate text-sm text-text-primary">{file.title || file.filename}</span>
            {file.folder_path && (
              <span className="truncate text-[11px] text-text-muted">{file.folder_path}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
