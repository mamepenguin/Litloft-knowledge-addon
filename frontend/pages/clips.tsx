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
  hasUnreadableTrust,
  isClipGroup,
  isClipSort,
  needsProfile,
  needsViewFillIn,
  readClipFilters,
  readClipsView,
  type ClipGroup,
  type ClipSort,
  type ClipState,
  type ResolvedClipView,
} from "../clipsapp/clipsUrl";
import { ClipShelfBlock } from "../clipsapp/ClipShelfBlock";
import Home from "../clipsapp/Home";
import Library from "../clipsapp/Library";
import { loadClipCount, loadDriveClipCount } from "../clipsapp/requests";
import ShelfPage from "../clipsapp/ShelfPage";
import { useScopedLoad } from "../library/useScopedLoad";
import { NOTES_BASE_KINDS, rememberAppUrl, useNotesTarget } from "../notesapp/useNotesTarget";
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

  const [targetApplied, setTargetApplied] = useState(false);
  const onTargetApplied = useCallback(() => setTargetApplied(true), []);
  const notesTarget = useNotesTarget(
    drive,
    CLIPS_APP,
    searchParams.get("target"),
    onTargetApplied,
  );
  const { target } = notesTarget;
  const readyTarget = target.status === "ready" ? target : null;
  const metaContext = useMemo(
    () => ({ meta, refresh, dotsKey: withProfile ? nickname : null }),
    [meta, refresh, withProfile, nickname],
  );

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
  // The URL a Target was chosen on, until the router shows the URL without its view:
  // the replace lands after the new Target is already in force.
  const [switchedFrom, setSwitchedFrom] = useState<string | null>(null);
  useEffect(() => {
    setChosen(null);
    setSwitchedFrom(null);
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
  const switchPending = switchedFrom !== null && switchedFrom === search;
  const effectiveParams = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    if (switchPending || targetApplied) {
      next.delete("group");
      next.delete("sort");
      next.delete("tag");
      next.delete("trust");
    }
    return next;
  }, [searchParams, switchPending, targetApplied]);
  const view = readClipsView(effectiveParams, resolved);
  const filters = readClipFilters(effectiveParams);

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
        router.push(clipsHref(pathname, { view: "library", group, sort: view.sort }, filters));
      }
    },
    [saveView, view, filters, router, pathname],
  );
  const chooseSort = useCallback(
    (sort: ClipSort) => {
      saveView({ sort });
      if (view.view === "library" && sort !== view.sort) {
        router.push(clipsHref(pathname, { view: "library", group: view.group, sort }, filters));
      }
    },
    [saveView, view, filters, router, pathname],
  );

  const replaceFilters = useCallback(
    (change: { tags?: readonly string[]; trust?: ClipState }) => {
      const next = new URLSearchParams(searchParams);
      next.delete("target");
      if (change.tags !== undefined) {
        next.delete("tag");
        for (const tag of change.tags) next.append("tag", tag);
      }
      if (change.trust !== undefined) {
        if (change.trust === "all") next.delete("trust");
        else next.set("trust", change.trust);
      }
      const query = next.toString();
      router.replace(query === "" ? pathname : `${pathname}?${query}`);
    },
    [searchParams, router, pathname],
  );

  const toggleTag = useCallback(
    (name: string) => {
      const folded = name.toLowerCase();
      const chosen = filters.tags.some((tag) => tag.toLowerCase() === folded);
      replaceFilters({
        tags: chosen ? filters.tags.filter((tag) => tag.toLowerCase() !== folded) : [...filters.tags, name],
      });
    },
    [filters.tags, replaceFilters],
  );
  const clearTags = useCallback(() => replaceFilters({ tags: [] }), [replaceFilters]);
  const chooseState = useCallback(
    (state: ClipState) => replaceFilters({ trust: state }),
    [replaceFilters],
  );

  const chooseTarget = useCallback(
    (id: string) => {
      if (id === targetId) return;
      setChosen(null);
      if (view.view !== "home") {
        const withoutFilters = new URLSearchParams(searchParams);
        withoutFilters.delete("tag");
        withoutFilters.delete("trust");
        withoutFilters.delete("target");
        const base = withoutFilters.toString();
        const next = new URLSearchParams(withoutFilters);
        next.delete("group");
        next.delete("sort");
        const filtersChanged = base !== search;
        const viewChanged = next.toString() !== base;
        if (filtersChanged || viewChanged) setSwitchedFrom(search);
        if (filtersChanged) {
          router.replace(base === "" ? pathname : `${pathname}?${base}`);
        }
        if (viewChanged) {
          router.replace(`${pathname}?${next}`);
        }
      }
      notesTarget.choose(id);
    },
    [notesTarget, targetId, view.view, search, searchParams, router, pathname],
  );

  const switchSettled = switchedFrom !== null && !switchPending;
  useEffect(() => {
    if (switchSettled) setSwitchedFrom(null);
  }, [switchSettled]);

  const unknownView = hasUnknownView(searchParams);
  useEffect(() => {
    if (!unknownView) return;
    router.replace(notesTarget.pending ? rememberAppUrl(pathname) : pathname);
  }, [unknownView, notesTarget.pending, router, pathname]);

  const unreadableTrust = view.view !== "home" && hasUnreadableTrust(searchParams);
  useEffect(() => {
    if (!unreadableTrust) return;
    const next = new URLSearchParams(searchParams);
    next.delete("trust");
    const query = next.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`);
  }, [unreadableTrust, searchParams, router, pathname]);

  const leaveForHome = view.view === "shelf" && needsProfile(view.shelf) && !withProfile && settled;
  useEffect(() => {
    if (!leaveForHome) return;
    router.replace(notesTarget.pending ? rememberAppUrl(pathname) : pathname);
  }, [leaveForHome, notesTarget.pending, router, pathname]);

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
  // The one replace that fills the view in also removes `target`, so the Target
  // change and the URL cleanup land together.
  const fillHref =
    bodyDrawn &&
    !switchPending &&
    (needsViewFillIn(searchParams, view) || targetApplied || searchParams.has("target"))
      ? clipsHref(pathname, view, filters)
      : null;
  useEffect(() => {
    if (fillHref !== null) router.replace(fillHref);
  }, [fillHref, router]);

  const removeTargetHref =
    !notesTarget.pending && fillHref === null && searchParams.has("target")
      ? (() => {
          const next = new URLSearchParams(searchParams);
          next.delete("target");
          const query = next.toString();
          return query === "" ? pathname : `${pathname}?${query}`;
        })()
      : null;
  useEffect(() => {
    if (removeTargetHref !== null) router.replace(removeTargetHref);
  }, [removeTargetHref, router]);

  useEffect(() => {
    if (targetApplied && !searchParams.has("target")) setTargetApplied(false);
  }, [targetApplied, searchParams]);

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
        filters={filters}
        refresh={refresh}
        now={now}
        onGroup={chooseGroup}
        onSort={chooseSort}
        onToggleTag={toggleTag}
        onClearTags={clearTags}
        onState={chooseState}
        onViewerRejected={onViewerRequired}
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
        filters={filters}
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
              homeEntry: notesTarget.pending ? undefined : "knowledge/clips",
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
