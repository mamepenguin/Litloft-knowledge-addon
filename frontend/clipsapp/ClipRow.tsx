"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/Button";
import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import type { FileItem } from "@/types";

import { useCardMenuHandlers } from "../cardMenu/PageFileMenu";
import type { ClipCover } from "../api";
import { clipTitle, Cover, useMetaLine } from "./ClipCard";

export type VerifyStatus = "idle" | "saving" | "failed";

/** An Unverified row: a thumbnail, the title, "site · age", and the button that marks it verified. */
export default function ClipRow({
  file,
  cover,
  now,
  status,
  listKey,
  onVerify,
}: {
  file: FileItem;
  cover: ClipCover | undefined;
  now: Date;
  status: VerifyStatus;
  /** The page list this row belongs to; absent leaves the row as it was. */
  listKey?: string;
  onVerify: () => void;
}) {
  const t = useTranslations("knowledge.clips");
  const metaLine = useMetaLine();
  const href = buildCanonicalFileUrl(file, file.id);
  const menu = useCardMenuHandlers(
    file,
    listKey === undefined ? undefined : { href, listKey },
  );
  return (
    <div className="flex items-center gap-3.5 border-b border-bg-border py-2.5">
      <span
        onClick={menu.onClick}
        onContextMenu={menu.onContextMenu}
        onTouchStart={menu.onTouchStart}
        onTouchEnd={menu.onTouchEnd}
        onTouchMove={menu.onTouchMove}
        className="shrink-0 select-none [-webkit-touch-callout:none]"
      >
        <Cover cover={cover} className="h-[54px] w-[72px] rounded-lg" />
      </span>
      <Link
        href={href}
        onClick={menu.onClick}
        onContextMenu={menu.onContextMenu}
        onTouchStart={menu.onTouchStart}
        onTouchEnd={menu.onTouchEnd}
        onTouchMove={menu.onTouchMove}
        className="min-w-0 flex-1 select-none rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [-webkit-touch-callout:none]"
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
