"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams, notFound } from "next/navigation";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { isInlineKnowledgeEditorEnabled } from "@/lib/featureFlags";
import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import NotesPage from "./NotesPage";

async function fetchFileMeta(fileId: string) {
  const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return res.json();
}

export default function KnowledgePage() {
  const drive = useCurrentDrive();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editParam = searchParams.get("edit");
  const prefilled = searchParams.has("prefill");
  const query = searchParams.get("q")?.trim() ?? "";
  const searchOnHome = query !== "" && searchParams.get("view") !== "all";
  const base = drive === null ? "" : `/drive/${encodeURIComponent(drive)}/addons/knowledge`;

  // The bookmarklet's old landing. Clips owns the clip form.
  useEffect(() => {
    if (!prefilled || drive === null) return;
    router.replace(`${base}/clips?${searchParams.toString()}`);
  }, [prefilled, drive, base, router, searchParams]);

  // The landing's old search box. The Library searches its own list.
  useEffect(() => {
    if (prefilled || !searchOnHome) return;
    router.replace(`${base}?${new URLSearchParams({ view: "all", q: query })}`);
  }, [prefilled, searchOnHome, query, base, router]);

  // Legacy ?edit=ID deep-link: redirect to core's 2-pane canonical URL
  // so the file opens in the inline KnowledgeEditSection instead of here.
  // Anything else lands where it is, without `edit`.
  useEffect(() => {
    if (!editParam || prefilled || searchOnHome) return;
    let current = true;
    const dropEdit = () => {
      if (!current) return;
      const rest = new URLSearchParams(searchParams);
      rest.delete("edit");
      const qs = rest.toString();
      router.replace(qs ? `${base}?${qs}` : base);
    };
    if (!isInlineKnowledgeEditorEnabled()) {
      dropEdit();
      return () => {
        current = false;
      };
    }
    (async () => {
      const file = await fetchFileMeta(editParam).catch(() => null);
      if (!current) return;
      if (
        file &&
        (file.mime_type === "text/markdown" ||
          file.mime_type === "text/plain")
      ) {
        router.replace(buildCanonicalFileUrl(file, file.id, { edit: "1" }));
      } else {
        dropEdit();
      }
    })();
    return () => {
      current = false;
    };
  }, [editParam, prefilled, searchOnHome, base, router, searchParams]);

  if (drive === null) {
    notFound();
  }

  // The page the URL is leaving is not drawn, so it sends no request.
  if (prefilled || searchOnHome) return null;

  return <NotesPage />;
}
