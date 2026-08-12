/**
 * Pan / pinch / wheel zoom for an SVG viewport.
 *
 * The viewport transform is deliberately *not* React state. Holding
 * {tx, ty, scale} in useState meant every pointermove re-rendered the
 * whole graph — at 1,000 nodes that is ~9,400 SVG elements reconciled
 * per frame to move one transform. Instead the transform lives in a ref
 * and a rAF-coalesced writer touches the DOM directly:
 *
 *   - the viewport <g> gets its `transform` attribute
 *   - the <svg> root gets --k / --lf / --lg (the per-frame half of the
 *     geometry; see graphGeometry.frameVars) and a `data-labels`
 *     attribute for the label-visibility threshold
 *   - the zoom pill gets its textContent
 *
 * Everything else — node radii, label sizes — follows from those CSS
 * custom properties without React's involvement. Pan and zoom therefore
 * cost a constant number of DOM writes per frame, whatever the node
 * count. See the design spec §3.
 *
 * `data-labels` is an attribute rather than a class because React owns
 * the root's className; toggling a class here would be wiped the next
 * time React re-rendered the element.
 *
 * Uses a callback ref (attachRef) instead of useRef so listeners attach
 * the moment the SVG element appears in the DOM. The graph SVG is
 * conditionally rendered (only after data loads) and a plain useRef +
 * useEffect would miss the mount because useEffect runs once with a
 * null ref.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { LABEL_SCALE_THRESHOLD, frameVars } from "./graphGeometry";

interface PointerPos {
  x: number;
  y: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 12;
const VIEWBOX_W = 1100;
const VIEWBOX_H = 620;
const INERTIA_DECAY = 0.92;

export interface PanZoomTransform {
  tx: number;
  ty: number;
  scale: number;
}

export interface UseGraphPanZoom {
  /** Ref callback for the <svg> root (listeners + CSS custom properties). */
  attachRef: (el: SVGSVGElement | null) => void;
  /** Ref callback for the <g> that carries the pan/zoom transform. */
  attachViewport: (el: SVGGElement | null) => void;
  /** Ref callback for the element displaying the zoom percentage. */
  attachZoomPill: (el: HTMLElement | null) => void;
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  didDragRef: React.MutableRefObject<boolean>;
  downTargetRef: React.MutableRefObject<Element | null>;
  /** Imperative read; the transform is not React state. */
  getScale: () => number;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  fitToBounds: (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    padding?: number,
  ) => void;
}

