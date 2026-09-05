import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { stripComments } from "@/__tests__/helpers/sourceScan";

/**
 * Every module in this addon, reached from something that can open it.
 *
 * Eight components, three hooks and their tests were deleted around this:
 * a whole two-pane view — folder pane, sidebar, its context menu and move
 * dialog, the clip modal, the tag panel, the landing panel — that
 * `Page.tsx` stopped rendering and nothing else ever imported. They were
 * invisible as dead code because their own tests kept them green, and they
 * were not free: a design-system migration converted their buttons,
 * reviewers read them, and core's `page-headings.test.ts` carried an
 * allowlist entry for `EmptyState.tsx`, one of the eight.
 *
 * Reachable means: from the route (`Page.tsx`), from the slot registry
 * (`slots.ts`), or from `pages/`, which core mounts as `/addons/{name}/
 * {slug}` sub-routes by building the path at runtime
 * (`frontend/src/app/drive/[name]/addons/[addon]/[slug]/page.tsx`). Those
 * are the three ways in. A module imported by tests alone is exactly the
 * shape that accumulated here.
 *
 * **What this cannot see.** Imports whose path is built at runtime. There
 * are none inside this addon today; one added later reports as unreachable,
 * which is the right way round — it fails rather than passing quietly.
 */
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Exact path first, then `.ts`, then `.tsx`.
 *
 * Which of the last two wins is not pinned by anything, because no `x.ts`
 * and `x.tsx` pair exists in this tree — and the two bundlers that read it
 * disagree, Vite preferring `.ts` and Next `.tsx`. A pair added later gets
 * whichever this picks, and the module that loses is reported unreferenced,
 * which is the loud direction.
 */
const EXTENSIONS = ["", ".ts", ".tsx"];

/**
 * Reachable without an importer, with the reason.
 *
 * Unreferenced is not the same fact as abandoned, and this walk cannot tell
 * them apart — it was about to delete the entry below as an orphan.
 */
const NOT_YET_WIRED: Record<string, string> = {
  // Landed ahead of the listener that opens it. `docs/CODEMAPS/markdown-id.md`
  // §"Open follow-ups" in core holds the missing piece: the click handler the
  // addon attaches to `.wiki-unresolved` in the rendered preview.
  "UnresolvedLinkDialog.tsx": "awaiting its slot-based click handler",
};

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "__tests__" && entry !== "messages") walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(relative(DIR, full));
      }
    }
  };
  walk(DIR);
  return out.sort();
}

const moduleFiles = new Set(sourceFiles());

/**
 * Import specifiers, from the forms that actually import, in code.
 *
 * Comments are stripped first, and that is the load-bearing half: a first
 * version matched every `"./x"` in the file, and a second matched only
 * `from` / `import()` / `require()` — which a comment reading
 * `imported from "./X" by the panel that owns it` still satisfies. Either
 * way a module nothing imports reports as reachable, and that is the miss
 * this test exists to prevent, since it is the silent one.
 */
function importsOf(file: string): string[] {
  const text = stripComments(readFileSync(resolve(DIR, file), "utf-8"));
  const out: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) out.push(m[1]);
  }
  return out;
}

/**
 * Where a specifier lands, or null if it leaves the addon.
 *
 * Both the relative form and core's alias for this addon resolve. The alias
 * appears only in this addon's colocated tests today, which the walk never
 * reads — it is here so that rewriting a module's import into the alias
 * form does not read as a deletion.
 */
function resolveModule(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith(".")) {
    base = relative(DIR, resolve(dirname(resolve(DIR, from)), spec));
  } else if (spec.startsWith("@/addons/knowledge/")) {
    base = spec.slice("@/addons/knowledge/".length);
  } else {
    return null;
  }
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (moduleFiles.has(candidate)) return candidate;
  }
  return null;
}

const ROOTS = [
  "Page.tsx",
  "slots.ts",
  ...[...moduleFiles].filter((f) => f.startsWith("pages/")),
];

function reachableFrom(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const target = resolveModule(spec, file);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

const reachable = () => reachableFrom(ROOTS);

describe("the knowledge addon's modules", () => {
  it("are all reachable from the route, the slots, or a sub-route page", () => {
    const seen = reachable();
    const orphans = [...moduleFiles].filter(
      (f) => !seen.has(f) && !(f in NOT_YET_WIRED),
    );
    expect(orphans).toEqual([]);
  });

  // Exact, because the census is where this can go quietly wrong: narrow
  // the walk to `.tsx` and nine `.ts` modules leave the population without
  // any assertion noticing, since an orphan among them is no longer looked
  // for. Measured 2026-09-06.
  it("counts every module in the addon", () => {
    expect(moduleFiles.size).toBe(33);
    expect([...moduleFiles].filter((f) => f.endsWith(".ts")).length).toBe(9);
  });

  /**
   * The walk itself, which the assertion above cannot check: one that
   * reaches everything reports no orphans, and so does one that reaches
   * nothing but is compared against an empty set. So it is made to
   * discriminate on the real tree — drop the route from the roots and the
   * dashboard must fall out of reach, because the slot registry does not
   * lead to it.
   */
  it("reaches only what its roots lead to", () => {
    expect(reachable().has("KnowledgeDashboard.tsx")).toBe(true);
    expect(reachableFrom(["slots.ts"]).has("KnowledgeDashboard.tsx")).toBe(
      false,
    );
    // Several hops from a root, into a subdirectory, and a `.ts` module —
    // the three shapes the walk has to keep reaching.
    expect(reachableFrom(["slots.ts"]).has("Editor.tsx")).toBe(true);
    expect(reachable().has("graph/GraphControls.tsx")).toBe(true);
    expect(reachable().has("api.ts")).toBe(true);
  });

  // A listed exemption must name a file that exists and is genuinely
  // unreferenced. One that got wired up, or deleted, is a note that reads
  // like a decision while excusing nothing.
  it("keeps the not-yet-wired list honest", () => {
    const seen = reachable();
    const stale = Object.keys(NOT_YET_WIRED).filter(
      (f) => !moduleFiles.has(f) || seen.has(f),
    );
    expect(stale).toEqual([]);
  });
});
