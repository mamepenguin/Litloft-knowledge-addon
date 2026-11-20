"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { useLoad, type LoadState } from "@/components/appshell/useLoad";
import { useMemberTarget } from "@/components/appshell/useMemberTarget";
import { getCollections, getSmartFolders } from "@/lib/api";
import { readAppTarget, writeAppTarget, type AppKey } from "@/lib/appPrefs";
import {
  collectionTargetId,
  parseAppTargetId,
  resolveAppTarget,
  resolveCollectionTarget,
  type AppTargetParams,
} from "@/lib/appTarget";
import { resolveMemberTarget, type MemberTarget } from "@/lib/memberTarget";
import type { CollectionSummary, FileKind } from "@/types";
import type { SmartFolder } from "@/types/smartFolder";

export const NOTES_APP: AppKey = { addon: "knowledge" };
export const NOTES_BASE_KINDS: readonly FileKind[] = ["text"];

export type TargetParams = AppTargetParams;

/**
 * What every request that lists or counts notes carries. `params` is `null`
 * for the default target; `fileIds` is set for a member target, whose ids go
 * through the `POST ...query` routes instead of conditions.
 */
export type NotesTarget =
  | { status: "lookingUp" }
  | { status: "empty" }
  | { status: "ready"; key: string; params: TargetParams | null; fileIds: string[] | null };

export type ReadyNotesTarget = Extract<NotesTarget, { status: "ready" }>;

export interface NotesTargetState {
  target: NotesTarget;
  /** The saved target is known, so the menu can show its name. */
  known: boolean;
  /** The target in force as the id it is saved under. */
  selectedId: string;
  /** The target's name; `null` for the default target and while it is looked up. */
  name: string | null;
  folders: LoadState<SmartFolder[]>;
  retryFolders: () => void;
  collections: LoadState<CollectionSummary[]>;
  retryCollections: () => void;
  isUsable: (folder: SmartFolder) => boolean;
  choose: (id: string) => void;
  /** The URL's `target` is still being resolved, so every request is held. */
  pending: boolean;
}

interface Resolution {
  folder: SmartFolder | null;
  collection: CollectionSummary | null;
  /** `null` for the default target, a member target, or an empty one. */
  params: TargetParams | null;
  member: MemberTarget | null;
  /** No note can match: nothing is requested. */
  empty: boolean;
}

const DEFAULT_RESOLUTION: Resolution = {
  folder: null,
  collection: null,
  params: null,
  member: null,
  empty: false,
};

function resolveSaved(folder: SmartFolder | null, collection: CollectionSummary | null): Resolution {
  if (collection !== null) {
    const resolved = resolveCollectionTarget(collection, NOTES_BASE_KINDS);
    return {
      ...DEFAULT_RESOLUTION,
      collection,
      params: resolved.usable && !("empty" in resolved) ? resolved.params : null,
    };
  }
  if (folder === null) return DEFAULT_RESOLUTION;
  const member = resolveMemberTarget(folder, NOTES_BASE_KINDS);
  if (member !== null) return { ...DEFAULT_RESOLUTION, folder, member, empty: member.kinds.length === 0 };
  const resolved = resolveAppTarget(folder, NOTES_BASE_KINDS);
  if (!resolved.usable) return DEFAULT_RESOLUTION;
  if ("empty" in resolved) return { ...DEFAULT_RESOLUTION, folder, empty: true };
  return { ...DEFAULT_RESOLUTION, folder, params: resolved.params };
}

function isListing(state: LoadState<unknown>): boolean {
  return state.status === "loading" || state.status === "idle";
}

/** `default` and an empty value name no Target the app could save. */
function candidateTarget(param: string | null): string | null {
  return param !== null && param !== "" && param !== "default" ? param : null;
}

/**
 * URLs this app replaced the page with. A rewrite can remove `target` while
 * the id it named is still pending; the id lives in the app's state, so the
 * removal must not be read as the viewer navigating away.
 */
const appUrls = new Set<string>();

export function rememberAppUrl(url: string): string {
  appUrls.add(url);
  return url;
}

function consumeAppUrl(url: string): boolean {
  return appUrls.delete(url);
}

/**
 * An app's target: every active note of the drive, a collection, or a
 * Smart Collection. `app` names where the choice is saved and must be a
 * stable value; Notes' own is the default. One that is gone, cannot be resolved, or whose members
 * cannot be evaluated is ignored while its saved id stays, as the other apps do.
 *
 * `targetParam` is the URL's `target` at the page's first render. It is held in
 * state until the list that resolves it answers, so the page's own replaces do
 * not drop it; a viewer navigation that removes it does.
 */
