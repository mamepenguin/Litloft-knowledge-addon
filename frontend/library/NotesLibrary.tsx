"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { buildCanonicalFileUrl } from "@/lib/canonicalFileUrl";
import { readTargetView, writeTargetView, type TargetView } from "@/lib/appPrefs";
import type { FileItem } from "@/types";

import { registerChangeGate } from "../notesapp/changeGate";
import { NOTES_APP, type NotesTarget } from "../notesapp/useNotesTarget";
import { useNoteClock } from "../useNoteClock";
import { useNoteOpenings } from "../useNoteOpenings";
import { LibraryList, SortMenu } from "./LibraryList";
import { LibraryRail, LibraryRailMenu } from "./LibraryRail";
import {
  hasConflictingSelection,
  isLibrarySort,
  isSegment,
  legacySegment,
  libraryHref,
  readLibraryParams,
  segmentOf,
  selectionOf,
  type LibraryChange,
  type LibrarySort,
  type Segment,
  type Selection,
} from "./libraryUrl";
import NotePaneContainer, { type PaneGate } from "./pane/NotePaneContainer";
import { PaneError, PaneSkeleton, type PaneMode } from "./pane/NotePanePresenter";
import { railItems } from "./railModel";
import { resolveShownNote, useNoteCheck } from "./shownNote";
import { useLibraryLayout } from "./useLibraryLayout";
import { useNotesList } from "./useNotesList";
import { useRailEntries } from "./useRailEntries";
import type { EditorSaveHandle } from "../editorSaveHandle";

export interface NotesLibraryProps {
  drive: string;
  target: NotesTarget;
  /** The scope line's total; `null` while it is unknown. */
  total: number | null;
  /** The Target in force, as its view is saved. */
  targetId?: string;
  /** A Target change is in flight: the URL still names the previous Target's sort. */
  ignoreUrlSort?: boolean;
  /** The Target was just applied from the URL: its view replaces what the URL names. */
  targetChanged?: boolean;
}

interface ChosenView {
  drive: string;
  targetId: string;
  view: TargetView;
}

