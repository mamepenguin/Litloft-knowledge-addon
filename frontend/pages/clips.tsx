"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Newspaper, Plus } from "lucide-react";

import { AppHeader } from "@/components/appshell/AppHeader";
import { Button } from "@/components/Button";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { EmptyState } from "@/components/EmptyState";
import { PageFrame } from "@/components/PageFrame";
import { PageTabs } from "@/components/PageTabs";
import { useProfile } from "@/components/ProfileProvider";
import { useWebSocket } from "@/hooks/useWebSocket";
import { readTargetView, writeTargetView, type TargetView } from "@/lib/appPrefs";

import ClipSection from "../ClipSection";
import { ClipMeta, ClipMetaContext } from "../clipsapp/clipMeta";
import { CLIPS_APP } from "../clipsapp/clipsApp";
import {
  backTarget,
  clipsHref,
  DEFAULT_GROUP,
  DEFAULT_SORT,
  hasUnknownView,
  isClipGroup,
  isClipSort,
  needsProfile,
  needsViewFillIn,
  readClipsView,
  type ClipGroup,
  type ClipSort,
  type ResolvedClipView,
} from "../clipsapp/clipsUrl";
import { ClipShelfBlock } from "../clipsapp/ClipShelfBlock";
import Home from "../clipsapp/Home";
import Library from "../clipsapp/Library";
import { loadClipCount, loadDriveClipCount } from "../clipsapp/requests";
import ShelfPage from "../clipsapp/ShelfPage";
import { useScopedLoad } from "../library/useScopedLoad";
import { NOTES_BASE_KINDS, useNotesTarget } from "../notesapp/useNotesTarget";
import { useNoteClock } from "../useNoteClock";

interface ChosenView {
  drive: string;
  targetId: string;
  view: TargetView;
}

