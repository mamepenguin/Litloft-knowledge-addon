"use client";

import { useEffect, useMemo, useRef, type MouseEvent } from "react";
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

import { hasChangeGate, runGated } from "./notesapp/changeGate";
import Home from "./notesapp/Home";
import { listNotes } from "./notesapp/listing";
import { SkeletonRows } from "./notesapp/Skeleton";
import { NOTES_APP, NOTES_BASE_KINDS, useNotesTarget } from "./notesapp/useNotesTarget";
import NotesLibrary from "./library/NotesLibrary";
import { libraryHref } from "./library/libraryUrl";

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

  // A Target change keeps the selection and drops the note. It is kept here,
  // not in the Library, because the Library is unmounted while a target is
  // being looked up and would not see the change.
  const targetKey = target.status === "ready" ? target.key : null;
  const lastTargetKey = useRef<string | null>(null);
  const latest = useRef({ pathname, searchParams });
  useEffect(() => {
    latest.current = { pathname, searchParams };
  });
  useEffect(() => {
    if (targetKey === null) return;
    const changed = lastTargetKey.current !== null && lastTargetKey.current !== targetKey;
    lastTargetKey.current = targetKey;
    const { pathname: path, searchParams: current } = latest.current;
    if (changed && current.has("note")) {
      router.replace(libraryHref(path, new URLSearchParams(current), { note: null }));
    }
  }, [targetKey, router]);

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
      <NotesLibrary drive={drive} target={target} total={count} />
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
          actions={
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
            onChoose: (id) => runGated(() => notesTarget.choose(id)),
            onRetryFolders: notesTarget.retryFolders,
          }}
        />
      }
    >
      <div id={PANEL_ID} className="px-4 pb-10 pt-6">
        {body}
      </div>
    </PageFrame>
  );
}
