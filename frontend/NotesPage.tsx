"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronLeft, ChevronRight, FilePlus, Link2, NotebookPen, Waypoints } from "lucide-react";

import { Button } from "@/components/Button";
import { useCurrentDrive } from "@/components/CurrentDriveProvider";
import { PageHeader } from "@/components/PageHeader";

import AllNotes from "./AllNotes";
import { readAllNotesScope } from "./allNotesParams";
import ClipSection from "./ClipSection";
import NoteResults from "./NoteResults";
import { ContinueWriting, FindNote, RecentNotes } from "./NotesLanding";
import { useNewNote } from "./useNewNote";

function Tile({
  icon,
  title,
  description,
  trailing,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  trailing: ReactNode;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-bg-elevated text-text-primary"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <span className="mt-0.5 text-[13px] text-text-muted">{description}</span>
      </span>
      {trailing}
    </>
  );
}

const TILE_CLASS =
  "flex w-full items-center gap-3.5 rounded-2xl border border-bg-border bg-bg-card p-4 transition-colors hover:bg-bg-elevated";

export default function NotesPage() {
  const drive = useCurrentDrive() ?? "";
  const t = useTranslations("knowledge.notes");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const query = searchParams.get("q")?.trim() ?? "";
  const showAll = searchParams.get("view") === "all";
  const allScope = readAllNotesScope(searchParams);
  // A bookmarklet landing submits the clip form on mount, so the form is
  // open from the start.
  const prefilled = Boolean(searchParams.get("prefill"));
  const [clipOpen, setClipOpen] = useState(prefilled);
  const [clipMounted, setClipMounted] = useState(prefilled);
  const clipRegionId = useId();
  const newNote = useNewNote({ drive });
  // One clock for the whole render, so every row agrees on what "today" is.
  const now = useMemo(() => new Date(), []);

  const inResults = Boolean(query) || showAll;

  const toggleClip = () => {
    setClipMounted(true);
    setClipOpen((open) => !open);
  };

  // Once mounted, one ClipSection for the page's lifetime: unmounting it
  // would re-run the bookmarklet's autosubmit on the way back and drop a clip
  // still being sent.
  const clipRegion = clipMounted ? (
    <div key="clip" id={clipRegionId} className={prefilled ? "mt-8" : "mt-6"} hidden={inResults || !clipOpen}>
      <ClipSection />
    </div>
  ) : null;

  const main = showAll ? (
    <div key="all" className="mt-6">
      <AllNotes drive={drive} scope={allScope} now={now} />
    </div>
  ) : query ? (
    <div key="results" className="mt-8">
      <NoteResults key={`q:${drive}:${query}`} drive={drive} now={now} query={query} />
    </div>
  ) : (
    <div key="landing" className="flex flex-col">
      <div className="mt-11 empty:hidden">
        <ContinueWriting drive={drive} />
      </div>
      <div className="mt-11">
        <RecentNotes drive={drive} now={now} />
      </div>
    </div>
  );

  const tools = (
    <div key="tools" className="mt-12 flex flex-col gap-3 border-t border-bg-border pt-7" hidden={inResults}>
      <h2 className="text-sm font-semibold text-text-muted">{t("toolsHeading")}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={TILE_CLASS}
          aria-expanded={clipOpen}
          aria-controls={clipMounted ? clipRegionId : undefined}
          onClick={toggleClip}
        >
          <Tile
            icon={<Link2 size={18} strokeWidth={1.8} />}
            title={t("clipTile")}
            description={t("clipTileDescription")}
            trailing={
              <ChevronDown
                size={18}
                aria-hidden="true"
                className={`shrink-0 text-warm-silver transition-transform ${clipOpen ? "rotate-180" : ""}`}
              />
            }
          />
        </button>
        <Link
          href={`/drive/${encodeURIComponent(drive)}/addons/knowledge/connections`}
          className={TILE_CLASS}
        >
          <Tile
            icon={<Waypoints size={18} strokeWidth={1.8} />}
            title={t("connections")}
            description={t("connectionsDescription")}
            trailing={<ChevronRight size={18} aria-hidden="true" className="shrink-0 text-warm-silver" />}
          />
        </Link>
      </div>
    </div>
  );

  const find = (
    <div key="find" className="mt-5">
      <FindNote initialQuery={query} />
    </div>
  );

  // Keyed siblings are reordered by React rather than remounted, so the
  // bookmarklet's clip section can lead without being a second instance.
  const leading = showAll ? [] : [find];
  const body = prefilled
    ? [...leading, clipRegion, main, tools]
    : [...leading, main, tools, clipRegion];

  return (
    <div className={`mx-auto flex w-full flex-col py-10 ${showAll ? "max-w-6xl" : "max-w-list-row"}`}>
      <PageHeader
        breadcrumb={
          showAll ? (
            <Link
              href={pathname}
              className="-ml-1 flex items-center gap-0.5 text-sm text-text-muted transition-colors hover:text-text-primary"
            >
              <ChevronLeft size={16} aria-hidden="true" />
              {t("heading")}
            </Link>
          ) : undefined
        }
        titleIcon={showAll ? undefined : NotebookPen}
        title={showAll ? t("all") : t("heading")}
        scope={t("description")}
        actions={
          newNote.available ? (
            <Button variant="primary" onClick={newNote.open}>
              <FilePlus size={14} strokeWidth={1.8} />
              {t("newNote")}
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col px-4">{body}</div>
      {newNote.dialog}
    </div>
  );
}
