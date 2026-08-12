/**
 * React binding for the connections-graph force layout.
 *
 * The simulation itself lives in forceLayout.ts — a pure module with no
 * React and no DOM, so it can be benchmarked directly and, if it ever
 * needs to, moved off the main thread.
 *
 * It runs synchronously, inside a useMemo. That was the cause of the
 * page-wide freeze this work started from: at 1,000 nodes the O(N²)
 * repulsion took ~489 ms and React cannot paint until render returns.
 * Barnes-Hut brought that down far enough that the synchronous cost is
 * no longer perceptible (see forceLayout.ts).
 *
 * A Web Worker was implemented and then removed. Turbopack resolves
 * `new Worker(new URL("./x.worker.ts", import.meta.url))` as a *static
 * asset*: it copied the TypeScript source verbatim into
 * `_next/static/media/` and served it as `video/mp2t`, so the worker
 * silently never loaded and the graph rendered empty. This is the
 * known-incomplete `import.meta.url` support in Turbopack
 * (vercel/next.js#62650). Do not reintroduce that pattern without
 * checking the emitted asset; with the layout now fast, the complexity
 * would not pay for itself anyway.
 */
import { useMemo } from "react";

import type { GraphEdge, GraphNode } from "../api";
import { forceLayout, type ForceLayoutInput } from "./forceLayout";

export interface NodePosition {
  x: number;
  y: number;
}

export type LayoutMap = Map<string, NodePosition>;

function buildInput(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
): ForceLayoutInput {
  const ids = nodes.map((n) => n.id);
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const pairs: number[] = [];
  for (const e of edges) {
    const ia = index.get(e.a);
    const ib = index.get(e.b);
    if (ia === undefined || ib === undefined) continue;
    pairs.push(ia, ib);
  }
  return { ids, edges: Int32Array.from(pairs), width, height };
}

function toMap(ids: string[], positions: Float32Array): LayoutMap {
  const m: LayoutMap = new Map();
  for (let i = 0; i < ids.length; i++) {
    m.set(ids[i], { x: positions[i * 2], y: positions[i * 2 + 1] });
  }
  return m;
}

export function useGraphLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width = 1100,
  height = 620,
): LayoutMap {
  // Re-run only when node ids change (sparse graph; layout is stable).
  const key = useMemo(
    () => nodes.map((n) => n.id).join("|") + "::" + edges.length,
    [nodes, edges.length],
  );
  const input = useMemo(
    () => buildInput(nodes, edges, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, width, height],
  );
  return useMemo(() => toMap(input.ids, forceLayout(input)), [input]);
}
