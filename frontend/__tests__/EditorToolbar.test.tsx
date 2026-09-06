import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

import EditorToolbar, {
  FORMAT_ACTIONS,
  FORMAT_SPECS,
  applyEditorAction,
} from "../EditorToolbar";

const SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../EditorToolbar.tsx",
);

function renderToolbar(overrides: Partial<Parameters<typeof EditorToolbar>[0]> = {}) {
  const onAction = vi.fn();
  const onFileLinkRequest = vi.fn();
  const onKeepVersion = vi.fn();
  const onOpenVersionHistory = vi.fn();
  render(
    <EditorToolbar
      onAction={onAction}
      onFileLinkRequest={onFileLinkRequest}
      onKeepVersion={onKeepVersion}
      onOpenVersionHistory={onOpenVersionHistory}
      {...overrides}
    />,
  );
  return { onAction, onFileLinkRequest, onKeepVersion, onOpenVersionHistory };
}

function toolbar(): HTMLElement {
  return screen.getByRole("toolbar");
}

function openMenu() {
  fireEvent.click(
    screen.getByRole("button", { name: "knowledge.editor.toolbar.more" }),
  );
}

/** The lucide component behind each `<svg>`, read off its own class. */
function iconNames(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("svg")).map((svg) => {
    const named = Array.from(svg.classList).find(
      (c) => c.startsWith("lucide-") && c !== "lucide-icon",
    );
    if (!named) throw new Error(`svg with no lucide name: ${svg.outerHTML}`);
    return named;
  });
}

afterEach(cleanup);

