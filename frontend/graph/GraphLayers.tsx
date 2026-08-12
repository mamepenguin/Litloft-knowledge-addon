"use client";

import type { CSSProperties } from "react";

import type { GraphEdge, GraphNode } from "../api";
import type { LayoutMap } from "./useGraphLayout";
import type { PaletteColor } from "./graphPalette";
import { screenCircleR, screenHitR } from "./graphGeometry";

type Layout = LayoutMap;

/**
 * Geometry that depends on the viewport zoom, expressed in CSS so it can
 * follow pan/zoom without a React render.
 *
 * `--r` / `--rh` are per-node constants written by React once. `--k`,
 * `--lf`, `--lg` are the per-frame scalars written onto the <svg> root
 * by useGraphPanZoom's frame writer. In SVG `1px` is one user unit, so
 * these calc() results land directly in the viewBox coordinate system.
 *
 * Only `translate` is used, never `scale()`: a pure translation is
 * independent of transform-origin, whereas scaling would force a choice
 * between transform-box values (`view-box` = SVG root origin, `fill-box`
 * = the element's bbox corner) and neither is the node's own origin.
 *
 * Labels are hidden with `display: none` rather than skipped by React,
 * so crossing the zoom threshold costs one attribute write instead of a
 * full re-render — which is the entire point of the exercise.
 */
export const GRAPH_LAYER_CSS = `
.lg-graph { touch-action: none; cursor: grab; }
.lg-node circle.lg-body { r: calc(var(--r) * var(--k) * 1px); }
.lg-node circle.lg-hit { r: calc(var(--rh) * var(--k) * 1px); }
.lg-node text {
  display: none;
  font-size: calc(var(--lf) * 1px);
  stroke-width: calc(var(--lf) * 0.28 * 1px);
  transform: translateY(calc((var(--r) * var(--k) + var(--lg) + var(--lf)) * 1px));
}
.lg-graph[data-labels="on"] .lg-node text,
.lg-graph.lg-filtered .lg-node text,
.lg-node.is-selected text,
.lg-node.is-center text,
.lg-node.is-match text { display: inline; }
`;

export function EdgeLayer({
  edges,
  layout,
  selectedId,
}: {
  edges: GraphEdge[];
  layout: Layout;
  selectedId: string | null;
}) {
  return (
    <g>
      {edges.map((e, i) => {
        const pa = layout.get(e.a);
        const pb = layout.get(e.b);
        if (!pa || !pb) return null;
        const isSelected =
          selectedId !== null && (e.a === selectedId || e.b === selectedId);
        const color = isSelected
          ? "var(--accent)"
          : "var(--bg-border)";
        const width = isSelected ? 2 : 1;
        return (
          <line
            key={`${e.a}-${e.b}-${i}`}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke={color}
            strokeWidth={width}
            strokeDasharray={e.kind === "note_source" ? "3 3" : undefined}
            vectorEffect="non-scaling-stroke"
            style={{ transition: "stroke 0.15s" }}
          />
        );
      })}
    </g>
  );
}

export function NodeLayer({
  nodes,
  layout,
  palette,
  selectedId,
  focusedId,
  matchedIds,
}: {
  nodes: GraphNode[];
  layout: Layout;
  palette: { colorFor(n: GraphNode): PaletteColor };
  selectedId: string | null;
  focusedId: string | null;
  matchedIds: Set<string>;
}) {
  return (
    <g>
      {nodes.map((n) => {
        const p = layout.get(n.id);
        if (!p) return null;
        const color = palette.colorFor(n);
        const isSelected = selectedId === n.id;
        const isCenter = focusedId === n.id;
        const isMatch = matchedIds.has(n.id);
        const strokeWidth = isCenter ? 4 : isSelected ? 3 : 2;
        // Selection / focus / search-match all highlight with --accent
        // (the app-wide highlight), kept independent of the node's
        // categorical color. See DESIGN.md §2.4.
        const filter = isMatch
          ? "drop-shadow(0 0 12px var(--accent))"
          : isSelected || isCenter
            ? `drop-shadow(0 0 ${isCenter ? 14 : 8}px var(--accent))`
            : undefined;
        const className = [
          "lg-node",
          isSelected && "is-selected",
          isCenter && "is-center",
          isMatch && "is-match",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <g
            key={n.id}
            className={className}
            data-node-id={n.id}
            transform={`translate(${p.x},${p.y})`}
            cursor="pointer"
            style={
              {
                "--r": String(screenCircleR(n.relation_count)),
                "--rh": String(screenHitR(n.relation_count)),
              } as CSSProperties
            }
          >
            <circle className="lg-hit" fill="transparent" stroke="none" />
            <circle
              className="lg-body"
              fill={color.fill}
              stroke={color.stroke}
              strokeWidth={strokeWidth}
              vectorEffect="non-scaling-stroke"
              style={{ filter, pointerEvents: "none" }}
            />
            <text
              textAnchor="middle"
              style={{
                fill:
                  isSelected || isCenter || isMatch
                    ? "var(--text-primary)"
                    : "var(--text-muted)",
                fontWeight: isSelected || isCenter ? 500 : 400,
                pointerEvents: "none",
                paintOrder: "stroke",
                stroke: "var(--bg-card)",
                strokeLinejoin: "round",
              }}
            >
              {n.title.length > 24 ? n.title.slice(0, 23) + "…" : n.title}
            </text>
          </g>
        );
      })}
    </g>
  );
}
