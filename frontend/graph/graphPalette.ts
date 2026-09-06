/**
 * Color tokens for the connections graph by colorBy mode.
 *
 * Colors come from the DESIGN.md §2.4 chart-only categorical scale
 * (`--graph-cat-1..6`) — a sanctioned, warm-anchored data-viz palette,
 * NOT the brand tokens. The component applies these as inline SVG
 * fill/stroke because we color hundreds of nodes dynamically; per-token
 * CSS classes would be overkill. Faint fills are derived from the same
 * token via `color-mix` so light/dark theming stays automatic and no
 * separate tint is hand-picked.
 */
import type { GraphMimeKind, GraphNode } from "../api";

export type ColorBy = "kind" | "tag" | "folder" | "flat";

export interface PaletteColor {
  fill: string;
  stroke: string;
}

function cat(n: 1 | 2 | 3 | 4 | 5 | 6): PaletteColor {
  return {
    fill: `color-mix(in srgb, var(--graph-cat-${n}) 16%, transparent)`,
    stroke: `var(--graph-cat-${n})`,
  };
}

// "Everything else" / flat mode. Uses the muted text token (not a 7th
// hue) per DESIGN.md §2.4.
const MUTED: PaletteColor = {
  fill: "color-mix(in srgb, var(--text-muted) 18%, transparent)",
  stroke: "var(--text-muted)",
};

const KIND_PALETTE: Record<GraphMimeKind, PaletteColor> = {
  md: cat(1), // coral
  video: cat(2), // green
  image: cat(3), // ochre
  pdf: cat(4), // plum
  other: cat(5), // olive
};

// Up to 6 distinct tag/folder palettes; everything else falls back to muted.
const ROTATIONAL_PALETTE: PaletteColor[] = [
  cat(1),
  cat(2),
  cat(3),
  cat(4),
  cat(5),
  cat(6),
];

/**
 * Compute a stable group→color mapping by frequency: the top N groups
 * (tags / folders) get distinct colors, everything else is muted.
 *
 * `includeEmpty` is for folder mode, where `""` is the drive root — a real
 * place holding real files, and usually the busiest one. Skipping it left
 * every root file muted and absent from the legend, which is also why the
 * `"(root)"` label this file used to carry was never once drawn.
 * A tag is never empty in the same sense, so tag mode keeps the skip.
 */
function topGroups(
  values: string[],
  limit: number,
  includeEmpty = false,
): Map<string, PaletteColor> {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v && !includeEmpty) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const ordered = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
  return new Map(
    ordered.map(([name], i) => [name, ROTATIONAL_PALETTE[i]!]),
  );
}

/**
 * One swatch in the legend.
 *
 * The palette is a pure function and cannot call `useTranslations`, so the
 * labels this module owns travel as keys and the component resolves them.
 * Labels that come from the data — a tag, a folder name — travel as text,
 * because there is nothing to translate. Exactly one of the two is set.
 *
 * `labelKey` is relative to the `knowledge.connections` namespace, which is
 * the one the graph component holds.
 */
export interface LegendEntry {
  labelKey?: string;
  label?: string;
  color: PaletteColor;
}

export interface Palette {
  colorFor(node: GraphNode): PaletteColor;
  legend(): LegendEntry[];
}

/**
 * Read off `KIND_PALETTE` rather than written out again, so a sixth kind
 * cannot appear in the picture with no swatch to name it.
 */
const KIND_LEGEND_KEY: Record<GraphMimeKind, string> = {
  md: "legend.kind.md",
  video: "legend.kind.video",
  image: "legend.kind.image",
  pdf: "legend.kind.pdf",
  other: "legend.kind.other",
};

export function buildPalette(nodes: GraphNode[], mode: ColorBy): Palette {
  if (mode === "kind") {
    return {
      colorFor: (n) => KIND_PALETTE[n.mime_kind] ?? MUTED,
      legend: () =>
        (Object.keys(KIND_PALETTE) as GraphMimeKind[]).map((kind) => ({
          labelKey: KIND_LEGEND_KEY[kind],
          color: KIND_PALETTE[kind],
        })),
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
    const map = topGroups(folders, ROTATIONAL_PALETTE.length, true);
    return {
      colorFor: (n) => map.get(n.folder) ?? MUTED,
      legend: () =>
        Array.from(map.entries()).map(([name, color]) =>
          name
            ? { label: name, color }
            : { labelKey: "legend.root", color },
        ),
    };
  }
  // flat
  return {
    colorFor: () => MUTED,
    legend: () => [],
  };
}