describe("EditorToolbar", () => {
  /**
   * Twelve, pinned. The count is the point: the record below is keyed by
   * this array, and the per-action table in `editor.test.ts` walks it, so
   * the only way to add a control without a test is to add it here — where
   * this number stops matching.
   */
  it("offers twelve formatting controls, each with a spec", () => {
    expect(FORMAT_ACTIONS).toHaveLength(12);
    expect(Object.keys(FORMAT_SPECS).sort()).toEqual([...FORMAT_ACTIONS].sort());
  });

  /**
   * Two chain links side by side told a sighted user nothing: `Link` was the
   * Markdown link and `Link2` the `loft://` file reference, and only the
   * accessible name said which was which.
   */
  it("draws no two controls with the same glyph", () => {
    renderToolbar();
    const names = iconNames(toolbar());
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * The toolbar formats a selection. Keeping a version and opening the
   * history act on the whole document, so they sit beside it rather than in
   * it — and `role="toolbar"` is what says where the line falls.
   */
  it("keeps the document-level actions out of the toolbar", () => {
    renderToolbar();
    expect(
      within(toolbar()).queryByRole("button", {
        name: "knowledge.editor.toolbar.keepVersion",
      }),
    ).toBeNull();
    expect(toolbar().textContent).not.toContain("keepVersion");

    openMenu();
    const keep = screen.getByRole("menuitem", {
      name: "knowledge.editor.toolbar.keepVersion",
    });
    expect(toolbar().contains(keep)).toBe(false);
    expect(
      screen.getByRole("menuitem", {
        name: "knowledge.editor.toolbar.versionHistory",
      }),
    ).toBeTruthy();
  });

  /**
   * Every control reaches its handler, whichever side of the threshold it is
   * drawn on. Both halves are in the tree at once — CSS decides which one a
   * given width shows — so this presses each of them exactly where it lives.
   */
  it("routes every formatting control to onAction", () => {
    const { onAction } = renderToolbar();
    const onBar = FORMAT_ACTIONS.filter((id) => FORMAT_SPECS[id].tier === "narrow");
    const inMenu = FORMAT_ACTIONS.filter((id) => FORMAT_SPECS[id].tier !== "narrow");
    expect(onBar).toHaveLength(6);
    // Three come back at the mid bar and three more at the full one; both
    // are in the menu at the narrow width this renders at.
    expect(inMenu).toHaveLength(6);
    expect(FORMAT_ACTIONS.filter((id) => FORMAT_SPECS[id].tier === "mid")).toHaveLength(3);
    expect(FORMAT_ACTIONS.filter((id) => FORMAT_SPECS[id].tier === "full")).toHaveLength(3);

    for (const id of onBar) {
      fireEvent.click(
        within(toolbar()).getByRole("button", {
          name: `knowledge.editor.toolbar.${id}`,
        }),
      );
      expect(onAction).toHaveBeenLastCalledWith(FORMAT_SPECS[id].action);
    }

    for (const id of inMenu) {
      openMenu();
      fireEvent.click(
        screen.getByRole("menuitem", {
          name: `knowledge.editor.toolbar.${id}`,
        }),
      );
      expect(onAction).toHaveBeenLastCalledWith(FORMAT_SPECS[id].action);
    }
    expect(onAction).toHaveBeenCalledTimes(FORMAT_ACTIONS.length);
  });

  it("drops the file-link control when the host cannot answer it", () => {
    renderToolbar({ onFileLinkRequest: undefined });
    expect(
      screen.queryByRole("button", {
        name: "knowledge.editor.toolbar.fileLink",
      }),
    ).toBeNull();
  });

  it("passes disabled down to every control", () => {
    renderToolbar({ disabled: true });
    for (const button of within(toolbar()).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
    openMenu();
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item).toBeDisabled();
    }
  });

  /**
   * DESIGN.md §6 "Disabled (every variant)": a translucent control still
   * says what it said, only dimmer. `Button` owns the treatment now, and
   * the point of adopting it is that this file cannot write its own.
   */
  it("writes no disabled treatment of its own", () => {
    expect(readFileSync(SRC, "utf-8")).not.toContain("disabled:opacity");
  });

  /**
   * The row does not wrap. `00-basis.md`: what will not fit goes into the
   * `…`, and it is the number of controls that gives, not their labels —
   * so nothing here may reintroduce `flex-wrap`.
   */
  it("never wraps its controls onto a second line", () => {
    expect(readFileSync(SRC, "utf-8")).not.toContain("flex-wrap");
  });

  /**
   * Tailwind finds class names by scanning source text, so a name that is
   * assembled at runtime produces no CSS at all — and a tier whose CSS does
   * not exist is a tier that never appears. That is not hypothetical: the
   * first draft of this bar wrote `` `hidden ${NARROW_FLOOR}:contents` ``
   * and the wide half was measured missing at every width.
   *
   * The names must therefore be present verbatim, and no template literal in
   * the file may be building one.
   */
  it("writes its responsive class names where Tailwind can read them", () => {
    const src = readFileSync(SRC, "utf-8");
    for (const cls of [
      "hidden @min-[432px]:contents",
      "hidden @min-[534px]:contents",
      "@min-[432px]:hidden",
      "@min-[534px]:hidden",
      "@min-[432px]:block",
    ]) {
      expect(src).toContain(cls);
    }
    // Comments stripped first: the rule is about what Tailwind scans as
    // code, and the note above the thresholds quotes the broken form on
    // purpose so the next reader knows which shape to avoid.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const assembled = [...code.matchAll(/`[^`]*`/g)]
      .map((m) => m[0])
      .filter((lit) => lit.includes("${") && /@min-\[|:contents|:hidden|:block/.test(lit));
    expect(assembled).toEqual([]);
  });

  /**
   * The bar asks about its own width, not the window's. At a 768px viewport
   * the folder tree opens beside the editor and the bar *narrows* to 473px
   * from 625px at 640px — so a viewport breakpoint would put more controls
   * on a shorter bar. Measured; see the comment on the thresholds.
   */
  it("sizes itself against its container, not the viewport", () => {
    const src = readFileSync(SRC, "utf-8");
    expect(src).toContain("@container");
    expect(src).not.toMatch(/\bsm:(contents|hidden|block)/);
  });

  /**
   * `min-w-0` let the flex children absorb the shortfall: every button
   * measured 29.5px instead of 32px, so "it did not wrap" was true only
   * because they had been squeezed. The count gives, not the size.
   */
  /**
   * `Button` overhangs an icon-only control by 6px a side on a coarse
   * pointer. At this row's 34px pitch two of those overlap by 10px and the
   * later button wins the hit test, so every control silently keeps less
   * than it appears to — the defect `Button.tsx` names and leaves to the
   * caller. Until the row carries a 44px pitch, it does not take the half
   * it cannot support.
   */
  it("takes no hit area it cannot fit between its controls", () => {
    const src = readFileSync(SRC, "utf-8");
    const buttons = (src.match(/iconOnly/g) ?? []).length;
    expect(buttons).toBeGreaterThan(0);
    expect((src.match(/pointer-coarse:before:hidden/g) ?? []).length).toBe(buttons);
  });

  it("lets no control be squeezed instead of dropped", () => {
    const src = readFileSync(SRC, "utf-8");
    expect(src).not.toContain("min-w-0");
    // Every drawn control, and the separators, hold their size.
    expect((src.match(/shrink-0/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("applyEditorAction, per control", () => {
  // One row per entry in FORMAT_ACTIONS, read from the same array the
  // toolbar is drawn from, so a thirteenth control cannot arrive untested.
  const cases: Record<
    (typeof FORMAT_ACTIONS)[number],
    { before: string; selStart: number; selEnd: number; after: string }
  > = {
    h1: { before: "line", selStart: 0, selEnd: 0, after: "# line" },
    h2: { before: "line", selStart: 0, selEnd: 0, after: "## line" },
    h3: { before: "line", selStart: 0, selEnd: 0, after: "### line" },
    bold: { before: "a b", selStart: 2, selEnd: 3, after: "a **b**" },
    italic: { before: "a b", selStart: 2, selEnd: 3, after: "a *b*" },
    strike: { before: "a b", selStart: 2, selEnd: 3, after: "a ~~b~~" },
    list: { before: "item", selStart: 0, selEnd: 0, after: "- item" },
    orderedList: { before: "item", selStart: 0, selEnd: 0, after: "1. item" },
    taskList: { before: "item", selStart: 0, selEnd: 0, after: "- [ ] item" },
    link: { before: "see foo", selStart: 4, selEnd: 7, after: "see [foo](url)" },
    code: { before: "x", selStart: 0, selEnd: 1, after: "\n```\nx\n```\n" },
    quote: { before: "said", selStart: 0, selEnd: 0, after: "> said" },
  };

  it("covers every control the toolbar draws", () => {
    expect(Object.keys(cases).sort()).toEqual([...FORMAT_ACTIONS].sort());
  });

  for (const id of FORMAT_ACTIONS) {
    it(`${id} rewrites the body as documented`, () => {
      const c = cases[id];
      const { text } = applyEditorAction(
        c.before,
        c.selStart,
        c.selEnd,
        FORMAT_SPECS[id].action,
      );
      expect(text).toBe(c.after);
    });
  }
});
