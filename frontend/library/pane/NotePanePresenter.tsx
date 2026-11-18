"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, Pencil, ArrowUpRight } from "lucide-react";

import type { LoadState } from "@/components/appshell/useLoad";
import type { FileRelationItem } from "@/lib/api";

import type { NoteSource } from "../../notesapp/sourcesApi";
import { Connections } from "./Connections";

export type PaneMode = "reading" | "editing" | "waiting";

export interface PaneNote {
  title: string;
  folder: string;
  /** Already formatted for the viewer's locale. */
  updated: string;
  tags: string[];
}

export interface NotePanePresenterProps {
  drive: string;
  mode: PaneMode;
  phase: "loading" | "error" | "ready";
  note: PaneNote | null;
  /** The rendered body of the note. */
  body: ReactNode;
  /** The mounted editor; only drawn while `mode` is not `reading`. */
  editor: ReactNode;
  canEdit: boolean;
  saveText: string;
  fileHref: string;
  graphHref: string;
  relations: LoadState<FileRelationItem[]>;
  sources: LoadState<NoteSource[]>;
  onEdit: () => void;
  onDone: () => void;
  onRetry: () => void;
  onOpenFile: (e: MouseEvent<HTMLAnchorElement>) => void;
}

const PILL =
  "inline-flex h-[34px] items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring pointer-coarse:min-h-11";

export function PaneSkeleton() {
  return (
    <div aria-hidden="true" data-testid="pane-skeleton" className="flex max-w-[680px] flex-col gap-3 pt-8">
      <div className="h-8 w-2/3 animate-pulse rounded-lg bg-bg-elevated" />
      <div className="h-4 w-full animate-pulse rounded-lg bg-bg-elevated" />
      <div className="h-4 w-full animate-pulse rounded-lg bg-bg-elevated" />
      <div className="h-4 w-3/4 animate-pulse rounded-lg bg-bg-elevated" />
    </div>
  );
}

export function PaneError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("knowledge.notesLibrary");
  return (
    <div role="alert" className="flex flex-col items-start gap-3 pt-8">
      <p className="text-sm text-text-primary">{t("loadFailedNote")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-2xl border border-bg-border px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring pointer-coarse:min-h-11"
      >
        {t("retry")}
      </button>
    </div>
  );
}

function OpenFileLink({ href, onClick }: { href: string; onClick: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  const t = useTranslations("knowledge.notesLibrary");
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={t("openFile")}
      title={t("openFile")}
      className="inline-flex size-[34px] items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring pointer-coarse:size-11"
    >
      <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden="true" />
    </Link>
  );
}

export default function NotePanePresenter(props: NotePanePresenterProps) {
  const t = useTranslations("knowledge.notesLibrary");
  const { mode, phase, note } = props;

  if (phase === "loading") return <PaneSkeleton />;
  if (phase === "error" || note === null) return <PaneError onRetry={props.onRetry} />;

  if (mode !== "reading") {
    return (
      <article aria-label={t("paneLabel")} className="flex min-w-0 flex-col">
        <div className="flex items-center justify-end gap-3">
          <span role="status" aria-live="polite" className="text-xs text-text-muted">
            {props.saveText}
          </span>
          <button
            type="button"
            onClick={props.onDone}
            disabled={mode === "waiting"}
            className={`${PILL} bg-text-primary text-bg-primary hover:opacity-90 disabled:opacity-60`}
          >
            <Check size={14} strokeWidth={2} aria-hidden="true" />
            {t("done")}
          </button>
          <OpenFileLink href={props.fileHref} onClick={props.onOpenFile} />
        </div>
        <div
          inert={mode === "waiting"}
          aria-busy={mode === "waiting"}
          className="mt-4 flex h-[calc(100dvh-16rem)] min-h-[24rem] min-w-0 flex-col"
        >
          {props.editor}
        </div>
      </article>
    );
  }

  return (
    <article aria-label={t("paneLabel")} className="flex min-w-0 flex-col">
      <div className="flex items-center justify-end gap-2">
        {props.canEdit && (
          <button
            type="button"
            onClick={props.onEdit}
            className={`${PILL} bg-sand text-text-primary hover:bg-sand-hover`}
          >
            <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />
            {t("edit")}
          </button>
        )}
        <OpenFileLink href={props.fileHref} onClick={props.onOpenFile} />
      </div>
      <div className="max-w-[680px]">
        <h2 className="mt-1 text-[28px] font-bold leading-[1.35] text-text-primary [overflow-wrap:anywhere]">
          {note.title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
          <span>{note.folder}</span>
          <span aria-hidden="true" className="opacity-40">
            ·
          </span>
          <span>{note.updated}</span>
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-[22px] items-center rounded-full bg-accent-teal/15 px-2 text-xs text-accent-teal"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="mt-6">{props.body}</div>
        <Connections
          drive={props.drive}
          relations={props.relations}
          sources={props.sources}
          graphHref={props.graphHref}
        />
      </div>
    </article>
  );
}
