/**
 * Force-directed layout for the connections graph.
 *
 * Pure: no React, no DOM, no imports. That keeps it directly
 * benchmarkable and testable, and it is why the React binding in
 * useGraphLayout.ts stays thin.
 *
 * Repulsion is approximated with a Barnes-Hut quadtree, which is what
 * makes the layout affordable to run synchronously. The exact O(N²) sum
 * took ~489 ms at 1,000 nodes — long enough to freeze the page, since
 * the binding computes during React's render phase.
 *
 * Attraction, gravity, cooling and the canvas clamp are unchanged from
 * the exact implementation; only the repulsion term is approximated.
 *
 * Determinism: a seeded mulberry32 PRNG places initial positions, so
 * reloading the page yields the same layout (anti-jitter for users).
 */

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

/**
 * Barnes-Hut opening angle. A cell is treated as a single point mass
 * when `size / distance < THETA`. Larger is faster and coarser; 0.9 is
 * at the loose end of the usual 0.5-1.0 range, which suits us because
 * repulsion here only has to keep labels from colliding, not model
 * gravitation.
 */
const THETA_SQ = 0.9 * 0.9;

/**
 * Depth cap for quadtree insertion. Bodies at identical coordinates
 * would otherwise subdivide forever — the seeded PRNG makes exact
 * collisions unlikely but not impossible, and the canvas clamp can push
 * several nodes onto the same margin. Beyond this depth the bodies just
 * share a cell, which is harmless: they are far closer to each other
 * than to anything else, so approximating them together is accurate.
 */
const MAX_DEPTH = 40;

export interface ForceLayoutInput {
  /** Node ids, in the order their coordinates are returned. */
  ids: string[];
  /** Edges as index pairs into `ids`. */
  edges: Int32Array;
  width: number;
  height: number;
}

/** Flat [x0, y0, x1, y1, …] parallel to `ids`. */
export type Positions = Float32Array;

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(ids: string[]): number {
  // Stable across reloads given the same node set; small drift when
  // nodes are added/removed (intentional — relayout when topology
  // changes is desirable).
  let h = 5381;
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      h = ((h << 5) + h + id.charCodeAt(i)) | 0;
    }
  }
  return h;
}

/**
 * Quadtree over the current node positions.
 *
 * Flat typed arrays rather than objects — one tree is rebuilt every
 * iteration (160 times per layout), so allocation pressure matters more
 * than the readability of a linked structure.
 *
 * `child[4 * cell + q]` encodes the quadrant slot:
 *   -1            empty
 *   >= 0          index of a child cell
 *   <= -2         a single body, index `-(v + 2)`
 */
class Quadtree {
  child: Int32Array;
  /** Running sums; divide by `mass` for the centre of mass. */
  sumX: Float64Array;
  sumY: Float64Array;
  mass: Float64Array;
  midX: Float64Array;
  midY: Float64Array;
  half: Float64Array;
  count = 0;

  constructor(capacity: number) {
    this.child = new Int32Array(capacity * 4);
    this.sumX = new Float64Array(capacity);
    this.sumY = new Float64Array(capacity);
    this.mass = new Float64Array(capacity);
    this.midX = new Float64Array(capacity);
    this.midY = new Float64Array(capacity);
    this.half = new Float64Array(capacity);
  }

  /**
   * Cell count is not bounded by a small multiple of n: heavily
   * clustered inputs subdivide far deeper than a uniform spread. The
   * connections graph produces exactly that — a drive whose relations
   * form cliques lands many nodes in a tight ball. So the arrays grow
   * instead of being sized by a guess.
   */
  private grow(): void {
    const next = this.mass.length * 2;
    const child = new Int32Array(next * 4);
    child.set(this.child);
    this.child = child;
    const copy = (a: Float64Array) => {
      const b = new Float64Array(next);
      b.set(a);
      return b;
    };
    this.sumX = copy(this.sumX);
    this.sumY = copy(this.sumY);
    this.mass = copy(this.mass);
    this.midX = copy(this.midX);
    this.midY = copy(this.midY);
    this.half = copy(this.half);
  }