export function useNotesTarget(
  drive: string,
  app: AppKey = NOTES_APP,
  targetParam: string | null = null,
  onApply?: (id: string) => void,
): NotesTargetState {
  const [held, setHeld] = useState(() => ({ drive, id: readAppTarget(drive, app) }));
  const [pendingId, setPendingId] = useState(() => candidateTarget(targetParam));
  let savedId = held.id;
  if (held.drive !== drive) {
    savedId = readAppTarget(drive, app);
    setHeld({ drive, id: savedId });
  }

  // The pending id is gone from the URL only once the page has handled it or
  // the viewer moved; a rewrite the page made itself is not a move.
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";
  const currentUrl = query === "" ? pathname : `${pathname}?${query}`;
  const seenTarget = useRef(targetParam);
  useEffect(() => {
    if (seenTarget.current === targetParam) return;
    seenTarget.current = targetParam;
    const expected = consumeAppUrl(currentUrl);
    if (pendingId !== null && !expected) setPendingId(null);
  }, [targetParam, pendingId, currentUrl]);

  const loadFolders = useCallback(() => getSmartFolders(drive), [drive]);
  const { state: folders, retry: retryFolders } = useLoad(loadFolders);
  const loadCollections = useCallback(() => getCollections(drive), [drive]);
  const { state: collections, retry: retryCollections } = useLoad(loadCollections);

  const saved = parseAppTargetId(savedId);
  const listedFolder =
    saved.kind === "smart" && folders.status === "loaded"
      ? (folders.data.find((candidate) => candidate.id === saved.id) ?? null)
      : null;
  const listedCollection =
    saved.kind === "collection" && collections.status === "loaded"
      ? (collections.data.find((candidate) => candidate.id === saved.id) ?? null)
      : null;
  const resolved = useMemo(
    () => resolveSaved(listedFolder, listedCollection),
    [listedFolder, listedCollection],
  );

  // A pending target must not evaluate the saved target's members: that is a
  // listing request carrying the Target the viewer did not choose.
  const evaluatingMember = pendingId === null ? resolved.member : null;
  const { evaluation } = useMemberTarget(
    drive,
    pendingId === null ? listedFolder : null,
    evaluatingMember,
  );
  const unusableMember = evaluation?.status === "failed" || evaluation?.status === "tooLarge";
  const evaluating = evaluatingMember !== null && !resolved.empty && evaluation === null;
  const lookingUpList =
    (saved.kind === "smart" && isListing(folders)) ||
    (saved.kind === "collection" && isListing(collections));

  const unavailableId = unusableMember && resolved.folder !== null ? resolved.folder.id : null;
  const fileIds = evaluation?.status === "ready" ? evaluation.fileIds : null;

  const target = useMemo<NotesTarget>(() => {
    if (pendingId !== null) return { status: "lookingUp" };
    if (lookingUpList || evaluating) return { status: "lookingUp" };
    if (unusableMember) return { status: "ready", key: "default", params: null, fileIds: null };
    if (resolved.empty) return { status: "empty" };
    if (resolved.collection !== null) {
      return {
        status: "ready",
        key: `collection:${resolved.collection.id}`,
        params: resolved.params,
        fileIds: null,
      };
    }
    if (resolved.member !== null) {
      return {
        status: "ready",
        key: `member:${resolved.member.id}:${fileIds?.length ?? 0}`,
        params: null,
        fileIds,
      };
    }
    if (resolved.folder !== null) {
      return { status: "ready", key: `smart:${resolved.folder.id}`, params: resolved.params, fileIds: null };
    }
    return { status: "ready", key: "default", params: null, fileIds: null };
  }, [pendingId, lookingUpList, evaluating, unusableMember, resolved, fileIds]);

  const inForce = unusableMember ? null : resolved;
  const savedSelectedId =
    inForce?.collection != null
      ? collectionTargetId(inForce.collection.id)
      : (inForce?.folder?.id ?? "default");
  const selectedId = pendingId ?? savedSelectedId;
  const name =
    pendingId !== null ? null : (inForce?.collection?.name ?? inForce?.folder?.name ?? null);

  const isUsable = useCallback(
    (candidate: SmartFolder) =>
      candidate.id !== unavailableId &&
      (resolveAppTarget(candidate, NOTES_BASE_KINDS).usable ||
        resolveMemberTarget(candidate, NOTES_BASE_KINDS) !== null),
    [unavailableId],
  );

  let pendingState: "none" | "waiting" | "apply" | "ignore" = "none";
  let applyId: string | null = null;
  if (pendingId !== null) {
    if (parseAppTargetId(pendingId).kind === "collection") {
      if (collections.status === "failed") pendingState = "ignore";
      else if (collections.status !== "loaded") pendingState = "waiting";
      else if (collections.data.some((candidate) => collectionTargetId(candidate.id) === pendingId)) {
        pendingState = "apply";
        applyId = pendingId;
      } else pendingState = "ignore";
    } else if (folders.status === "failed") {
      pendingState = "ignore";
    } else if (folders.status !== "loaded") {
      pendingState = "waiting";
    } else {
      const folder = folders.data.find((candidate) => candidate.id === pendingId) ?? null;
      if (folder !== null && isUsable(folder)) {
        pendingState = "apply";
        applyId = pendingId;
      } else pendingState = "ignore";
    }
  }

  useEffect(() => {
    if (pendingState === "apply" && applyId !== null) {
      // Choosing the Target already saved is a no-op, as in the menu.
      if (applyId !== savedId) onApply?.(applyId);
      writeAppTarget(drive, app, applyId);
      setHeld({ drive, id: applyId });
      setPendingId(null);
    } else if (pendingState === "ignore") {
      setPendingId(null);
    }
  }, [drive, app, pendingState, applyId, savedId, onApply]);

  const choose = useCallback(
    (id: string) => {
      writeAppTarget(drive, app, id);
      setHeld({ drive, id });
      setPendingId(null);
    },
    [drive, app],
  );

  return {
    target,
    known: pendingId === null && !lookingUpList,
    selectedId,
    name,
    folders,
    retryFolders,
    collections,
    retryCollections,
    isUsable,
    choose,
    pending: pendingId !== null,
  };
}
