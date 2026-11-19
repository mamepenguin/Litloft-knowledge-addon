"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FilePlus, NotebookPen } from "lucide-react";

import { AppHeader } from "@/components/appshell/AppHeader";
import { useLoad } from "@/components/appshell/useLoad";
import { Button } from "@/components/Button";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { EmptyState } from "@/components/EmptyState";
import { PageFrame } from "@/components/PageFrame";
import { PageTabs } from "@/components/PageTabs";
import { useQuickNote } from "@/components/quick-note";
import { readTargetView } from "@/lib/appPrefs";

import { hasChangeGate, runGated } from "./notesapp/changeGate";
import Home from "./notesapp/Home";
import { listNotes } from "./notesapp/listing";
import { SkeletonRows } from "./notesapp/Skeleton";
import { NOTES_APP, NOTES_BASE_KINDS, useNotesTarget } from "./notesapp/useNotesTarget";
import NotesLibrary from "./library/NotesLibrary";
import { isLibrarySort, libraryHref, type LibrarySort } from "./library/libraryUrl";

const PANEL_ID = "notes-app-panel";

export default function NotesPage() {
  const drive = useCurrentDrive() ?? "";
  const t = useTranslations("knowledge.notesApp");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const quickNote = useQuickNote();
  const library = searchParams.get("view") === "all";
  const folder = searchParams.get("folder");

  const notesTarget = useNotesTarget(drive);
  const { target } = notesTarget;
  const targetId = target.status === "ready" ? notesTarget.selectedId : null;
  // The URL a Target was chosen on, until the router shows the URL without its sort:
  // the replace lands after the new Target is already in force.
  const [switchedFrom, setSwitchedFrom] = useState<string | null>(null);
  const search = searchParams.toString();
  const switchPending = switchedFrom !== null && switchedFrom === search;
  useEffect(() => {
    if (switchedFrom !== null && !switchPending) setSwitchedFrom(null);
  }, [switchedFrom, switchPending]);

  // Kept here, not in the Library: the Library is unmounted while a Target is
  // being looked up and would not see the change.
  const lastTargetKey = useRef<string | null>(null);
  const latest = useRef({ pathname, searchParams, switchPending });
  useEffect(() => {
    latest.current = { pathname, searchParams, switchPending };
  });
  useEffect(() => {
    if (targetId === null) return;
    const previous = lastTargetKey.current;
    lastTargetKey.current = targetId;
    const { pathname: path, searchParams: current, switchPending: chosen } = latest.current;
    const inLibrary = current.get("view") === "all";
    const sortOf = (id: string): LibrarySort => {
      const stored = readTargetView(NOTES_APP, drive, id).sort;
      return isLibrarySort(stored) ? stored : "updated";
    };
    // A Target choice has already replaced the URL without its note.
    if (previous !== null && previous !== targetId && inLibrary && current.has("note") && !chosen) {
      const raw = current.get("sort");
      router.replace(
        libraryHref(path, new URLSearchParams(current), { note: null }, isLibrarySort(raw) ? raw : sortOf(targetId)),
      );
    }
  }, [targetId, router, drive]);

  // The scope line shows nothing but the drive until this has answered, so a
  // count that is loading or failed is never read as `0`.
  const loadCount = useMemo(
    () =>
      target.status === "ready"
        ? () => listNotes(drive, target, { limit: 1 }).then((page) => page.meta.total)
        : null,
    [drive, target],
  );
  const { state: counted } = useLoad(loadCount);
  const count = target.status === "empty" ? 0 : counted.status === "loaded" ? counted.data : null;

  const openNewNote = () =>
    quickNote.open(library && folder !== null ? { drive, folder } : { drive });

  // A tab is a link, so the page under it may hold the change back (an editor
  // that has to save first) by registering a gate.
  const onTabsClick = (event: MouseEvent) => {
    if (!hasChangeGate() || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const href = (event.target as HTMLElement).closest("a")?.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    event.stopPropagation();
    runGated(() => router.push(href));
  };

  const tabs = (
    <div onClickCapture={onTabsClick}>
      <PageTabs
        label={t("tabsLabel")}
        current={library ? "library" : "home"}
        wrap
        items={[
          { key: "home", label: t("home"), href: pathname },
          { key: "library", label: t("library"), href: `${pathname}?view=all` },
        ]}
      />
    </div>
  );

  let body;
  if (target.status === "lookingUp") {
    body = <SkeletonRows count={5} rowClass="h-[62px]" />;
  } else if (count === 0) {
    body = <EmptyState icon={NotebookPen} title={t("emptyTitle")} />;
  } else {
    body = library ? (
      <NotesLibrary
        drive={drive}
        target={target}
        total={count}
        targetId={notesTarget.selectedId}
        ignoreUrlSort={switchPending}
      />
    ) : (
      <Home drive={drive} target={target} />
    );
  }

  return (
    <PageFrame
      width="wide"
      header={
        <AppHeader
          drive={drive}
          icon={NotebookPen}
          title={t("title")}
          countDetail={count === null ? null : t("count", { count })}
          tabs={tabs}
          primaryAction={
            <Button variant="primary" onClick={openNewNote}>
              <FilePlus size={14} strokeWidth={1.8} />
              {t("newNote")}
            </Button>
          }
          target={{
            drive,
            app: NOTES_APP,
            name: notesTarget.known ? (notesTarget.name ?? t("allNotes")) : null,
            folders: notesTarget.folders,
            collections: { list: notesTarget.collections, retry: notesTarget.retryCollections },
            selectedId: notesTarget.selectedId,
            currentCount: count,
            label: t("target"),
            defaultLabel: t("allNotes"),
            unavailableLabel: t("unavailable"),
            defaultTargetTypes: NOTES_BASE_KINDS,
            defaultTargetExcludeOrigin: "webclip",
            isUsable: notesTarget.isUsable,
            onChoose: (id) => {
              if (id === notesTarget.selectedId) return;
              runGated(() => {
                const { pathname: path, searchParams: current } = latest.current;
                if (current.get("view") === "all") {
                  const next = new URLSearchParams(current);
                  next.delete("sort");
                  next.delete("note");
                  if (next.toString() !== current.toString()) {
                    setSwitchedFrom(current.toString());
                    router.replace(`${path}?${next}`);
                  }
                }
                notesTarget.choose(id);
              });
            },
            onRetryFolders: notesTarget.retryFolders,
          }}
        />
      }
    >
      <div id={PANEL_ID} className={`px-4 pb-10 ${library && target.status !== "lookingUp" && count !== 0 ? "pt-0" : "pt-6"}`}>
        {body}
      </div>
    </PageFrame>
  );
}
