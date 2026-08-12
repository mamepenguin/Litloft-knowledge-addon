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
 * header and hako `v-qemxzUaCC0EqFLh5hxD`). These tests pin the identity
 * across the full parameter range so that drift fails loudly instead.
 */

// k below 1 (zoomed out), at 1, and well above (zoomed in). fit spans
// desktop (~0.9) through phone (~0.31) and the degenerate zero case.
const SCALES = [0.5, 0.75, 0.9, 1, 1.5, 3, 12];
const FITS = [0, 0.31, 0.5, 0.9, 1, 2];
const RELATION_COUNTS = [0, 1, 4, 8, 20];

describe("frameVars factorisation", () => {
  const cases = SCALES.flatMap((k) =>
    FITS.flatMap((fit) => RELATION_COUNTS.map((rc) => ({ k, fit, rc }))),
  );

  it.each(cases)(
    "circle radius matches circleAttrR (k=$k fit=$fit rc=$rc)",
    ({ k, fit, rc }) => {
      const composed = screenCircleR(rc) * frameVars(k, fit).k;
      expect(composed).toBeCloseTo(circleAttrR(rc, k, fit), 10);
    },
  );

  it.each(cases)(
    "hit radius matches hitAttrR (k=$k fit=$fit rc=$rc)",
    ({ k, fit, rc }) => {
      const composed = screenHitR(rc) * frameVars(k, fit).k;
      expect(composed).toBeCloseTo(hitAttrR(rc, k, fit), 10);
    },
  );

  it.each(SCALES.flatMap((k) => FITS.map((fit) => ({ k, fit }))))(
    "label font matches labelAttrFont (k=$k fit=$fit)",
    ({ k, fit }) => {
      expect(frameVars(k, fit).lf).toBeCloseTo(labelAttrFont(k, fit), 10);
    },
  );

  it.each(SCALES.flatMap((k) => FITS.map((fit) => ({ k, fit }))))(
    "label gap reproduces the old inline expression (k=$k fit=$fit)",
    ({ k, fit }) => {
      // GraphLayers previously computed this per render as:
      //   const gapAttr = 6 / scale / (fit > 0 ? fit : 1);
      const legacy = 6 / k / (fit > 0 ? fit : 1);
      expect(frameVars(k, fit).lg).toBeCloseTo(legacy, 10);
    },
  );
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
});
