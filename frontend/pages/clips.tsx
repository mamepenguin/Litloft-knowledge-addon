"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Newspaper, Plus } from "lucide-react";

import { Button } from "@/components/Button";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { PageFrame } from "@/components/PageFrame";
import { PageHeader } from "@/components/PageHeader";
import { useProfile } from "@/components/ProfileProvider";
import { useWebSocket } from "@/hooks/useWebSocket";

import ClipSection from "../ClipSection";
import ClipsAll from "../clips/ClipsAll";
import ClipsEmpty from "../clips/ClipsEmpty";
import ClipsHome from "../clips/ClipsHome";
import ClipsTabs from "../clips/ClipsTabs";
import { loadClipCount } from "../clips/requests";
import { useNoteClock } from "../useNoteClock";

type CountState = { status: "loading" | "ok" | "failed"; total: number | null };

export default function ClipsPage() {
  const drive = useCurrentDrive() ?? "";
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const t = useTranslations("knowledge.clips");
  const tNav = useTranslations("knowledge.nav");
  const tCommon = useTranslations("common");
  const { nickname } = useProfile();
  const now = useNoteClock();

  const viewAll = searchParams.get("view") === "all";
  const prefilled = Boolean(searchParams.get("prefill"));
  const [clipOpen, setClipOpen] = useState(prefilled);
  const [clipMounted, setClipMounted] = useState(prefilled);
  const clipRegionId = useId();

  // A 400 switches the landing to without-profile mode for this nickname; the
  // block is lifted only when the nickname changes, so no viewer request loops.
  const [viewerBlocked, setViewerBlocked] = useState(false);
  useEffect(() => {
    setViewerBlocked(false);
  }, [nickname]);
  const onViewerRequired = useCallback(() => setViewerBlocked(true), []);
  const withProfile = Boolean(nickname) && !viewerBlocked;

  const [count, setCount] = useState<CountState>({ status: "loading", total: null });
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    if (!drive) return;
    let cancelled = false;
    loadClipCount(drive)
      .then((total) => {
        if (!cancelled) setCount({ status: "ok", total });
      })
      .catch(() => {
        if (cancelled) return;
        setCount((prev) => (prev.status === "loading" ? { status: "failed", total: null } : prev));
      });
    return () => {
      cancelled = true;
    };
  }, [drive, refreshToken]);

  // The event already held when the page mounted belongs to an earlier visit.
  const ready = useWebSocket("knowledge.clip.ready");
  const seenReady = useRef<unknown>(undefined);
  useEffect(() => {
    if (seenReady.current === undefined) {
      seenReady.current = ready;
      return;
    }
    if (ready && ready !== seenReady.current) {
      seenReady.current = ready;
      refresh();
    }
  }, [ready, refresh]);

  const toggleClip = () => {
    setClipMounted(true);
    setClipOpen((open) => !open);
  };

  const decided = count.status !== "loading";
  const empty = count.status === "ok" && count.total === 0;
  const contentVisible = decided && !empty;
  const detail =
    count.status === "ok" && count.total !== null ? t("count", { count: count.total }) : null;
  const scope = drive
    ? detail
      ? tCommon("driveScope", { drive, detail })
      : drive
    : undefined;

  return (
    <PageFrame
      width="list"
      header={
        <PageHeader
          titleIcon={Newspaper}
          title={tNav("clips")}
          scope={scope}
          actions={
            <Button
              variant="primary"
              aria-label={t("action")}
              className="h-11 w-11 shrink-0 justify-center rounded-full px-0 sm:h-auto sm:w-auto sm:px-4"
              aria-expanded={clipOpen}
              aria-controls={clipMounted ? clipRegionId : undefined}
              onClick={toggleClip}
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              <span className="hidden sm:inline">{t("action")}</span>
            </Button>
          }
          tabs={contentVisible ? <ClipsTabs pathname={pathname} all={viewAll} /> : undefined}
        />
      }
    >
      <div className="flex flex-col px-4 pb-10">
        {clipMounted && (
          <div id={clipRegionId} className="mt-6" hidden={!clipOpen}>
            <ClipSection onClipAdded={refresh} />
          </div>
        )}

        {!viewAll && (
          <ClipsHome
            drive={drive}
            now={now}
            withProfile={withProfile}
            visible={contentVisible}
            refreshToken={refreshToken}
            onViewerRequired={onViewerRequired}
          />
        )}

        {viewAll && (
          <ClipsAll
            drive={drive}
            now={now}
            visible={contentVisible}
            refreshToken={refreshToken}
          />
        )}

        {empty && <ClipsEmpty title={t("emptyTitle")} body={t("emptyBody")} />}
      </div>
    </PageFrame>
  );
}
