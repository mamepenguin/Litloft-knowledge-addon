/**
 * Color tokens for the connections graph by colorBy mode.
 *
 * Returns Tailwind-style HSL values. The component uses inline styles
 * (fill + stroke) because we have to color hundreds of nodes
 * dynamically — generating per-token CSS classes is overkill.
 *
 * Each token returns { fill, stroke } so node circles get a faint tinted
 * fill and a saturated stroke. The stroke is also used as the
 * drop-shadow color via SVG's `color` cascade.
 */
import type { GraphMimeKind, GraphNode } from "../api";

export type ColorBy = "kind" | "tag" | "folder" | "flat";

export interface PaletteColor {
  fill: string;
  stroke: string;
}

const MUTED: PaletteColor = {
  fill: "rgba(140,148,163,0.18)",
  stroke: "var(--text-muted, #8b94a3)",
};

const KIND_PALETTE: Record<GraphMimeKind, PaletteColor> = {
  md:    { fill: "rgba(96,165,250,0.18)", stroke: "#60a5fa" },
  video: { fill: "rgba(45,212,191,0.18)", stroke: "#2dd4bf" },
  image: { fill: "rgba(245,158,11,0.18)", stroke: "#f59e0b" },
  pdf:   { fill: "rgba(167,139,250,0.18)", stroke: "#a78bfa" },
  other: { fill: "rgba(251,113,133,0.14)", stroke: "#fb7185" },
};

// Up to 6 distinct tag/folder palettes; everything else falls back to muted.
// Picked from the same hue family as the kind palette to stay visually coherent.
const ROTATIONAL_PALETTE: PaletteColor[] = [
  { fill: "rgba(167,139,250,0.18)", stroke: "#a78bfa" },
  { fill: "rgba(34,211,238,0.18)",  stroke: "#22d3ee" },
  { fill: "rgba(52,211,153,0.18)",  stroke: "#34d399" },
  { fill: "rgba(245,158,11,0.18)",  stroke: "#f59e0b" },
  { fill: "rgba(96,165,250,0.18)",  stroke: "#60a5fa" },
  { fill: "rgba(251,113,133,0.18)", stroke: "#fb7185" },
];

/**
 * Compute a stable group→color mapping by frequency: the top N groups
 * (tags / folders) get distinct colors, everything else is muted.
 */
function topGroups(values: string[], limit: number): Map<string, PaletteColor> {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const ordered = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
  return new Map(
    ordered.map(([name], i) => [name, ROTATIONAL_PALETTE[i]!]),
  );
}

export interface Palette {
  colorFor(node: GraphNode): PaletteColor;
  legend(): { label: string; color: PaletteColor }[];
}

export function buildPalette(nodes: GraphNode[], mode: ColorBy): Palette {
  if (mode === "kind") {
    return {
      colorFor: (n) => KIND_PALETTE[n.mime_kind] ?? MUTED,
      legend: () => [
        { label: "Markdown", color: KIND_PALETTE.md },
        { label: "Video",    color: KIND_PALETTE.video },
        { label: "Image",    color: KIND_PALETTE.image },
        { label: "PDF",      color: KIND_PALETTE.pdf },
        { label: "Other",    color: KIND_PALETTE.other },
      ],
    };
  }
  if (mode === "tag") {
    const tags = nodes.flatMap((n) => n.tags);
    const map = topGroups(tags, ROTATIONAL_PALETTE.length);
    return {
      colorFor: (n) => {
        for (const t of n.tags) {
          const c = map.get(t);
          if (c) return c;
        }
        return MUTED;
      },
      legend: () =>
        Array.from(map.entries()).map(([name, color]) => ({
          label: `#${name}`,
          color,
        })),
    };
  }
  if (mode === "folder") {
    const folders = nodes.map((n) => n.folder);
    const map = topGroups(folders, ROTATIONAL_PALETTE.length);
    return {
      colorFor: (n) => map.get(n.folder) ?? MUTED,
      legend: () =>
        Array.from(map.entries()).map(([name, color]) => ({
          label: name || "(root)",
          color,
        })),
    };
  }
  // flat
  return {
    colorFor: () => MUTED,
    legend: () => [],
  };
}