export default function ClipsPage() {
  const drive = useCurrentDrive() ?? "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const t = useTranslations("knowledge.clips");
  const tNav = useTranslations("knowledge.nav");
  const { nickname } = useProfile();
  const now = useNoteClock();

  const prefilled = Boolean(searchParams.get("prefill"));
  const [clipOpen, setClipOpen] = useState(prefilled);
  const [clipMounted, setClipMounted] = useState(prefilled);
  const clipRegionId = useId();

  // A 400 `viewer_required` is held against the nickname that earned it, so it
  // ends when the nickname changes and no viewer request loops before then.
  const [blockedFor, setBlockedFor] = useState<string | null>(null);
  const withProfile = Boolean(nickname) && blockedFor !== nickname;
  const nicknameRef = useRef(nickname);
  useEffect(() => {
    nicknameRef.current = nickname;
  });
  const onViewerRequired = useCallback(() => setBlockedFor(nicknameRef.current), []);

  // The profile is read from a cookie after the first commit, so a page that
  // needs one is not sent away before that has happened.
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);

  const meta = useMemo(() => new ClipMeta(drive, () => onViewerRequired()), [drive, onViewerRequired]);
  const [refresh, setRefresh] = useState(0);
  const refreshClips = useCallback(
    (fileId?: string) => {
      meta.refresh(fileId);
      setRefresh((n) => n + 1);
    },
    [meta],
  );
  const metaContext = useMemo(
    () => ({ meta, refresh, dotsKey: withProfile ? nickname : null }),
    [meta, refresh, withProfile, nickname],
  );

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
      const named = (ready.data as { file_id?: unknown } | undefined)?.file_id;
      refreshClips(typeof named === "string" ? named : undefined);
    }
  }, [ready, refreshClips]);

  const notesTarget = useNotesTarget(drive, CLIPS_APP);
  const { target } = notesTarget;
  const readyTarget = target.status === "ready" ? target : null;

  const counted = useScopedLoad(
    readyTarget ? `${drive}|${readyTarget.key}` : null,
    (signal) => (readyTarget ? loadClipCount(drive, readyTarget, { signal }) : Promise.resolve(0)),
    refresh,
  );
  const count = target.status === "empty" ? 0 : readyTarget ? counted.data : null;

  const targetHasNone = count === 0;
  const driveCounted = useScopedLoad(
    targetHasNone ? drive : null,
    (signal) => loadDriveClipCount(drive, { signal }),
    refresh,
  );
  const driveCount = targetHasNone ? driveCounted.data : null;
  const driveEmpty = driveCount === 0;
  const targetEmpty = targetHasNone && driveCount !== null && driveCount > 0;

  const targetId = notesTarget.selectedId;
  const storedView = readTargetView(CLIPS_APP, drive, targetId);
  const [chosen, setChosen] = useState<ChosenView | null>(null);
  // The Target chosen from a Library or shelf URL, and that URL: the new Target's view
  // replaces the URL's group and sort only while the viewer is still on it.
  const [switchTo, setSwitchTo] = useState<{ id: string; search: string } | null>(null);
  useEffect(() => {
    setChosen(null);
    setSwitchTo(null);
  }, [drive]);

  const heldView =
    chosen !== null && chosen.drive === drive && chosen.targetId === targetId
      ? { ...storedView, ...chosen.view }
      : storedView;
  const resolved: ResolvedClipView = {
    group: isClipGroup(heldView.group) ? heldView.group : DEFAULT_GROUP,
    sort: isClipSort(heldView.sort) ? heldView.sort : DEFAULT_SORT,
  };

  // A Target change carries the new Target's resolved view, not the values the
  // previous Target's URL still holds.
  const search = searchParams.toString();
  const switchPending = switchTo !== null && switchTo.search === search;
  const effectiveParams = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    if (switchPending) {
      next.delete("group");
      next.delete("sort");
    }
    return next;
  }, [searchParams, switchPending]);
  const view = readClipsView(effectiveParams, resolved);

  const saveView = useCallback(
    (change: TargetView) => {
      writeTargetView(CLIPS_APP, drive, targetId, change);
      setChosen((prev) => ({
        drive,
        targetId,
        view: {
          ...(prev !== null && prev.drive === drive && prev.targetId === targetId ? prev.view : {}),
          ...change,
        },
      }));
    },
    [drive, targetId],
  );

  const chooseGroup = useCallback(
    (group: ClipGroup) => {
      saveView({ group });
      if (view.view === "library" && group !== view.group) {
        router.push(clipsHref(pathname, { view: "library", group, sort: view.sort }));
      }
    },
    [saveView, view, router, pathname],
  );
  const chooseSort = useCallback(
    (sort: ClipSort) => {
      saveView({ sort });
      if (view.view === "library" && sort !== view.sort) {
        router.push(clipsHref(pathname, { view: "library", group: view.group, sort }));
      }
    },
    [saveView, view, router, pathname],
  );

  const chooseTarget = useCallback(
    (id: string) => {
      if (id === targetId) return;
      setChosen(null);
      if (view.view !== "home") setSwitchTo({ id, search });
      notesTarget.choose(id);
    },
    [notesTarget, targetId, view.view, search],
  );

  const switchHref =
    switchPending && target.status === "ready" && targetId === switchTo.id ? clipsHref(pathname, view) : null;
  const switchSettled =
    switchTo !== null && (!switchPending || (target.status === "ready" && targetId !== switchTo.id));
  useEffect(() => {
    if (switchSettled) {
      setSwitchTo(null);
      return;
    }
    if (switchHref === null) return;
    router.replace(switchHref);
    setSwitchTo(null);
  }, [switchHref, switchSettled, router]);

  const unknownView = hasUnknownView(searchParams);
  useEffect(() => {
    if (unknownView) router.replace(pathname);
  }, [unknownView, router, pathname]);

  const leaveForHome = view.view === "shelf" && needsProfile(view.shelf) && !withProfile && settled;
  useEffect(() => {
    if (leaveForHome) router.replace(pathname);
  }, [leaveForHome, router, pathname]);

  const toggleClip = () => {
    setClipMounted(true);
    setClipOpen((open) => !open);
  };

  const tabCurrent =
    view.view === "library" || (view.view === "shelf" && backTarget(view.shelf, view.sort).view === "library")
      ? "library"
      : "home";
  const tabs = driveEmpty ? undefined : (
    <PageTabs
      label={t("tabsLabel")}
      current={tabCurrent}
      wrap
      items={[
        { key: "home", label: t("home"), href: pathname },
        { key: "library", label: t("library"), href: `${pathname}?view=all` },
      ]}
    />
  );

  const bodyDrawn =
    !driveEmpty && target.status === "ready" && !targetHasNone && view.view !== "home";
  const fillHref =
    bodyDrawn && !switchPending && needsViewFillIn(searchParams, view)
      ? clipsHref(pathname, view)
      : null;
  useEffect(() => {
    if (fillHref !== null) router.replace(fillHref);
  }, [fillHref, router]);

  let body;
  if (driveEmpty) {
    body = <EmptyState icon={Newspaper} title={t("emptyTitle")} description={t("emptyBody")} />;
  } else if (target.status === "lookingUp") {
    body = (
      <ClipShelfBlock title="" view={{ status: "loading" }} onRetry={() => {}} renderItem={() => null} />
    );
  } else if (targetHasNone && driveCount === null) {
    body = null;
  } else if (view.view === "home") {
    body = (
      <>
        {targetEmpty && <EmptyState icon={Newspaper} title={t("noClipsInTarget")} />}
        <Home
          drive={drive}
          pathname={pathname}
          target={targetEmpty ? null : readyTarget}
          withProfile={withProfile}
          nickname={nickname}
          refresh={refresh}
          now={now}
          onViewerRequired={onViewerRequired}
        />
      </>
    );
  } else if (view.view === "library") {
    body = targetEmpty ? (
      <EmptyState icon={Newspaper} title={t("noClipsInTarget")} />
    ) : readyTarget ? (
      <Library
        drive={drive}
        pathname={pathname}
        target={readyTarget}
        group={view.group}
        sort={view.sort}
        refresh={refresh}
        now={now}
        onGroup={chooseGroup}
        onSort={chooseSort}
      />
    ) : null;
  } else if (leaveForHome) {
    body = null;
  } else if (targetEmpty && view.shelf.kind !== "recent") {
    body = <p className="py-6 text-sm text-text-muted">{t("noClipsHere")}</p>;
  } else {
    body = (
      <ShelfPage
        drive={drive}
        pathname={pathname}
        target={readyTarget}
        shelf={view.shelf}
        sort={view.sort}
        nickname={nickname}
        refresh={refresh}
        now={now}
        onViewerRequired={onViewerRequired}
      />
    );
  }

  return (
    <ClipMetaContext value={metaContext}>
      <PageFrame
        width="wide"
        header={
          <AppHeader
            drive={drive}
            icon={Newspaper}
            title={tNav("clips")}
            countDetail={count === null ? null : t("count", { count })}
            tabs={tabs}
            primaryAction={
              <Button
                variant="primary"
                aria-expanded={clipOpen}
                aria-controls={clipMounted ? clipRegionId : undefined}
                onClick={toggleClip}
              >
                <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
                {t("action")}
              </Button>
            }
            target={{
              drive,
              app: CLIPS_APP,
              name: notesTarget.known ? (notesTarget.name ?? t("allClips")) : null,
              folders: notesTarget.folders,
              collections: { list: notesTarget.collections, retry: notesTarget.retryCollections },
              selectedId: notesTarget.selectedId,
              currentCount: count,
              label: t("target"),
              defaultLabel: t("allClips"),
              unavailableLabel: t("unavailable"),
              defaultTargetTypes: NOTES_BASE_KINDS,
              defaultTargetOrigin: "webclip",
              isUsable: notesTarget.isUsable,
              onChoose: chooseTarget,
              onRetryFolders: notesTarget.retryFolders,
            }}
          />
        }
      >
        <div className={`px-4 pb-10 ${view.view === "home" ? "pt-7" : view.view === "library" ? "pt-4" : "pt-6"}`}>
          {clipMounted && (
            <div id={clipRegionId} className="mb-6" hidden={!clipOpen}>
              <ClipSection onClipAdded={refreshClips} />
            </div>
          )}
          {body}
        </div>
      </PageFrame>
    </ClipMetaContext>
  );
}