export default function NotesLibrary({
  drive,
  target,
  total,
  targetId = "default",
  ignoreUrlSort = false,
  targetChanged = false,
}: NotesLibraryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const now = useNoteClock();
  const layout = useLibraryLayout();

  // The router object is not part of what a navigation depends on: a caller
  // that hands back a new one on every render must not re-run the effects.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  const storedView = readTargetView(NOTES_APP, drive, targetId);
  const [chosen, setChosen] = useState<ChosenView | null>(null);
  const heldView =
    chosen !== null && chosen.drive === drive && chosen.targetId === targetId
      ? { ...storedView, ...chosen.view }
      : storedView;
  const rawSort = searchParams.get("sort");
  const sort: LibrarySort =
    !ignoreUrlSort && !targetChanged && isLibrarySort(rawSort)
      ? rawSort
      : isLibrarySort(heldView.sort)
        ? heldView.sort
        : "updated";

  const params = readLibraryParams(searchParams, sort);
  const selection = selectionOf(params);
  const segment = segmentOf(
    params,
    isSegment(heldView.group) ? heldView.group : ((targetId === "default" ? legacySegment(drive) : null) ?? "folder"),
  );

  const ready = target.status === "ready" ? target : null;
  const [refresh, setRefresh] = useState(0);
  const onSaved = useCallback(() => setRefresh((n) => n + 1), []);

  const rail = useRailEntries(drive, ready, segment, refresh);
  const list = useNotesList(drive, ready, selection, sort, params.q, refresh);
  const rowIds = useMemo(() => list.rows.map((row) => row.id), [list.rows]);
  const openings = useNoteOpenings(drive, rowIds);

  const paneDrawn = layout === "three" || layout === "menu";
  const [paneMode, setPaneMode] = useState<PaneMode>("reading");
  const paneBusy = paneMode !== "reading";
  const { check, retry: retryCheck } = useNoteCheck(
    drive,
    paneDrawn ? params.note : null,
    rowIds,
    list.phase,
    paneDrawn,
  );
  const shown = paneDrawn
    ? resolveShownNote(params.note, rowIds, list.phase, check)
    : ({ kind: "none", removeNote: false } as const);

  const latest = useRef({ pathname, searchParams, sort });
  useEffect(() => {
    latest.current = { pathname, searchParams, sort };
  });
  const navigate = useCallback(
    (change: LibraryChange, how: "push" | "replace") => {
      const { pathname: path, searchParams: current, sort: currentSort } = latest.current;
      routerRef.current[how](libraryHref(path, new URLSearchParams(current), change, currentSort));
    },
    [],
  );

  const saveView = useCallback(
    (change: TargetView) => {
      writeTargetView(NOTES_APP, drive, targetId, change);
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

  // Placed before the note replacements below: each of those names the sort
  // too, and running later keeps the note it writes.
  const fillHref =
    ready !== null &&
    !ignoreUrlSort &&
    (targetChanged || !isLibrarySort(rawSort) || searchParams.has("target"))
      ? libraryHref(
          pathname,
          new URLSearchParams(searchParams),
          targetChanged ? { note: null } : {},
          sort,
        )
      : null;
  useEffect(() => {
    if (fillHref !== null) routerRef.current.replace(fillHref);
  }, [fillHref]);

  // A note the URL names that the target or the notes do not hold is replaced
  // by the first row, or dropped when there is none.
  const setNote = shown.kind === "show" ? shown.setNote : null;
  const removeNote = shown.kind === "none" && shown.removeNote;
  // The note this page put in the URL itself; the viewer did not choose it.
  const [replacement, setReplacement] = useState<string | null>(null);
  useEffect(() => {
    if (setNote !== null) {
      setReplacement(setNote);
      navigate({ note: setNote }, "replace");
    } else if (removeNote) navigate({ note: null }, "replace");
  }, [setNote, removeNote, navigate]);

  const conflicting = hasConflictingSelection(searchParams);
  useEffect(() => {
    if (conflicting) navigate({ folder: null }, "replace");
  }, [conflicting, navigate]);

  const saveHandle = useRef<EditorSaveHandle | null>(null);
  const gateRef = useRef<PaneGate | null>(null);
  const gate = useCallback<PaneGate>((proceed) => {
    if (gateRef.current === null) proceed();
    else gateRef.current(proceed);
  }, []);
  useEffect(() => registerChangeGate(gate), [gate]);

  const chooseSegment = (next: Segment) => {
    if (next === segment) {
      saveView({ group: next });
      return;
    }
    gate(() => {
      saveView({ group: next });
      navigate({ folder: null, tag: null, note: null }, "push");
    });
  };
  const select = (next: Selection) =>
    gate(() =>
      navigate(
        {
          folder: next.kind === "folder" ? next.path : null,
          tag: next.kind === "tag" ? next.name : null,
          note: null,
        },
        "push",
      ),
    );
  const search = (q: string) => {
    if (q === params.q) return;
    gate(() => navigate({ q, note: null }, "push"));
  };
  const sortBy = (next: LibrarySort) => {
    gate(() => {
      saveView({ sort: next });
      if (latest.current.searchParams.get("sort") !== next) navigate({ sort: next, note: null }, "push");
    });
  };

  const shownId = shown.kind === "show" ? shown.id : null;
  const [heldId, setHeldId] = useState<string | null>(null);
  useEffect(() => {
    if (paneDrawn && shownId !== null) setHeldId(shownId);
  }, [paneDrawn, shownId]);
  const paneId = paneDrawn ? shownId : paneBusy ? heldId : null;
  const paneVisible = paneDrawn || (paneBusy && paneId !== null);
  const narrowEditing = !paneDrawn && paneVisible;

  const choose = (file: FileItem): boolean => {
    if (!paneDrawn) return false;
    if (replacement === file.id) setReplacement(null);
    if (file.id !== shownId) gate(() => navigate({ note: file.id }, "replace"));
    else if (file.id !== params.note) navigate({ note: file.id }, "replace");
    return true;
  };

  if (ready === null) return null;

  const railProps = {
    segment,
    items: railItems({
      segment,
      entries: rail.data?.entries ?? null,
      railFailed: rail.phase === "failed" && rail.data === null,
      selection,
      allTotal: total,
      listTotal: list.total,
      listPhase: list.phase,
    }),
    loading: rail.phase === "loading" && rail.data === null,
    failed: rail.phase === "failed" || rail.data?.partial === true,
    onSegment: chooseSegment,
    onSelect: select,
    onRetry: rail.retry,
  };

  const pane =
    !paneVisible ? null : paneId !== null ? (
      <NotePaneContainer
        key={paneId}
        drive={drive}
        noteId={paneId}
        saveHandle={saveHandle}
        gateRef={gateRef}
        onModeChange={setPaneMode}
        onSaved={onSaved}
        recordView={params.note === paneId && replacement !== paneId}
      />
    ) : shown.kind === "error" ? (
      <PaneError onRetry={retryCheck} />
    ) : shown.kind === "pending" ? (
      <PaneSkeleton />
    ) : null;

  return (
    <div
      data-testid="notes-library"
      data-layout={layout ?? "unknown"}
      className={`flex min-w-0 ${layout === "three" ? "flex-row pt-2.25" : "flex-col gap-3 pt-3 max-sm:pt-2"}`}
    >
      {layout === "three" ? (
        <aside className="w-[220px] shrink-0 pr-4">
          <LibraryRail {...railProps} />
        </aside>
      ) : (
        <div
          className={
            narrowEditing ? "hidden" : layout === "list" ? "flex items-center gap-2" : "px-3"
          }
        >
          <div className="min-w-0 flex-1">
            <LibraryRailMenu {...railProps} short={layout === "list"} />
          </div>
          {layout === "list" && <SortMenu sort={sort} onSort={sortBy} />}
        </div>
      )}
      <div className="flex min-w-0 flex-1">
        <div
          className={
            narrowEditing
              ? "hidden"
              : paneDrawn
                ? "w-[360px] min-w-[340px] max-w-[380px] shrink-0 border-x border-bg-border"
                : "-mx-4 min-w-0 flex-1"
          }
        >
          <LibraryList
            phone={layout === "list"}
            rows={list.rows}
            openings={openings.text}
            phase={list.phase}
            more={list.more}
            hasMore={list.hasMore}
            selection={selection}
            query={params.q}
            sort={sort}
            selectedId={paneDrawn ? shownId : null}
            now={now}
            hrefFor={(file) => buildCanonicalFileUrl(file, file.id)}
            onChoose={choose}
            onSearch={search}
            onSort={sortBy}
            onLoadMore={list.loadMore}
            onRetry={list.retry}
          />
        </div>
        {pane !== null && <div className={`min-w-0 flex-1 ${paneDrawn ? "pl-10" : ""}`}>{pane}</div>}
      </div>
    </div>
  );
}
