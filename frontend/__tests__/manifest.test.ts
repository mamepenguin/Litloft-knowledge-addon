/**
 * The manifest is data, and data has no type checker.
 *
 * Everything else in this addon is reached through it — core reads the
 * slot ids, looks each one up in `slots.ts` and renders what it finds.
 * A mistake here fails the way `AddonSlot` fails at runtime, which is by
 * rendering nothing at all and saying nothing about it: an id with no
 * component, a component with no id, an entry left behind in the slot it
 * was supposed to move out of.
 *
 * Both sides are read as files, through no shared code, so this cannot
 * launder itself.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { slotComponents } from "../slots";

// `realpathSync` first, because in a dev checkout this file is reached
// through `frontend/src/addons/knowledge`, a symlink to this addon's
// `frontend/`. `path.resolve` is lexical and would walk `..` out of the
// link into core's `src/addons`. CI copies the tree instead of linking
// it, so there the call is a no-op and both layouts land in one place.
const ADDON_ROOT = resolve(
  dirname(realpathSync(fileURLToPath(import.meta.url))),
  "..",
  "..",
);

const manifest = JSON.parse(
  readFileSync(resolve(ADDON_ROOT, "manifest.json"), "utf-8"),
) as { slots: Record<string, { id: string; priority: number }[]> };

const entries = Object.entries(manifest.slots).flatMap(([slot, list]) =>
  list.map((entry) => ({ slot, id: entry.id })),
);

describe("the knowledge manifest", () => {
  it("declares exactly the entries this addon ships", () => {
    // Exact, not a lower bound. The failure worth catching is an entry
    // nobody remembers declaring — under `>=` a stray one is invisible,
    // and a stray one renders on every file detail page.
    expect(entries).toHaveLength(6);
  });

  it("gives every entry a component to render", () => {
    const orphans = entries
      .filter((entry) => !(entry.id in slotComponents))
      .map((entry) => `${entry.slot}/${entry.id}`);
    expect(orphans).toEqual([]);
  });

  it("gives every component an entry that reaches it", () => {
    const declared = new Set(entries.map((entry) => entry.id));
    const unreachable = Object.keys(slotComponents).filter(
      (id) => !declared.has(id),
    );
    expect(unreachable).toEqual([]);
  });

  it("puts the capture action in the file's action row, not under the player", () => {
    // The row below the player held two unlabelled icon buttons and
    // belonged to no group. Core moved its own (the beside/below toggle)
    // into the page row because it is a view control; this one is a
    // per-file action, so it belongs with like, favourite and `[...]` —
    // and with both gone the row below the player has no occupants left
    // and is not drawn at all.
    //
    // A move, not a copy: left in both, it renders in two places and
    // core cannot detect that.
    const slots = entries
      .filter((entry) => entry.id === "knowledge-media-capture")
      .map((entry) => entry.slot);
    expect(slots).toEqual(["file-detail-actions"]);
  });

  it("puts making a note in the overflow menu", () => {
    // It was a card with a heading and a sentence of explanation on
    // every file detail page. Making a note is occasional and
    // deliberate, which is what `[...]` is for.
    const slots = entries
      .filter((entry) => entry.id === "knowledge-create-note")
      .map((entry) => entry.slot);
    expect(slots).toEqual(["file-actions-menu"]);
  });

  it("leaves the editor as the only thing in the file-detail column", () => {
    expect(manifest.slots["file-detail-sections"].map((e) => e.id)).toEqual([
      "knowledge-edit",
    ]);
  });
});
