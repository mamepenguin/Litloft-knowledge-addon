import { describe, expect, it } from "vitest";

import {
  circleAttrR,
  frameVars,
  hitAttrR,
  labelAttrFont,
  screenCircleR,
  screenHitR,
} from "../graph/graphGeometry";

/**
 * The graph moves node geometry into CSS custom properties so pan and
 * zoom never re-render React (design spec §3.1). That rests on every
 * formula factoring into `per-node constant × per-frame scalar`:
 *
 *   circleAttrR(rc, k, fit) === screenCircleR(rc) × frameVars(k, fit).k
 *   hitAttrR(rc, k, fit)    === screenHitR(rc)    × frameVars(k, fit).k
 *
 * If anyone edits one side without the other, the factorisation silently
 * stops holding and node sizes drift — on phones especially, because the
 * `fit` divisor is what keeps sizes device-independent (see the module
 * header and hako `v-qemxzUaCC0EqFLh5hxD`).
 */

/**
 * The branches the formulas have, not a sweep: `k` on each side of the
 * `k >= 1` counter-scale and at it, `fit` on each side of the `fit > 0`
 * guard plus the identity, and `rc` on each side of the hit-radius floor.
 * A wider grid re-answers the same branches.
 */
const SCALES = [0.5, 1, 3];
const FITS = [0, 0.31, 1];
const RELATION_COUNTS = [0, 20];

describe("frameVars factorisation", () => {
  it.each(
    SCALES.flatMap((k) => FITS.map((fit) => ({ k, fit }))),
  )("holds at k=$k fit=$fit", ({ k, fit }) => {
    const frame = frameVars(k, fit);

    for (const rc of RELATION_COUNTS) {
      expect(screenCircleR(rc) * frame.k).toBeCloseTo(
        circleAttrR(rc, k, fit),
        10,
      );
      expect(screenHitR(rc) * frame.k).toBeCloseTo(hitAttrR(rc, k, fit), 10);
    }
    expect(frame.lf).toBeCloseTo(labelAttrFont(k, fit), 10);
  });
});

describe("frameVars guards", () => {
  it("treats fit <= 0 as 1 rather than dividing by zero", () => {
    const v = frameVars(1, 0);
    expect(Number.isFinite(v.k)).toBe(true);
    expect(Number.isFinite(v.lf)).toBe(true);
    expect(Number.isFinite(v.lg)).toBe(true);
    expect(v.k).toBeCloseTo(frameVars(1, 1).k, 10);
  });

  it("holds circles at screen size when zoomed in, shrinks them when out", () => {
    // k >= 1 counter-scales so the on-screen radius is constant; below 1
    // the circle is left alone and shrinks with the viewport.
    expect(screenCircleR(4) * frameVars(4, 1).k).toBeCloseTo(
      screenCircleR(4) / 4,
      10,
    );
    expect(screenCircleR(4) * frameVars(0.5, 1).k).toBeCloseTo(
      screenCircleR(4),
      10,
    );
  });

  it("keeps the touch target at the HIG minimum for an isolated node", () => {
    // relation_count 0 -> screenCircleR 8 -> 8 * 1.6 = 12.8, below the
    // 22px floor, so the floor must win.
    expect(screenHitR(0)).toBe(22);
  });

  it("divides the label gap by the zoom and by the fit", () => {
    expect(frameVars(2, 1).lg).toBeCloseTo(3, 10);
    expect(frameVars(2, 0.5).lg).toBeCloseTo(6, 10);
    expect(frameVars(1, 0).lg).toBeCloseTo(6, 10);
  });

  it("clamps the label font between its floor and its ceiling", () => {
    // 11 * sqrt(k) leaves the floor above k=1 and reaches 16 at k≈2.116.
    expect(labelAttrFont(0.25, 1)).toBeCloseTo(11 / 0.25, 10);
    expect(labelAttrFont(9, 1)).toBeCloseTo(16 / 9, 10);
  });
});
