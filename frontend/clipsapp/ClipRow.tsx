"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/Button";
import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import type { FileItem } from "@/types";

import type { ClipCover } from "../api";
import { clipTitle, Cover, useMetaLine } from "./ClipCard";

export type VerifyStatus = "idle" | "saving" | "failed";

/** An Unverified row: a thumbnail, the title, "site · age", and the button that marks it verified. */
export default function ClipRow({
  file,
  cover,
  now,
  status,
  onVerify,
}: {
  file: FileItem;
  cover: ClipCover | undefined;
  now: Date;
  status: VerifyStatus;
  onVerify: () => void;
}) {
  const t = useTranslations("knowledge.clips");
  const metaLine = useMetaLine();
  return (
    <div className="flex items-center gap-3.5 border-b border-bg-border py-2.5">
      <Cover cover={cover} className="h-[54px] w-[72px] shrink-0 rounded-lg" />
      <Link
        href={buildCanonicalFileUrl(file, file.id)}
        className="min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span className="block truncate text-[15px] font-semibold text-text-primary">{clipTitle(file)}</span>
        <span className="mt-0.5 block min-h-4 truncate text-xs text-text-muted">
          {metaLine(file, cover?.site, now, { minutes: false, age: true })}
        </span>
      </Link>
      {status === "failed" && (
        <span role="alert" className="shrink-0 text-xs text-danger">
          {t("saveFailed")}
        </span>
      )}
      <Button variant="secondary" size="sm" className="h-8 shrink-0 text-[13px] font-semibold" disabled={status === "saving"} onClick={onVerify}>
        {t("markVerified")}
      </Button>
    </div>
  );
}
