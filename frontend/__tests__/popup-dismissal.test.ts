import { describe, it, expect } from "vitest";
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve, dirname, relative } from "node:path";

/**
 * Every popup in this addon is dismissed by core's primitive, on the
 * click.
 *
 * `WikiLinkAutocomplete` closed from a capturing `mousedown` /
 * `touchstart` on `document`. That answers on the *press*, so the scrim
 * — there was none — could not be there to receive the `click` a browser
 * synthesises after `touchend`, and the tap that dismissed the candidate
 * list went on to press whatever was under the finger. On a phone the
 * list is drawn over the note being edited and over the page around it,
 * so the finger usually was over something. A mouse hid nothing here:
 * `mousedown` closed it and the `click` landed either way.
 *
 * ## This repository's own copy, deliberately
 *
 * Core carries the same scan over `frontend/src`, and stops there. It
 * cannot reach in here and stay honest: between this repository merging a
 * fix and core pinning the new commit, core's checkout holds the old
 * file, so core would have to assert a set that admits both states — a
 * lower bound, which is the one thing a detector must not be. So the
 * scan is per repository, and this is knowledge's.
 *
 * ## What this claims, and what it cannot
 *
 * Source text, read in node with nothing rendered. Whether the scrim is
 * the element a real tap lands on, and whether the control underneath is
 * spared, is measured with a real touch in Chromium by core's
 * `e2e-layout/popup-dismiss.spec.ts`.
 */

const ADDON_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = resolve(d, entry.name);
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      if (entry.name === "__tests__" || /\.test\.tsx?$/.test(entry.name)) continue;
      if (!existsSync(full)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && full !== SELF) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * The file with its comments removed.
 *
 * The needles below are attribute spellings, and a docstring that names
 * one is describing a popup rather than declaring one. Measured in core:
 * deleting every ARIA attribute from `SortButton` left it in the
 * population, because a comment beside the rows quotes `role="menu"`
 * while explaining why they carry a role at all. The population would
 * then have rested on a sentence.
 */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

/**
 * What makes a file part of this population — core's needle set, copied
 * because the two repositories cannot share a test helper.
 *
 * The ARIA a popup surface declares, plus the attribute its trigger
 * carries. Wider than "things that render a scrim" on purpose: a new
 * menu matches one of these before it has a scrim, which is when the
 * failure is useful.
 */
const POPUP_NEEDLE = /role="menu"|role="menuitem"|role="listbox"|aria-haspopup/;

function popupFiles(roots: string[] = [ADDON_ROOT]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      if (POPUP_NEEDLE.test(withoutComments(readFileSync(file, "utf-8")))) {
        out.push(relative(ADDON_ROOT, file));
      }
    }
  }
  return out.sort();
}

interface PopupEntry {
  /** The file rendering this popup's `DismissScrim`, or `null` if it is not one. */
  dismissedIn: string | null;
  why: string;
}

const POPUPS: Record<string, PopupEntry> = {
  "WikiLinkAutocomplete.tsx": {
    dismissedIn: "WikiLinkAutocomplete.tsx",
    why: "the `[[` candidate list in the note editor",
  },
};

/**
 * A `document`- or `window`-level listener for a pointer *press*.
 *
 * A listener on a specific element is a gesture on that element and is
 * out of scope: the graph canvas binds one to pan.
 */
const OUTSIDE_PRESS =
  /\b(?:document|window)\.addEventListener\(\s*["'](?:mousedown|pointerdown|touchstart)["']/g;

function outsidePressListeners(roots: string[] = [ADDON_ROOT]): string[] {
  const found: string[] = [];
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf-8");
      const rel = relative(ADDON_ROOT, file);
      for (const m of text.matchAll(OUTSIDE_PRESS)) {
        found.push(`${rel}:${text.slice(0, m.index!).split("\n").length}`);
      }
    }
  }
  return [...new Set(found)].sort();
}

describe("Every popup surface in the knowledge addon", () => {
  it("is named, with where its dismissal lives", () => {
    expect(popupFiles()).toEqual(Object.keys(POPUPS).sort());
  });

  it("goes through core's DismissScrim", () => {
    const missing = Object.entries(POPUPS)
      .filter(([, e]) => e.dismissedIn !== null)
      .filter(
        ([, e]) =>
          !/<DismissScrim\b/.test(
            withoutComments(readFileSync(resolve(ADDON_ROOT, e.dismissedIn!), "utf-8")),
          ),
      )
      .map(([file]) => file);
    expect(missing).toEqual([]);
  });

  it("is the only thing here rendering a scrim", () => {
    const rendering = sourceFiles(ADDON_ROOT)
      .filter((f) => /<DismissScrim\b/.test(withoutComments(readFileSync(f, "utf-8"))))
      .map((f) => relative(ADDON_ROOT, f))
      .sort();
    const declared = new Set(
      Object.values(POPUPS)
        .map((e) => e.dismissedIn)
        .filter((f): f is string => f !== null),
    );
    expect(rendering).toEqual([...declared].sort());
  });
});

describe("An outside press", () => {
  it("never dismisses a popup here", () => {
    expect(outsidePressListeners()).toEqual([]);
  });

  it("looks at the tree it claims to", () => {
    // A scan that has quietly narrowed to one directory reports the same
    // empty list as a scan that found nothing.
    expect(sourceFiles(ADDON_ROOT).length).toBeGreaterThan(20);
    expect(popupFiles()).toContain("WikiLinkAutocomplete.tsx");
  });

  it("still bites when the pattern comes back", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowledge-popup-scan-"));
    const file = join(dir, "Sample.tsx");
    writeFileSync(
      file,
      [
        "useEffect(() => {",
        "  const onDown = (e: MouseEvent) => {",
        "    if (!ref.current?.contains(e.target as Node)) onClose();",
        "  };",
        '  document.addEventListener("mousedown", onDown, true);',
        "});",
      ].join("\n"),
    );
    try {
      expect(outsidePressListeners([dir])).toEqual([
        `${relative(ADDON_ROOT, file)}:5`,
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not mistake a listener on an element for one on the document", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowledge-popup-scan-"));
    const file = join(dir, "Gesture.tsx");
    writeFileSync(file, 'svg.addEventListener("pointerdown", onDown);\n');
    try {
      expect(outsidePressListeners([dir])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
