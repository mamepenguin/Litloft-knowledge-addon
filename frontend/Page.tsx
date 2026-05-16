"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams, notFound } from "next/navigation";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { useOverlaySidebar } from "@/components/SidebarProvider";
import { isInlineKnowledgeEditorEnabled } from "@/lib/featureFlags";
import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import KnowledgeDashboard from "./KnowledgeDashboard";

async function fetchFileMeta(fileId: string) {
  const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return res.json();
}

export default function KnowledgePage() {
  useOverlaySidebar();
  const drive = useCurrentDrive();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editParam = searchParams.get("edit");

  // Legacy ?edit=ID deep-link: redirect to core's 2-pane canonical URL
  // so the file opens in the inline KnowledgeEditSection instead of here.
  useEffect(() => {
    if (!editParam || !isInlineKnowledgeEditorEnabled()) return;
    (async () => {
      const file = await fetchFileMeta(editParam);
      if (
        file &&
        (file.mime_type === "text/markdown" ||
          file.mime_type === "text/plain")
      ) {
        router.replace(buildCanonicalFileUrl(file, file.id, { edit: "1" }));
      }
    })();
  }, [editParam, router]);

  if (drive === null) {
    notFound();
  }

  return <KnowledgeDashboard />;
}