export function useGraphPanZoom(): UseGraphPanZoom {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef<SVGGElement | null>(null);
  const pillRef = useRef<HTMLElement | null>(null);
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);

  const tf = useRef<PanZoomTransform>({ tx: 0, ty: 0, scale: 1 });
  // The preserveAspectRatio="meet" fit ratio (viewBox -> rendered px).
  // 1 until measured; updated before paint and on every resize. A ref
  // rather than state — nothing in React consumes it any more.
  const fitRef = useRef(1);

  const pointers = useRef(new Map<number, PointerPos>());
  const dragStart = useRef<
    | { sx: number; sy: number; tx0: number; ty0: number }
    | null
  >(null);
  const pinchStart = useRef<
    | {
        dist: number;
        svgCenter: { x: number; y: number };
        scale0: number;
        tx0: number;
        ty0: number;
      }
    | null
  >(null);
  const didDragRef = useRef(false);
  const downTargetRef = useRef<Element | null>(null);
  const velocity = useRef({ x: 0, y: 0 });
  const inertiaRaf = useRef<number | null>(null);
  const paintRaf = useRef<number | null>(null);
  const lastLabels = useRef<string | null>(null);

  // ---- The frame writer ---------------------------------------------
  // The only place that touches the DOM for pan/zoom. Six writes,
  // regardless of how many nodes are on screen.
  const paint = useCallback(() => {
    const { tx, ty, scale } = tf.current;
    const fit = fitRef.current;

    const vp = viewportRef.current;
    if (vp) {
      vp.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
    }

    const root = svgRef.current;
    if (root) {
      const v = frameVars(scale, fit);
      root.style.setProperty("--k", String(v.k));
      root.style.setProperty("--lf", String(v.lf));
      root.style.setProperty("--lg", String(v.lg));
      // Guarded: setAttribute with an unchanged value still mutates the
      // DOM and wakes any MutationObserver. During a pan the threshold
      // never moves, so this would otherwise fire on every frame for no
      // reason. setProperty above needs no guard — it is a no-op when
      // the value is identical.
      const labels = scale >= LABEL_SCALE_THRESHOLD ? "on" : "off";
      if (lastLabels.current !== labels) {
        lastLabels.current = labels;
        root.setAttribute("data-labels", labels);
      }
    }

    const pill = pillRef.current;
    if (pill) {
      const pct = `${Math.round(scale * 100)}%`;
      if (pill.textContent !== pct) pill.textContent = pct;
    }
  }, []);

  const schedulePaint = useCallback(() => {
    if (paintRaf.current !== null) return;
    paintRaf.current = requestAnimationFrame(() => {
      paintRaf.current = null;
      paint();
    });
  }, [paint]);

  const stopInertia = () => {
    if (inertiaRaf.current !== null) {
      cancelAnimationFrame(inertiaRaf.current);
      inertiaRaf.current = null;
    }
  };

  const clientToSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const fit = Math.min(rect.width / VIEWBOX_W, rect.height / VIEWBOX_H);
    const offX = (rect.width - VIEWBOX_W * fit) / 2;
    const offY = (rect.height - VIEWBOX_H * fit) / 2;
    return {
      x: (clientX - rect.left - offX) / fit,
      y: (clientY - rect.top - offY) / fit,
    };
  };

  const zoomAt = useCallback(
    (sx: number, sy: number, factor: number) => {
      const prev = tf.current;
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, prev.scale * factor),
      );
      const k = newScale / prev.scale;
      tf.current = {
        scale: newScale,
        tx: sx - k * (sx - prev.tx),
        ty: sy - k * (sy - prev.ty),
      };
      schedulePaint();
    },
    [schedulePaint],
  );

  // Wheel zoom
  useEffect(() => {
    const svg = svgEl;
    if (!svg) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const p = clientToSvg(ev.clientX, ev.clientY);
      const factor = Math.exp(-ev.deltaY * 0.0015);
      zoomAt(p.x, p.y, factor);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgEl, zoomAt]);

  // Pointer events
  useEffect(() => {
    const svg = svgEl;
    if (!svg) return;

    const onDown = (ev: PointerEvent) => {
      svg.setPointerCapture(ev.pointerId);
      pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      stopInertia();
      if (pointers.current.size === 1) {
        const cur = tf.current;
        dragStart.current = {
          sx: ev.clientX,
          sy: ev.clientY,
          tx0: cur.tx,
          ty0: cur.ty,
        };
        didDragRef.current = false;
        downTargetRef.current = ev.target as Element | null;
      } else if (pointers.current.size === 2) {
        const [p1, p2] = Array.from(pointers.current.values());
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const center = clientToSvg(cx, cy);
        const cur = tf.current;
        pinchStart.current = {
          dist,
          svgCenter: center,
          scale0: cur.scale,
          tx0: cur.tx,
          ty0: cur.ty,
        };
        dragStart.current = null;
      }
    };

    const onMove = (ev: PointerEvent) => {
      if (!pointers.current.has(ev.pointerId)) return;
      pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.current.size === 1 && dragStart.current) {
        const ds = dragStart.current;
        const dx = ev.clientX - ds.sx;
        const dy = ev.clientY - ds.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true;
        const rect = svg.getBoundingClientRect();
        const fit = Math.min(rect.width / VIEWBOX_W, rect.height / VIEWBOX_H);
        const prev = tf.current;
        const nextTx = ds.tx0 + dx / fit;
        const nextTy = ds.ty0 + dy / fit;
        velocity.current = {
          x: nextTx - prev.tx,
          y: nextTy - prev.ty,
        };
        tf.current = { ...prev, tx: nextTx, ty: nextTy };
        schedulePaint();
      } else if (pointers.current.size === 2 && pinchStart.current) {
        const [p1, p2] = Array.from(pointers.current.values());
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const ps = pinchStart.current;
        const newScale = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, ps.scale0 * (dist / ps.dist)),
        );
        const realK = newScale / ps.scale0;
        const cur = clientToSvg(cx, cy);
        tf.current = {
          scale: newScale,
          tx: cur.x - realK * (ps.svgCenter.x - ps.tx0),
          ty: cur.y - realK * (ps.svgCenter.y - ps.ty0),
        };
        schedulePaint();
      }
    };

    const onUp = (ev: PointerEvent) => {
      pointers.current.delete(ev.pointerId);
      try {
        svg.releasePointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
      if (pointers.current.size === 0) {
        if (didDragRef.current) {
          // Inertia. Already inside rAF, so paint directly rather than
          // scheduling another frame.
          const step = () => {
            velocity.current.x *= INERTIA_DECAY;
            velocity.current.y *= INERTIA_DECAY;
            if (
              Math.abs(velocity.current.x) < 0.1 &&
              Math.abs(velocity.current.y) < 0.1
            ) {
              inertiaRaf.current = null;
              return;
            }
            const prev = tf.current;
            tf.current = {
              ...prev,
              tx: prev.tx + velocity.current.x,
              ty: prev.ty + velocity.current.y,
            };
            paint();
            inertiaRaf.current = requestAnimationFrame(step);
          };
          inertiaRaf.current = requestAnimationFrame(step);
        }
        dragStart.current = null;
        pinchStart.current = null;
      } else if (pointers.current.size === 1) {
        const [first] = Array.from(pointers.current.values());
        const cur = tf.current;
        dragStart.current = {
          sx: first.x,
          sy: first.y,
          tx0: cur.tx,
          ty0: cur.ty,
        };
        pinchStart.current = null;
      }
    };

    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    return () => {
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
      stopInertia();
    };
  }, [svgEl, schedulePaint, paint]);

  // Track the viewBox->px fit ratio. Same formula clientToSvg uses.
  // useLayoutEffect + ResizeObserver so the value is correct before the
  // first paint and follows container resize / device rotation.
  useLayoutEffect(() => {
    const svg = svgEl;
    if (!svg) return;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        fitRef.current = Math.min(
          rect.width / VIEWBOX_W,
          rect.height / VIEWBOX_H,
        );
        paint();
      }
    };
    measure();
    // Paint once regardless, so the custom properties exist even when
    // the element has no measurable box yet (jsdom returns zeroes).
    paint();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [svgEl, paint]);

  useEffect(
    () => () => {
      if (paintRaf.current !== null) cancelAnimationFrame(paintRaf.current);
      stopInertia();
    },
    [],
  );

  const zoomIn = useCallback(
    () => zoomAt(VIEWBOX_W / 2, VIEWBOX_H / 2, 1.25),
    [zoomAt],
  );
  const zoomOut = useCallback(
    () => zoomAt(VIEWBOX_W / 2, VIEWBOX_H / 2, 0.8),
    [zoomAt],
  );
  const reset = useCallback(() => {
    tf.current = { tx: 0, ty: 0, scale: 1 };
    schedulePaint();
  }, [schedulePaint]);

  const fitToBounds = useCallback(
    (
      minX: number,
      minY: number,
      maxX: number,
      maxY: number,
      padding = 60,
    ) => {
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const scaleX = (VIEWBOX_W - padding * 2) / w;
      const scaleY = (VIEWBOX_H - padding * 2) / h;
      const scale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, Math.min(scaleX, scaleY)),
      );
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      tf.current = {
        scale,
        tx: VIEWBOX_W / 2 - cx * scale,
        ty: VIEWBOX_H / 2 - cy * scale,
      };
      schedulePaint();
    },
    [schedulePaint],
  );

  const attachRef = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el;
    setSvgEl(el);
  }, []);

  const attachViewport = useCallback((el: SVGGElement | null) => {
    viewportRef.current = el;
  }, []);

  const attachZoomPill = useCallback((el: HTMLElement | null) => {
    pillRef.current = el;
  }, []);

  const getScale = useCallback(() => tf.current.scale, []);

  return useMemo(
    () => ({
      attachRef,
      attachViewport,
      attachZoomPill,
      svgRef,
      didDragRef,
      downTargetRef,
      getScale,
      zoomIn,
      zoomOut,
      reset,
      fitToBounds,
    }),
    [
      attachRef,
      attachViewport,
      attachZoomPill,
      getScale,
      zoomIn,
      zoomOut,
      reset,
      fitToBounds,
    ],
  );
}

export const PAN_ZOOM_VIEWBOX = { width: VIEWBOX_W, height: VIEWBOX_H };
