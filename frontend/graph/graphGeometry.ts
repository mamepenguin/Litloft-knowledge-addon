/**
 * Screen-space geometry for graph nodes and labels.
 *
 * All sizes are expressed as *screen-target* px and divided by both the
 * viewport scale `k` (so the parent `<g scale(k)>` cancels) and the
 * preserveAspectRatio fit ratio `fit` (so the viewBox->box scale-to-fit
 * cancels — without this, sizes render ~3x smaller on a phone than on
 * desktop at the same zoom). This decouples on-screen size from zoom:
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
// focused / search-matched (Obsidian-style declutter). Kept low so
// labels are visible at the default auto-fit zoom, not only after the
// user zooms in.
export const LABEL_SCALE_THRESHOLD = 0.9;

// Tight band so labels behave like the circles: small at rest and
// near-constant on screen — they reach the ceiling by ~2x zoom and
// never keep ballooning as you zoom further in.
const LABEL_FONT_MIN = 11;
const LABEL_FONT_MAX = 16;
const MIN_HIT_SCREEN_R = 22;

export function screenCircleR(rc: number): number {
  return 8 + Math.min(rc, 8) * 1.1; // 8 – 16.8
}

// `fit` is the viewBox->screen px ratio (preserveAspectRatio="meet").
// Sizes are authored as screen-target px, so we divide by `fit` to undo
// the SVG's uniform scale-to-fit. Without this the whole graph is
// authored in 1100-unit space and renders ~3x smaller on a phone (box
// width ~343px) than on desktop (~1100px) at the same zoom.
function px(screenUnits: number, fit: number): number {
  return screenUnits / (fit > 0 ? fit : 1);
}

export function circleAttrR(rc: number, k: number, fit = 1): number {
  const target = screenCircleR(rc);
  return px(k >= 1 ? target / k : target, fit);
}

export function hitAttrR(rc: number, k: number, fit = 1): number {
  const screen = Math.max(MIN_HIT_SCREEN_R, screenCircleR(rc) * 1.6);
  return px(k >= 1 ? screen / k : screen, fit);
}

export function labelAttrFont(k: number, fit = 1): number {
  const desired = Math.min(
    LABEL_FONT_MAX,
    Math.max(LABEL_FONT_MIN, LABEL_FONT_MIN * Math.pow(k, 0.5)),
  );
  return px(desired / k, fit);
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
