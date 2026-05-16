"use client";

import type { GraphEdge, GraphNode } from "../api";
import type { useGraphLayout } from "./useGraphLayout";
import type { PaletteColor } from "./graphPalette";
import {
  LABEL_SCALE_THRESHOLD,
  circleAttrR,
  hitAttrR,
  labelAttrFont,
} from "./graphGeometry";

type Layout = ReturnType<typeof useGraphLayout>;

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
          ? "var(--accent-teal, #2dd4bf)"
          : "var(--bg-border, #2a2f38)";
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
  filtered,
  matchedIds,
  scale,
}: {
  nodes: GraphNode[];
  layout: Layout;
  palette: { colorFor(n: GraphNode): PaletteColor };
  selectedId: string | null;
  focusedId: string | null;
  filtered: boolean;
  matchedIds: Set<string>;
  scale: number;
}) {
  // When the graph is filtered (search / focus) the visible set is
  // small, so always show labels regardless of zoom. Otherwise fall
  // back to the Obsidian-style zoom threshold.
  const showAllLabels = filtered || scale >= LABEL_SCALE_THRESHOLD;
  const fontAttr = labelAttrFont(scale);
  const gapAttr = 6 / scale;
  return (
    <g>
      {nodes.map((n) => {
        const p = layout.get(n.id);
        if (!p) return null;
        const r = circleAttrR(n.relation_count, scale);
        const color = palette.colorFor(n);
        const isSelected = selectedId === n.id;
        const isCenter = focusedId === n.id;
        const isMatch = matchedIds.has(n.id);
        const strokeWidth = isCenter ? 4 : isSelected ? 3 : 2;
        const filter = isMatch
          ? "drop-shadow(0 0 12px var(--accent-amber, #f59e0b))"
          : isSelected || isCenter
            ? `drop-shadow(0 0 ${isCenter ? 14 : 8}px ${color.stroke})`
            : undefined;
        const showLabel =
          showAllLabels || isSelected || isCenter || isMatch;
        return (
          <g
            key={n.id}
            data-node-id={n.id}
            transform={`translate(${p.x},${p.y})`}
            cursor="pointer"
          >
            <circle
              r={hitAttrR(n.relation_count, scale)}
              fill="transparent"
              stroke="none"
            />
            <circle
              r={r}
              fill={color.fill}
              stroke={color.stroke}
              strokeWidth={strokeWidth}
              vectorEffect="non-scaling-stroke"
              style={{ filter, pointerEvents: "none" }}
            />
            {showLabel && (
              <text
                y={r + gapAttr + fontAttr}
                textAnchor="middle"
                style={{
                  fill: isSelected || isCenter || isMatch
                    ? "var(--text-primary, #e8ebf0)"
                    : "var(--text-muted, #8b94a3)",
                  fontWeight: isSelected || isCenter ? 500 : 400,
                  pointerEvents: "none",
                  fontSize: fontAttr,
                  paintOrder: "stroke",
                  stroke: "var(--bg-card, #1a1d24)",
                  strokeWidth: fontAttr * 0.28,
                  strokeLinejoin: "round",
                }}
              >
                {n.title.length > 24 ? n.title.slice(0, 23) + "…" : n.title}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
