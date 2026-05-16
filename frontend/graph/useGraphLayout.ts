/**
 * Lightweight force-directed layout for the connections graph.
 *
 * Runs a single deterministic simulation pass on mount and caches the
 * result. The output is a static position map keyed by node id. We do
 * not re-simulate on data changes — the graph is sparse and users
 * navigate via pan/zoom rather than expecting layout to react.
 *
 * Algorithm: O(N²) repulsion + O(E) attraction, 120 iterations with
 * cooling. For <500 nodes this finishes in ~30ms in modern browsers.
 *
 * Determinism: a seeded mulberry32 PRNG places initial positions, so
 * reloading the page yields the same layout (anti-jitter for users).
 */
import { useMemo } from "react";
import type { GraphEdge, GraphNode } from "../api";

export interface NodePosition {
  x: number;
  y: number;
}

export type LayoutMap = Map<string, NodePosition>;

// Tuned for sparse human-curated graphs (~10-200 nodes). Repulsion is
// strong enough to keep node circles + labels from overlapping; spring
// length sets the typical edge length; gravity keeps disconnected
// clusters from drifting to infinity.
const ITERATIONS = 160;
const REPULSION = 11000;
const SPRING_LENGTH = 100;
const SPRING_K = 0.055;
const CENTER_GRAVITY = 0.012;
const MAX_DISPLACEMENT = 40;

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(nodes: GraphNode[]): number {
  // Stable across reloads given the same node set; small drift when
  // nodes are added/removed (intentional — relayout when topology
  // changes is desirable).
  let h = 5381;
  for (const n of nodes) {
    for (let i = 0; i < n.id.length; i++) {
      h = ((h << 5) + h + n.id.charCodeAt(i)) | 0;
    }
  }
  return h;
}

export function computeForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width = 1100,
  height = 620,
): LayoutMap {
  if (nodes.length === 0) return new Map();

  const rng = mulberry32(hashSeed(nodes));
  const positions: { id: string; x: number; y: number; vx: number; vy: number }[] =
    nodes.map((n) => ({
      id: n.id,
      x: width / 2 + (rng() - 0.5) * width * 0.6,
      y: height / 2 + (rng() - 0.5) * height * 0.6,
      vx: 0,
      vy: 0,
    }));
  const indexById = new Map<string, number>(
    positions.map((p, i) => [p.id, i]),
  );

  const cx = width / 2;
  const cy = height / 2;

  for (let it = 0; it < ITERATIONS; it++) {
    const cooling = 1 - it / ITERATIONS;

    // Repulsion (O(N²))
    for (let i = 0; i < positions.length; i++) {
      let fx = 0;
      let fy = 0;
      const pi = positions[i];
      for (let j = 0; j < positions.length; j++) {
        if (i === j) continue;
        const pj = positions[j];
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const dist2 = dx * dx + dy * dy + 0.01;
        const force = REPULSION / dist2;
        fx += (dx / Math.sqrt(dist2)) * force;
        fy += (dy / Math.sqrt(dist2)) * force;
      }
      // Gravity toward center
      fx += (cx - pi.x) * CENTER_GRAVITY;
      fy += (cy - pi.y) * CENTER_GRAVITY;
      pi.vx = fx;
      pi.vy = fy;
    }

    // Attraction (springs along edges)
    for (const e of edges) {
      const ia = indexById.get(e.a);
      const ib = indexById.get(e.b);
      if (ia === undefined || ib === undefined) continue;
      const pa = positions[ia];
      const pb = positions[ib];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const delta = dist - SPRING_LENGTH;
      const force = SPRING_K * delta;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      pa.vx += fx;
      pa.vy += fy;
      pb.vx -= fx;
      pb.vy -= fy;
    }

    // Apply displacements with cooling and clamp
    for (const p of positions) {
      const dispX = Math.max(
        -MAX_DISPLACEMENT,
        Math.min(MAX_DISPLACEMENT, p.vx * cooling),
      );
      const dispY = Math.max(
        -MAX_DISPLACEMENT,
        Math.min(MAX_DISPLACEMENT, p.vy * cooling),
      );
      p.x += dispX;
      p.y += dispY;
      // Keep inside canvas with a margin
      const m = 40;
      p.x = Math.max(m, Math.min(width - m, p.x));
      p.y = Math.max(m, Math.min(height - m, p.y));
    }
  }

  return new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
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
  return useMemo(
    () => computeForceLayout(nodes, edges, width, height),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, width, height],
  );
}