  private cell(midX: number, midY: number, half: number): number {
    if (this.count === this.mass.length) this.grow();
    const c = this.count++;
    const base = c * 4;
    this.child[base] = -1;
    this.child[base + 1] = -1;
    this.child[base + 2] = -1;
    this.child[base + 3] = -1;
    this.sumX[c] = 0;
    this.sumY[c] = 0;
    this.mass[c] = 0;
    this.midX[c] = midX;
    this.midY[c] = midY;
    this.half[c] = half;
    return c;
  }

  reset(midX: number, midY: number, half: number): void {
    this.count = 0;
    this.cell(midX, midY, half);
  }

  private accumulate(c: number, x: number, y: number): void {
    this.sumX[c] += x;
    this.sumY[c] += y;
    this.mass[c] += 1;
  }

  /** Quadrant of (x, y) within cell `c`: 0=NW 1=NE 2=SW 3=SE. */
  private quadrant(c: number, x: number, y: number): number {
    return (x >= this.midX[c] ? 1 : 0) + (y >= this.midY[c] ? 2 : 0);
  }

  private childCell(c: number, q: number): number {
    const h = this.half[c] / 2;
    const mx = this.midX[c] + (q & 1 ? h : -h);
    const my = this.midY[c] + (q & 2 ? h : -h);
    return this.cell(mx, my, h);
  }

  insert(b: number, x: number, y: number): void {
    let c = 0;
    this.accumulate(c, x, y);
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const slot = c * 4 + this.quadrant(c, x, y);
      const v = this.child[slot];
      if (v === -1) {
        this.child[slot] = -(b + 2);
        return;
      }
      if (v <= -2) {
        // Occupied by a single body — push it down a level and retry.
        const other = -(v + 2);
        const nc = this.childCell(c, this.quadrant(c, x, y));
        this.child[slot] = nc;
        const ox = this.pos[other * 2];
        const oy = this.pos[other * 2 + 1];
        this.accumulate(nc, ox, oy);
        this.child[nc * 4 + this.quadrant(nc, ox, oy)] = -(other + 2);
        this.accumulate(nc, x, y);
        c = nc;
        continue;
      }
      c = v;
      this.accumulate(c, x, y);
    }
  }

  // Displacing an existing body one level down needs its coordinates,
  // so the tree keeps a reference to the live position array rather
  // than threading it through every insert call.
  private pos: Float32Array = new Float32Array(0);
  bindPositions(pos: Float32Array): void {
    this.pos = pos;
  }
}

/**
 * Repulsion on body `i`, accumulated into `out` as [fx, fy].
 *
 * A cell is opened when it is too close to be summarised by its centre
 * of mass. Note this also resolves the self-interaction problem for
 * free: a cell containing `i` puts its centre of mass within roughly
 * one cell-size of `i`, which always fails the opening test for
 * THETA <= 1, so such cells are opened down to individual bodies and
 * `i` can be skipped by index.
 */
function repulsionOn(
  tree: Quadtree,
  pos: Float32Array,
  i: number,
  stack: Int32Array,
  out: Float64Array,
): void {
  const xi = pos[i * 2];
  const yi = pos[i * 2 + 1];
  let fx = 0;
  let fy = 0;
  let sp = 0;
  stack[sp++] = 0;

  while (sp > 0) {
    const c = stack[--sp];
    const m = tree.mass[c];
    if (m === 0) continue;

    const dx = xi - tree.sumX[c] / m;
    const dy = yi - tree.sumY[c] / m;
    const dist2 = dx * dx + dy * dy + 0.01;
    const size = tree.half[c] * 2;

    if (size * size < THETA_SQ * dist2) {
      const force = (REPULSION * m) / dist2;
      const inv = 1 / Math.sqrt(dist2);
      fx += dx * inv * force;
      fy += dy * inv * force;
      continue;
    }

    const base = c * 4;
    for (let q = 0; q < 4; q++) {
      const v = tree.child[base + q];
      if (v === -1) continue;
      if (v <= -2) {
        const j = -(v + 2);
        if (j === i) continue;
        const bx = xi - pos[j * 2];
        const by = yi - pos[j * 2 + 1];
        const d2 = bx * bx + by * by + 0.01;
        const force = REPULSION / d2;
        const inv = 1 / Math.sqrt(d2);
        fx += bx * inv * force;
        fy += by * inv * force;
      } else {
        stack[sp++] = v;
      }
    }
  }

  out[0] = fx;
  out[1] = fy;
}

