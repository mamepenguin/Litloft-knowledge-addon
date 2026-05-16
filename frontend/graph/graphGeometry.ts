/**
 * Screen-space geometry for graph nodes and labels.
 *
 * All sizes are expressed as *screen-target* values and divided by the
 * viewport scale `k` so the parent `<g scale(k)>` cancels out. This
 * decouples on-screen size from zoom:
 *
 *  - Circles stay a constant screen size once zoomed in (k ≥ 1) and
 *    only shrink when zoomed out, so they never balloon.
 *  - Labels grow sub-linearly with zoom (k^0.5) between a floor and a
 *    ceiling, so they stay readable when zoomed in without tracking
 *    zoom 1:1.
 *  - The transparent hit circle is never smaller than a comfortable
 *    touch target (Apple HIG ~44px diameter ≈ 22px radius).
 */

// Below this zoom, labels are hidden unless the node is selected /
// focused / search-matched (Obsidian-style declutter).
export const LABEL_SCALE_THRESHOLD = 1.4;

const LABEL_FONT_MIN = 17;
const LABEL_FONT_MAX = 52;
const MIN_HIT_SCREEN_R = 22;

export function screenCircleR(rc: number): number {
  return 8 + Math.min(rc, 8) * 1.1; // 8 – 16.8
}

export function circleAttrR(rc: number, k: number): number {
  const target = screenCircleR(rc);
  return k >= 1 ? target / k : target;
}

export function hitAttrR(rc: number, k: number): number {
  const screen = Math.max(MIN_HIT_SCREEN_R, screenCircleR(rc) * 1.6);
  return k >= 1 ? screen / k : screen;
}

export function labelAttrFont(k: number): number {
  const desired = Math.min(
    LABEL_FONT_MAX,
    Math.max(LABEL_FONT_MIN, LABEL_FONT_MIN * Math.pow(k, 0.5)),
  );
  return desired / k;
}

/** Breadth-first reachable set from `start` within `depth` hops. */
export function bfsScope(
  adjacency: Map<string, Set<string>>,
  start: string,
  depth: number,
): Set<string> {
  const seen = new Set<string>([start]);
  let frontier = [start];
  for (let i = 0; i < depth; i++) {
    const next: string[] = [];
    frontier.forEach((x) =>
      adjacency.get(x)?.forEach((y) => {
        if (!seen.has(y)) {
          seen.add(y);
          next.push(y);
        }
      }),
    );
    frontier = next;
  }
  return seen;
}
