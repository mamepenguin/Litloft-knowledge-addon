/**
 * Pan / pinch / wheel zoom for an SVG viewport.
 *
 * Uses a callback ref (attachRef) instead of useRef so listeners attach
 * the moment the SVG element appears in the DOM. The graph SVG is
 * conditionally rendered (only after data loads) and a plain useRef +
 * useEffect would miss the mount because useEffect runs once with a
 * null ref.
 *
 * The hook returns:
 *  - viewport transform values (tx, ty, scale)
 *  - attachRef: ref callback to spread onto the SVG element
 *  - svgRef: the underlying ref object for read access
 *  - didDragRef, downTargetRef: for the consumer's tap-vs-drag logic
 *  - imperative controls (zoomIn / zoomOut / reset)
 *  - fitToBounds: fit a node bounding box into the viewport
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface PointerPos {
  x: number;
  y: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 12;
const VIEWBOX_W = 1100;
const VIEWBOX_H = 620;
const INERTIA_DECAY = 0.92;

export interface PanZoomState {
  tx: number;
  ty: number;
  scale: number;
}

export interface UseGraphPanZoom {
  state: PanZoomState;
  attachRef: (el: SVGSVGElement | null) => void;
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  didDragRef: React.MutableRefObject<boolean>;
  downTargetRef: React.MutableRefObject<Element | null>;
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
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const [state, setState] = useState<PanZoomState>({ tx: 0, ty: 0, scale: 1 });
  const stateRef = useRef(state);
  stateRef.current = state;

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

  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    setState((prev) => {
      const newScale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, prev.scale * factor),
      );
      const k = newScale / prev.scale;
      return {
        scale: newScale,
        tx: sx - k * (sx - prev.tx),
        ty: sy - k * (sy - prev.ty),
      };
    });
  }, []);

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
        const cur = stateRef.current;
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
        const cur = stateRef.current;
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
        setState((prev) => {
          const nextTx = ds.tx0 + dx / fit;
          const nextTy = ds.ty0 + dy / fit;
          velocity.current = {
            x: (nextTx - prev.tx),
            y: (nextTy - prev.ty),
          };
          return { ...prev, tx: nextTx, ty: nextTy };
        });
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
        setState({
          scale: newScale,
          tx: cur.x - realK * (ps.svgCenter.x - ps.tx0),
          ty: cur.y - realK * (ps.svgCenter.y - ps.ty0),
        });
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
          // Inertia
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
            setState((prev) => ({
              ...prev,
              tx: prev.tx + velocity.current.x,
              ty: prev.ty + velocity.current.y,
            }));
            inertiaRaf.current = requestAnimationFrame(step);
          };
          inertiaRaf.current = requestAnimationFrame(step);
        }
        dragStart.current = null;
        pinchStart.current = null;
      } else if (pointers.current.size === 1) {
        const [first] = Array.from(pointers.current.values());
        const cur = stateRef.current;
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
  }, [svgEl]);

  const zoomIn = useCallback(
    () => zoomAt(VIEWBOX_W / 2, VIEWBOX_H / 2, 1.25),
    [zoomAt],
  );
  const zoomOut = useCallback(
    () => zoomAt(VIEWBOX_W / 2, VIEWBOX_H / 2, 0.8),
    [zoomAt],
  );
  const reset = useCallback(
    () => setState({ tx: 0, ty: 0, scale: 1 }),
    [],
  );

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
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(scaleX, scaleY)));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const tx = VIEWBOX_W / 2 - cx * scale;
      const ty = VIEWBOX_H / 2 - cy * scale;
      setState({ tx, ty, scale });
    },
    [],
  );

  const attachRef = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el;
    setSvgEl(el);
  }, []);

  return useMemo(
    () => ({
      state,
      attachRef,
      svgRef,
      didDragRef,
      downTargetRef,
      zoomIn,
      zoomOut,
      reset,
      fitToBounds,
    }),
    [state, attachRef, zoomIn, zoomOut, reset, fitToBounds],
  );
}

export const PAN_ZOOM_VIEWBOX = { width: VIEWBOX_W, height: VIEWBOX_H };
