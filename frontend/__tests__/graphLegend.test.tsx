import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { stripComments } from "@/__tests__/helpers/sourceScan";

import { buildPalette, type ColorBy } from "../graph/graphPalette";
import type { GraphNode } from "../api";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import ConnectionsGraph from "../ConnectionsGraph";

const HERE = dirname(fileURLToPath(import.meta.url));
const PALETTE_SRC = resolve(HERE, "../graph/graphPalette.ts");

const nodes: GraphNode[] = [
  {
    id: "fA",
    title: "Note A",
    path: "a.md",
    mime_kind: "md",
    folder: "",
    tags: ["llm"],
    relation_count: 1,
  },
  {
    id: "fB",
    title: "Clip B",
    path: "b.mp4",
    mime_kind: "video",
    folder: "media",
    tags: [],
    relation_count: 1,
  },
];

function stubGraphFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    })) as unknown as typeof fetch,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("graph legend labels", () => {
  /**
   * The labels this module owns leave as keys, never as text.
   *
   * `i18n-keys.test.ts` compares catalogue against catalogue, so a label
   * that never reached a catalogue is invisible to it: the kind legend read
   * "Markdown / Video / Image / PDF / Other" in a Japanese UI for four
   * months with every i18n check green.
   */
  it("gives every kind swatch a key and no literal text", () => {
    const legend = buildPalette(nodes, "kind").legend();
    expect(legend).toHaveLength(5);
    for (const entry of legend) {
      expect(entry.labelKey).toMatch(/^legend\.kind\./);
      expect(entry.label).toBeUndefined();
    }
    expect(legend.map((e) => e.labelKey)).toEqual([
      "legend.kind.md",
      "legend.kind.video",
      "legend.kind.image",
      "legend.kind.pdf",
      "legend.kind.other",
    ]);
  });

  /**
   * Data-derived labels are the other half: a tag or a folder name is the
   * user's own text and must arrive verbatim. Asserting only the keys would
   * pass a palette that translated everything, including the folder names.
   */
  it("passes tag and folder names through as text, and names only the root", () => {
    const tags = buildPalette(nodes, "tag").legend();
    expect(tags).toEqual([
      { label: "#llm", color: expect.anything() },
    ]);

    const folders = buildPalette(nodes, "folder").legend();
    const root = folders.find((e) => e.labelKey);
    expect(root?.labelKey).toBe("legend.root");
    expect(folders.find((e) => e.label)?.label).toBe("media");
  });

  it("leaves flat mode without a legend", () => {
    expect(buildPalette(nodes, "flat").legend()).toEqual([]);
  });

  /**
   * The four strings this change removed, named individually.
   *
   * A structural check on `legend()` alone would still pass if one of them
   * came back somewhere else in the file — a `title`, a tooltip, a default.
   */
  it("holds no English display text anywhere in the palette", () => {
    // Comments are blanked first: this file's own prose explains why
    // `"(root)"` was removed, and a scan that cannot tell an explanation
    // from the thing explained fails on its own documentation.
    const src = stripComments(readFileSync(PALETTE_SRC, "utf-8"));
    for (const literal of ['"Video"', '"Image"', '"Other"', '"(root)"', '"Markdown"']) {
      expect(src).not.toContain(literal);
    }
  });
});

describe("ConnectionsGraph legend", () => {
  it("renders the translated kind labels against --graph-cat swatches", async () => {
    stubGraphFetch({
      nodes,
      edges: [{ a: "fA", b: "fB", kind: "note_source" }],
      orphan_count: 0,
      orphans: [],
    });
    render(<ConnectionsGraph drive="test-drive" />);

    // `kind` is the default colorBy, so the legend is up without a click.
    await waitFor(() => {
      expect(screen.getByText("legend.kind.md")).toBeTruthy();
    });
    for (const key of [
      "legend.kind.video",
      "legend.kind.image",
      "legend.kind.pdf",
      "legend.kind.other",
    ]) {
      expect(screen.getByText(key)).toBeTruthy();
    }

    // The colours stay on the chart-only categorical scale. hako:
    // deep semantic accent tokens cannot stand in for a categorical
    // scale, so a swatch that stopped naming `--graph-cat-` would be a
    // palette change hiding inside a labelling change.
    const swatch = screen
      .getByText("legend.kind.md")
      .parentElement!.querySelector("span")! as HTMLElement;
    expect(swatch.style.borderColor).toContain("var(--graph-cat-");
    expect(swatch.style.backgroundColor).toContain("var(--graph-cat-");
  });
});
