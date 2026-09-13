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

/**
 * How many source files this addon has, so the walk cannot narrow in
 * silence. `toBe`, per `review-workflow.md` rule 1: a floor tolerates
 * losing most of the tree and still reads as a guard.
 */
const FILE_COUNT = 40;
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
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/**
 * What a popup **is**, in two independent spellings — core's definition,
 * copied because the two repositories cannot share a test helper.
 *
 * Earlier rounds defined this by how a popup dismissed itself, and each
 * round one was missed: dismissal is the property being fixed, so the
 * broken ones are exactly the ones that do not match. The second needle is
 * geometry — `top-full` / `bottom-full`, how an anchored surface is drawn
 * against the edge of the control that opened it — which no dismissal
 * style can hide.
 *
 * The array is the definition: the alternation is joined from it and the
 * cases below iterate it, so a spelling cannot leave one without leaving
 * the other.
 *
 * That sentence shipped here once while the file had no such cases, and
 * five of the eight spellings were deletable in silence. They exist now.
 *
 * **Two of the spellings name core identifiers rather than classes.** A
 * knowledge component that adopts core's shared menu surface writes
 * `useMenuSurface`, and one that takes the shared corner table writes
 * `ANCHORED_VERTICAL` — neither renders `top-full` anywhere in this
 * repository, so a scan for the classes alone would put such a file in the
 * population of nothing. `EditorToolbar` is already the case that makes
 * this concrete: its `…` menu is core's `<OverflowMenu>`, whose direction
 * has been measured rather than declared since core's sweep, and this
 * repository holds no line of the geometry that decides it.
 */
const NEEDLES = [
  'role="menu"',
  'role="menuitem',
  'role="listbox"',
  'role="option"',
  'role="dialog"',
  "aria-haspopup",
  "top-full",
  "bottom-full",
  "useMenuSurface",
  "ANCHORED_VERTICAL",
] as const;

const POPUP_NEEDLE = new RegExp(NEEDLES.join("|"));

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

  // Modal surfaces, here because `role="dialog"` is in the needle set.
  // None is an anchored popup: each paints its own backdrop over the
  // whole viewport and is dismissed by that backdrop or by Escape, with
  // nothing behind it a stray click could reach. Enumerated rather than
  // excluded by a path rule, so one that grows a menu inside it is
  // already named.
  "BookmarkletDialog.tsx": {
    dismissedIn: null,
    why: "a modal dialog with its own backdrop",
  },
  "CaptureBasket.tsx": {
    dismissedIn: null,
    why: "a modal panel with its own backdrop",
  },
  "ClipDuplicateDialog.tsx": {
    dismissedIn: null,
    why: "a modal dialog with its own backdrop",
  },
  "ClipWebPageDialog.tsx": {
    dismissedIn: null,
    why: "a modal dialog with its own backdrop",
  },
  "FileLinkModal.tsx": {
    dismissedIn: null,
    why: "a modal dialog with its own backdrop",
  },
  "UnresolvedLinkDialog.tsx": {
    dismissedIn: null,
    why: "a modal dialog with its own backdrop",
  },
};

/**
 * A `document`- or `window`-level pointer listener.
 *
 * A listener on a specific element is a gesture on that element and is
 * out of scope: the graph canvas binds one to pan.
 *
 * `click` is in the alternation for the reason core's copy records: a
 * `click` listener at this scope *looks* right and fails the same way a
 * press one does, because `window` is not in front of anything. The popup
 * closes and the element under the finger receives the very same click.
 */
const GLOBAL_POINTER_LISTENER =
  /\b(?:document|window)\.addEventListener\(\s*["'](?:click|mousedown|pointerdown|touchstart)["']/g;

function globalPointerListeners(roots: string[] = [ADDON_ROOT]): string[] {
  const found: string[] = [];
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf-8");
      const rel = relative(ADDON_ROOT, file);
      for (const m of text.matchAll(GLOBAL_POINTER_LISTENER)) {
        found.push(`${rel}:${text.slice(0, m.index!).split("\n").length}`);
      }
    }
  }
  return [...new Set(found)].sort();
}

/**
 * A whole, well-formed declaration for each needle.
 *
 * The keys are checked against `NEEDLES` below, and each case asserts that
 * the declaration it runs contains its own needle. Without the second half
 * the table was pinned on neither axis: the case writes the fixture and
 * asserts it lands in `popupFiles`, which says it is *a* popup and never
 * that this spelling is why — measured, setting all nine values to
 * `role="menu"` left nine green "is found by" cases, eight of them
 * measuring a spelling they are not named for. The two core identifiers
 * are the worst of them, because this declaration is each one's only
 * exercise anywhere in this repository — no knowledge component calls
 * `useMenuSurface` or reads `ANCHORED_VERTICAL` today, which is exactly
 * the state the needle exists to cover: the first one that does must not
 * arrive unseen.
 */
const NEEDLE_DECLARATIONS: Record<(typeof NEEDLES)[number], string> = {
  'role="menu"': 'role="menu"',
  'role="menuitem': 'role="menuitemradio"',
  'role="listbox"': 'role="listbox"',
  'role="option"': 'role="option"',
  'role="dialog"': 'role="dialog"',
  "aria-haspopup": 'aria-haspopup="menu"',
  "top-full": 'className="absolute top-full"',
  "bottom-full": 'className="absolute bottom-full"',
  useMenuSurface: "const surface = useMenuSurface(open);",
  ANCHORED_VERTICAL: "className={ANCHORED_VERTICAL[1].down}",
};

describe("Every popup surface in the knowledge addon", () => {
  it("defines its population in one place", () => {
    expect(NEEDLES).toHaveLength(10);
    expect(Object.keys(NEEDLE_DECLARATIONS).sort()).toEqual([...NEEDLES].sort());
  });

  it.each(
    NEEDLES.map((needle) => [needle, NEEDLE_DECLARATIONS[needle]]),
  )("is found by %s", (needle, declaration) => {
    // Without a case of its own a spelling is a branch that could be
    // deleted with every other assertion green. Measured in this file
    // before these existed: five of eight were.
    //
    // The needle first: `role="menuitem` is a prefix, satisfied by the
    // `role="menuitemradio"` the declaration writes.
    expect(declaration).toContain(needle);

    const dir = mkdtempSync(join(tmpdir(), "knowledge-popup-needle-"));
    const file = join(dir, "Sample.tsx");
    writeFileSync(file, `export const x = <div ${declaration} />;\n`);
    try {
      expect(popupFiles([dir])).toEqual([relative(ADDON_ROOT, file)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
    expect(globalPointerListeners()).toEqual([]);
  });

  it("looks at the whole tree it claims to", () => {
    // `toBe`, not a bound: a scan quietly narrowed to one directory
    // reports the same empty list as a scan that found nothing, and a
    // floor tolerates most of the narrowing. Core's copy carries the same
    // number for the same reason, and the price is the same — adding a
    // source file here edits this line.
    expect(sourceFiles(ADDON_ROOT).length).toBe(FILE_COUNT);
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
      expect(globalPointerListeners([dir])).toEqual([
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
      expect(globalPointerListeners([dir])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
