"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Crosshair, Unlink } from "lucide-react";
import type { GraphEdge, GraphNode, GraphOrphan } from "../api";

type T = ReturnType<typeof useTranslations>;

export function GraphDetailCard({
  node,
  edges,
  onCenter,
  onOpen,
  t,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  onCenter: () => void;
  onOpen: () => void;
  t: T;
}) {
  const inEdges = edges.filter((e) => e.a === node.id || e.b === node.id);
  const noteCount = inEdges.filter((e) => e.kind === "note_source").length;
  const relCount = inEdges.filter((e) => e.kind === "related").length;
  return (
    <div className="pointer-events-auto absolute right-3 top-3 w-64 rounded-2xl border border-bg-border bg-bg-elevated p-3 text-xs shadow-lg">
      <p className="mb-1 text-sm font-semibold text-text-primary break-words">
        {node.title}
      </p>
      <p className="mb-2 font-mono text-[10px] text-text-dim break-all">
        {node.path}
      </p>
      {node.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {node.tags.slice(0, 6).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-bg-border bg-bg-card px-2 py-0.5 text-[10px] text-text-muted"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
      <p className="mb-3 text-text-muted">
        {t("detail.folderLabel")}:{" "}
        <span className="text-text-primary">{node.folder || "(root)"}</span>
        <br />
        {t("detail.connectionsLabel")}:{" "}
        <span className="text-text-primary">{inEdges.length}</span>{" "}
        ({relCount} related / {noteCount} note→source)
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onCenter}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium hover:opacity-90"
          style={{ backgroundColor: "#60a5fa", color: "#0a0a0a" }}
        >
          <Crosshair size={12} strokeWidth={2} />
          {t("focus.centerHere")}
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 rounded-lg border border-bg-border bg-bg-card px-2.5 py-1.5 text-[11px] text-text-primary hover:bg-bg-border"
        >
          {t("detail.open")}
        </button>
      </div>
    </div>
  );
}

export function GraphOrphanPanel({
  orphans,
  orphanCount,
  t,
}: {
  orphans: GraphOrphan[];
  orphanCount: number;
  t: T;
}) {
  const router = useRouter();
  return (
    <div className="rounded-2xl border border-dashed border-bg-border bg-bg-card/40 p-3.5">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {t("orphans.heading", { count: orphanCount })}
      </p>
      {orphans.length === 0 ? (
        <p className="text-[11px] text-text-muted">{t("orphans.empty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" role="list">
          {orphans.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => router.push(`/files/${o.id}`)}
                className="inline-flex items-center gap-1.5 rounded-full border border-bg-border bg-bg-elevated px-2.5 py-1 text-[11px] text-text-muted hover:text-text-primary"
                title={o.path}
              >
                <Unlink size={10} strokeWidth={1.8} />
                {o.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
