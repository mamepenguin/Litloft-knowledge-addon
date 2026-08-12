import { describe, expect, it } from "vitest";

import {
  forceLayout,
  hashSeed,
  type ForceLayoutInput,
} from "../graph/forceLayout";

/**
 * The layout runs synchronously inside React's render phase, and its
 * repulsion term is a Barnes-Hut approximation. Both facts make it easy
 * to break quietly: an approximation bug does not throw, it just
 * produces a worse picture, and nothing else in the suite looks at
 * coordinates. These tests pin the properties the graph depends on.
 */

function ids(n: number, prefix = "n"): string[] {
  return Array.from({ length: n }, (_, i) => prefix + String(i).padStart(8, "0"));
}

function ring(n: number): ForceLayoutInput {
  const pairs: number[] = [];
  for (let i = 0; i < n; i++) pairs.push(i, (i + 1) % n);
  return { ids: ids(n), edges: Int32Array.from(pairs), width: 1100, height: 620 };
}

/** Groups of mutually-connected nodes — the shape real drives produce. */
function cliques(groups: number, size: number): ForceLayoutInput {
  const pairs: number[] = [];
  for (let g = 0; g < groups; g++) {
    for (let a = 0; a < size; a++) {
      for (let b = a + 1; b < size; b++) {
        pairs.push(g * size + a, g * size + b);
      }
    }
  }
  return {
    ids: ids(groups * size, "c"),
    edges: Int32Array.from(pairs),
    width: 1100,
    height: 620,
  };
}

function meanNearestNeighbour(pos: Float32Array, n: number): number {
  let sum = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(n / 100));
  for (let i = 0; i < n; i += step) {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = pos[i * 2] - pos[j * 2];
      const dy = pos[i * 2 + 1] - pos[j * 2 + 1];
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
    count++;
  }
  return sum / count;
}

describe("forceLayout", () => {
  it("returns nothing for an empty graph", () => {
    expect(
      forceLayout({ ids: [], edges: new Int32Array(0), width: 1100, height: 620 })
        .length,
    ).toBe(0);
  });

  it("is deterministic for the same node set", () => {
    const input = ring(60);
    const a = forceLayout(input);
    const b = forceLayout(input);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("keeps every node finite and inside the canvas margin", () => {
    const n = 300;
    const pos = forceLayout(ring(n));
    for (let i = 0; i < n; i++) {
      const x = pos[i * 2];
      const y = pos[i * 2 + 1];
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(40);
      expect(x).toBeLessThanOrEqual(1100 - 40);
      expect(y).toBeGreaterThanOrEqual(40);
      expect(y).toBeLessThanOrEqual(620 - 40);
    }
  });

  it("spreads nodes out rather than collapsing them", () => {
    // The failure mode a Barnes-Hut bug produces is a fast layout that
    // piles every node on one spot. Repulsion must dominate at least
    // enough to hold neighbours apart.
    expect(meanNearestNeighbour(forceLayout(ring(200)), 200)).toBeGreaterThan(10);
  });

  it("uses the whole canvas", () => {
    const n = 200;
    const pos = forceLayout(ring(n));
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, pos[i * 2]);
      maxX = Math.max(maxX, pos[i * 2]);
    }
    expect(maxX - minX).toBeGreaterThan(1100 * 0.5);
  });

  it("handles densely clustered cliques without exhausting the quadtree", () => {
    // Cliques pull their members into a tight ball, which subdivides the
    // quadtree far deeper than a uniform spread. The tree grows its
    // arrays for exactly this case; a fixed-size tree silently dropped
    // cells here (typed arrays ignore out-of-range writes) and produced
    // a wrong layout rather than an error.
    const input = cliques(84, 12);
    const pos = forceLayout(input);
    expect(pos.length).toBe(input.ids.length * 2);
    for (let i = 0; i < input.ids.length; i++) {
      expect(Number.isFinite(pos[i * 2])).toBe(true);
      expect(Number.isFinite(pos[i * 2 + 1])).toBe(true);
    }
    expect(
      meanNearestNeighbour(pos, input.ids.length),
    ).toBeGreaterThan(0);
  });

  it("tolerates coincident nodes without recursing forever", () => {
    // MAX_DEPTH is what stops identical coordinates from subdividing
    // endlessly. Nodes with no edges all start from the seeded PRNG, so
    // force them together by giving the canvas no room.
    const input: ForceLayoutInput = {
      ids: ids(50),
      edges: new Int32Array(0),
      width: 1,
      height: 1,
    };
    const pos = forceLayout(input);
    for (let i = 0; i < 50; i++) {
      expect(Number.isFinite(pos[i * 2])).toBe(true);
      expect(Number.isFinite(pos[i * 2 + 1])).toBe(true);
    }
  });

  it("ignores edges pointing outside the node set", () => {
    // buildInput filters these, but the simulation should not corrupt
    // memory if one slips through.
    const input: ForceLayoutInput = {
      ids: ids(5),
      edges: Int32Array.from([0, 1, 1, 2]),
      width: 1100,
      height: 620,
    };
    expect(forceLayout(input).length).toBe(10);
  });
});

describe("hashSeed", () => {
  it("is stable for the same ids and differs for different ones", () => {
    expect(hashSeed(["a", "b"])).toBe(hashSeed(["a", "b"]));
    expect(hashSeed(["a", "b"])).not.toBe(hashSeed(["b", "a"]));
  });
});
