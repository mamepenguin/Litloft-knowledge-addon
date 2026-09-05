import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Every module in this addon, reached from something the app can open.
 *
 * Nine components and two test files were deleted in the commit that added
 * this: a whole two-pane view — folder pane, sidebar, its context menu and
 * move dialog, the clip modal, the tag panel — that `Page.tsx` stopped
 * rendering and nothing else ever imported. They were invisible as dead
 * code because their tests kept them green, and they were not free: a
 * design-system migration converted their buttons, a reviewer read them,
 * and core's heading ledger carried an entry for one of them.
 *
 * Reachable means: from the route (`Page.tsx`) or from the slot registry
 * (`slots.ts`), which are the only two ways core reaches into this addon.
 * A module imported by tests alone is exactly the shape that accumulated.
 *
 * **What this cannot see.** Imports it can read are static ones and the
 * `lazy(() => import("./X"))` form the slot registry uses. A path built at
 * runtime would look unreachable; there are none today, and one added later
 * fails here rather than silently — which is the right way round.
 */
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ROOTS = ["Page.tsx", "slots.ts"];

function importsOf(file: string): string[] {
  const text = readFileSync(resolve(DIR, file), "utf-8");
  const out: string[] = [];
  for (const m of text.matchAll(/["']\.\/([A-Za-z0-9_.-]+)["']/g)) {
    out.push(m[1]);
  }
  return out;
}

function resolveModule(spec: string): string | null {
  for (const ext of ["", ".tsx", ".ts"]) {
    const candidate = `${spec}${ext}`;
    if (moduleFiles.has(candidate)) return candidate;
  }
  return null;
}

const moduleFiles = new Set(
  readdirSync(DIR).filter(
    (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
  ),
);

function reachableFrom(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const target = resolveModule(spec);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

const reachable = () => reachableFrom(ROOTS);

describe("the knowledge addon's modules", () => {
  it("are all reachable from the route or the slot registry", () => {
    const seen = reachable();
    const orphans = [...moduleFiles].filter((f) => !seen.has(f)).sort();
    expect(orphans).toEqual([]);
  });

  /**
   * The walk is the part that can quietly stop working, and the assertion
   * above cannot tell: a walk that reaches everything reports no orphans,
   * and so does one that reaches nothing but happens to be compared against
   * an empty set. So the walk is made to discriminate, on the real tree —
   * drop the route from the roots and the dashboard must fall out of reach,
   * because the slot registry does not lead to it.
   */
  it("reaches only what its roots lead to", () => {
    expect(reachable().has("KnowledgeDashboard.tsx")).toBe(true);
    expect(reachableFrom(["slots.ts"]).has("KnowledgeDashboard.tsx")).toBe(
      false,
    );
    // Several hops from a root, not just the roots' own imports.
    expect(reachableFrom(["slots.ts"]).has("Editor.tsx")).toBe(true);
  });
});
