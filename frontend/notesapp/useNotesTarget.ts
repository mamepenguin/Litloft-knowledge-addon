"use client";

import { useCallback, useMemo, useState } from "react";

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

/**
 * The Notes app's target: every active note of the drive, a collection, or a
 * Smart Collection. One that is gone, cannot be resolved, or whose members
 * cannot be evaluated is ignored while its saved id stays, as the other apps do.
 */
export function useNotesTarget(drive: string): NotesTargetState {
  const [held, setHeld] = useState(() => ({ drive, id: readAppTarget(drive, NOTES_APP) }));
  let savedId = held.id;
  if (held.drive !== drive) {
    savedId = readAppTarget(drive, NOTES_APP);
    setHeld({ drive, id: savedId });
  }

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

  const { evaluation } = useMemberTarget(drive, listedFolder, resolved.member);
  const unusableMember = evaluation?.status === "failed" || evaluation?.status === "tooLarge";
  const evaluating = resolved.member !== null && !resolved.empty && evaluation === null;
  const lookingUpList =
    (saved.kind === "smart" && isListing(folders)) ||
    (saved.kind === "collection" && isListing(collections));

  const unavailableId = unusableMember && resolved.folder !== null ? resolved.folder.id : null;
  const fileIds = evaluation?.status === "ready" ? evaluation.fileIds : null;

  const target = useMemo<NotesTarget>(() => {
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
  }, [lookingUpList, evaluating, unusableMember, resolved, fileIds]);

  const inForce = unusableMember ? null : resolved;
  const selectedId =
    inForce?.collection != null
      ? collectionTargetId(inForce.collection.id)
      : (inForce?.folder?.id ?? "default");
  const name = inForce?.collection?.name ?? inForce?.folder?.name ?? null;

  const isUsable = useCallback(
    (candidate: SmartFolder) =>
      candidate.id !== unavailableId &&
      (resolveAppTarget(candidate, NOTES_BASE_KINDS).usable ||
        resolveMemberTarget(candidate, NOTES_BASE_KINDS) !== null),
    [unavailableId],
  );

  const choose = useCallback(
    (id: string) => {
      writeAppTarget(drive, NOTES_APP, id);
      setHeld({ drive, id });
    },
    [drive],
  );

  return {
    target,
    known: !lookingUpList,
    selectedId,
    name,
    folders,
    retryFolders,
    collections,
    retryCollections,
    isUsable,
    choose,
  };
}
