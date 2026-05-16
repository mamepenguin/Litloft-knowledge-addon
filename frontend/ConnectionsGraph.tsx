"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";

import {
  getConnectionsGraph,
  type ConnectionsGraphResponse,
} from "./api";
import {
  useGraphPanZoom,
  PAN_ZOOM_VIEWBOX,
} from "./graph/useGraphPanZoom";
import { useGraphLayout } from "./graph/useGraphLayout";
import { buildPalette, type ColorBy } from "./graph/graphPalette";
import { bfsScope } from "./graph/graphGeometry";
import { EdgeLayer, NodeLayer } from "./graph/GraphLayers";
import {
  GraphToolbar,
  GraphFocusBanner,
  ZoomButton,
} from "./graph/GraphControls";
import { GraphDetailCard, GraphOrphanPanel } from "./graph/GraphPanels";

// ---- Component -------------------------------------------------------

// Above this node count the full graph is hard to read; we nudge the
// user toward focus mode instead of hard-capping.
const TOO_BIG_THRESHOLD = 200;

interface Props {
  drive: string;
}

export default function ConnectionsGraph({ drive }: Props) {
  const t = useTranslations("knowledge.connections");
  const router = useRouter();

  const [open, setOpen] = useState(true);
  const [data, setData] = useState<ConnectionsGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    getConnectionsGraph(drive)
      .then((d) => setData(d))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [drive]);

  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];

  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    nodes.forEach((n) => m.set(n.id, new Set()));
    edges.forEach((e) => {
      m.get(e.a)?.add(e.b);
      m.get(e.b)?.add(e.a);
    });
    return m;
  }, [nodes, edges]);

  const nodeById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes],
  );

  // ----- Interactions ------------------------------------------------
  const [colorBy, setColorBy] = useState<ColorBy>("kind");
  const palette = useMemo(() => buildPalette(nodes, colorBy), [nodes, colorBy]);

  const [searchQuery, setSearchQuery] = useState("");
  // Debounce so the sub-graph layout doesn't recompute on every
  // keystroke (each change re-runs the force sim + re-fits).
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 220);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const matchedIds = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return new Set<string>();
    const hits = new Set<string>();
    for (const n of nodes) {
      if (
        n.title.toLowerCase().includes(q) ||
        n.path.toLowerCase().includes(q) ||
        n.tags.some((tag) => tag.toLowerCase().includes(q))
      ) {
        hits.add(n.id);
      }
    }
    return hits;
  }, [nodes, debouncedQuery]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [depth, setDepth] = useState(2);

  const focusScope = useMemo(() => {
    if (!focusedId) return null;
    return bfsScope(adjacency, focusedId, depth);
  }, [focusedId, depth, adjacency]);

  // The set of node ids actually rendered. Search and focus both
  // *filter* the graph (hide everything outside the set) rather than
  // merely dimming — that is what "絞り込み / 注目モード" means.
  //
  // Precedence: focus (explicit) > search (transient) > everything.
  // Search visibility = matched nodes plus their direct neighbours, so
  // a hit keeps the one hop of context that makes it legible.
  const visibleIds = useMemo<Set<string> | null>(() => {
    if (focusScope) return focusScope;
    if (matchedIds.size > 0) {
      const v = new Set<string>(matchedIds);
      for (const id of matchedIds) {
        adjacency.get(id)?.forEach((n) => v.add(n));
      }
      return v;
    }
    return null; // null = show all
  }, [focusScope, matchedIds, adjacency]);

  // When a filter is active we recompute the layout for *only* the
  // visible subgraph. Keeping original coordinates and hiding the rest
  // leaves the survivors scattered far apart; re-running the force sim
  // on the subset packs them into a readable cluster (this is what
  // Obsidian's local graph does).
  const activeNodes = useMemo(
    () =>
      visibleIds === null
        ? nodes
        : nodes.filter((n) => visibleIds.has(n.id)),
    [nodes, visibleIds],
  );
  const activeEdges = useMemo(
    () =>
      visibleIds === null
        ? edges
        : edges.filter(
            (e) => visibleIds.has(e.a) && visibleIds.has(e.b),
          ),
    [edges, visibleIds],
  );

  const layout = useGraphLayout(
    activeNodes,
    activeEdges,
    PAN_ZOOM_VIEWBOX.width,
    PAN_ZOOM_VIEWBOX.height,
  );

  const [orphansOpen, setOrphansOpen] = useState(false);

  const panZoom = useGraphPanZoom();
  const { state: pz, attachRef, didDragRef, downTargetRef } = panZoom;

  // Auto-fit the *active* bbox into the viewport whenever the rendered
  // node set changes — initial load, refresh that adds nodes, and every
  // time a filter / focus narrows or widens the subgraph.
  const fitKey = useMemo(
    () => activeNodes.map((n) => n.id).join("|"),
    [activeNodes],
  );
  const didFitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeNodes.length || layout.size === 0) return;
    if (didFitRef.current === fitKey) return;
    didFitRef.current = fitKey;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of activeNodes) {
      const p = layout.get(n.id);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (minX === Infinity) return;
    panZoom.fitToBounds(minX, minY, maxX, maxY, 80);
  }, [activeNodes, layout, fitKey, panZoom]);

  const handleSvgPointerUp = useCallback(() => {
    if (didDragRef.current) return;
    const target = downTargetRef.current;
    const nodeEl = target
      ? (target as Element).closest("[data-node-id]")
      : null;
    if (nodeEl) {
      const id = nodeEl.getAttribute("data-node-id");
      if (id) setSelectedId(id);
    } else {
      setSelectedId(null);
    }
  }, [didDragRef, downTargetRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (focusedId) setFocusedId(null);
        else if (selectedId) setSelectedId(null);
      } else if (e.key === "+" || e.key === "=") {
        panZoom.zoomIn();
      } else if (e.key === "-") {
        panZoom.zoomOut();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedId, selectedId, panZoom]);

  const selectedNode = selectedId ? nodeById.get(selectedId) : null;

  const onOpenSelected = useCallback(() => {
    if (!selectedNode) return;
    router.push(`/files/${selectedNode.id}`);
  }, [router, selectedNode]);

  const onCenterSelected = useCallback(() => {
    if (!selectedId) return;
    setFocusedId(selectedId);
  }, [selectedId]);

  const onResetFocus = useCallback(() => setFocusedId(null), []);

  const hasGraph = !loading && !error && nodes.length > 0;
  const hasAnyContent =
    !loading &&
    !error &&
    (nodes.length > 0 || (data?.orphan_count ?? 0) > 0);

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-left"
        aria-expanded={open}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {t("title")}
        </p>
        {open ? (
          <ChevronDown size={11} strokeWidth={2} className="text-text-muted" />
        ) : (
          <ChevronRight size={11} strokeWidth={2} className="text-text-muted" />
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-3">
          {loading && (
            <div className="h-16 animate-pulse rounded-2xl bg-bg-elevated" />
          )}
          {error && (
            <p className="text-xs text-danger" role="alert">
              {t("loadFailed")}: {error}
            </p>
          )}
          {!loading && !error && !hasAnyContent && (
            <p className="text-xs text-text-muted">{t("emptyGraph")}</p>
          )}

          {hasGraph && (
            <>
              <GraphToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                colorBy={colorBy}
                onColorByChange={setColorBy}
                t={t}
              />

              {focusedId && (
                <GraphFocusBanner
                  title={nodeById.get(focusedId)?.title ?? ""}
                  depth={depth}
                  onDepthChange={setDepth}
                  onReset={onResetFocus}
                  t={t}
                />
              )}

              {nodes.length > TOO_BIG_THRESHOLD && !focusedId && (
                <p className="rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 text-xs text-accent-amber">
                  {t("stats.tooBigWarning")}
                </p>
              )}

              <div className="relative overflow-hidden rounded-2xl border border-bg-border bg-bg-card">
                <svg
                  ref={attachRef}
                  viewBox={`0 0 ${PAN_ZOOM_VIEWBOX.width} ${PAN_ZOOM_VIEWBOX.height}`}
                  className="block h-[420px] w-full select-none md:h-[560px]"
                  style={{ touchAction: "none", cursor: "grab" }}
                  preserveAspectRatio="xMidYMid meet"
                  onPointerUp={handleSvgPointerUp}
                >
                  <g
                    transform={`translate(${pz.tx} ${pz.ty}) scale(${pz.scale})`}
                  >
                    <EdgeLayer
                      edges={activeEdges}
                      layout={layout}
                      selectedId={selectedId}
                    />
                    <NodeLayer
                      nodes={activeNodes}
                      layout={layout}
                      palette={palette}
                      selectedId={selectedId}
                      focusedId={focusedId}
                      filtered={visibleIds !== null}
                      matchedIds={matchedIds}
                      scale={pz.scale}
                    />
                  </g>
                </svg>

                <div className="absolute right-3 bottom-3 flex flex-col gap-1">
                  <ZoomButton onClick={panZoom.zoomIn} title={t("zoom.in")}>
                    <ZoomIn size={14} strokeWidth={1.8} />
                  </ZoomButton>
                  <ZoomButton onClick={panZoom.zoomOut} title={t("zoom.out")}>
                    <ZoomOut size={14} strokeWidth={1.8} />
                  </ZoomButton>
                  <ZoomButton onClick={panZoom.reset} title={t("zoom.reset")}>
                    <RotateCcw size={14} strokeWidth={1.8} />
                  </ZoomButton>
                </div>

                <div className="absolute left-3 bottom-3 rounded-lg border border-bg-border bg-bg-elevated px-2.5 py-1 text-[10px] tabular-nums text-text-muted">
                  {Math.round(pz.scale * 100)}%
                </div>

                {selectedNode && (
                  <GraphDetailCard
                    node={selectedNode}
                    edges={edges}
                    onCenter={onCenterSelected}
                    onOpen={onOpenSelected}
                    t={t}
                  />
                )}
              </div>

              <div className="flex items-center gap-3 px-1 text-[11px] text-text-muted">
                <span>{t("stats.nodes", { count: nodes.length })}</span>
                <span>{t("stats.edges", { count: edges.length })}</span>
              </div>
            </>
          )}

          {!loading && !error && (data?.orphan_count ?? 0) > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setOrphansOpen((v) => !v)}
                className="self-start text-xs text-accent hover:underline"
              >
                {orphansOpen
                  ? t("orphans.hide")
                  : t("orphans.show", { count: data?.orphan_count ?? 0 })}
              </button>
              {orphansOpen && data && (
                <GraphOrphanPanel
                  orphans={data.orphans}
                  orphanCount={data.orphan_count}
                  t={t}
                />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