export function forceLayout(input: ForceLayoutInput): Positions {
  const { ids, edges, width, height } = input;
  const n = ids.length;
  const pos = new Float32Array(n * 2);
  if (n === 0) return pos;

  const rng = mulberry32(hashSeed(ids));
  for (let i = 0; i < n; i++) {
    pos[i * 2] = width / 2 + (rng() - 0.5) * width * 0.6;
    pos[i * 2 + 1] = height / 2 + (rng() - 0.5) * height * 0.6;
  }

  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const cx = width / 2;
  const cy = height / 2;
  const margin = 40;
  const edgeCount = edges.length >> 1;

  // Initial sizing only — the tree grows itself when a clustered
  // iteration needs more cells. The traversal is depth-first and pushes
  // at most four children per pop, so the stack is bounded by the
  // depth cap.
  const tree = new Quadtree(4 * n + 64);
  tree.bindPositions(pos);
  const stack = new Int32Array(4 * MAX_DEPTH + 64);
  const force = new Float64Array(2);

  for (let it = 0; it < ITERATIONS; it++) {
    const cooling = 1 - it / ITERATIONS;

    // Rebuild the tree for this iteration's positions.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 2];
      const y = pos[i * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    // Square, and never degenerate — a zero half-size would make the
    // opening test meaningless.
    const half = Math.max((maxX - minX) / 2, (maxY - minY) / 2, 1) + 1;
    tree.reset((minX + maxX) / 2, (minY + maxY) / 2, half);
    for (let i = 0; i < n; i++) {
      tree.insert(i, pos[i * 2], pos[i * 2 + 1]);
    }

    // Repulsion (Barnes-Hut) + gravity toward centre
    for (let i = 0; i < n; i++) {
      repulsionOn(tree, pos, i, stack, force);
      vx[i] = force[0] + (cx - pos[i * 2]) * CENTER_GRAVITY;
      vy[i] = force[1] + (cy - pos[i * 2 + 1]) * CENTER_GRAVITY;
    }

    // Attraction (springs along edges)
    for (let e = 0; e < edgeCount; e++) {
      const ia = edges[e * 2];
      const ib = edges[e * 2 + 1];
      const dx = pos[ib * 2] - pos[ia * 2];
      const dy = pos[ib * 2 + 1] - pos[ia * 2 + 1];
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (SPRING_K * (dist - SPRING_LENGTH)) / dist;
      const fx = dx * f;
      const fy = dy * f;
      vx[ia] += fx;
      vy[ia] += fy;
      vx[ib] -= fx;
      vy[ib] -= fy;
    }

    // Apply displacements with cooling and clamp
    for (let i = 0; i < n; i++) {
      const dispX = Math.max(
        -MAX_DISPLACEMENT,
        Math.min(MAX_DISPLACEMENT, vx[i] * cooling),
      );
      const dispY = Math.max(
        -MAX_DISPLACEMENT,
        Math.min(MAX_DISPLACEMENT, vy[i] * cooling),
      );
      pos[i * 2] = Math.max(
        margin,
        Math.min(width - margin, pos[i * 2] + dispX),
      );
      pos[i * 2 + 1] = Math.max(
        margin,
        Math.min(height - margin, pos[i * 2 + 1] + dispY),
      );
    }
  }

  return pos;
}
