import { afterEach, describe, expect, it } from "vitest";

import {
  hasConflictingSelection,
  libraryHref,
  readClassification,
  readLibraryParams,
  segmentOf,
  selectionOf,
  writeClassification,
} from "../libraryUrl";

const read = (query: string) => readLibraryParams(new URLSearchParams(query));

afterEach(() => window.localStorage.clear());

describe("SPEC-ADDON-132 Library step 1: the segment shown", () => {
  it.each([
    ["view=all&tag=ai", "folder", "tag"],
    ["view=all&folder=Notes", "tag", "folder"],
    ["view=all&folder=", "tag", "folder"],
    ["view=all", "tag", "tag"],
    ["view=all", "folder", "folder"],
    // Both in the URL: Tags is shown whatever is stored.
    ["view=all&tag=ai&folder=Notes", "folder", "tag"],
  ] as const)("%s with %s stored shows %s", (query, stored, expected) => {
    expect(segmentOf(read(query), stored)).toBe(expected);
  });

  it("reads the empty folder as the drive root and no folder as All", () => {
    expect(selectionOf(read("view=all&folder="))).toEqual({ kind: "folder", path: "" });
    expect(selectionOf(read("view=all"))).toEqual({ kind: "all" });
  });

  it("selects the tag when the URL names both, and says the URL must be repaired", () => {
    expect(selectionOf(read("tag=ai&folder=Notes"))).toEqual({ kind: "tag", name: "ai" });
    expect(hasConflictingSelection(new URLSearchParams("tag=ai&folder=Notes"))).toBe(true);
    expect(hasConflictingSelection(new URLSearchParams("tag=ai"))).toBe(false);
    expect(hasConflictingSelection(new URLSearchParams("folder="))).toBe(false);
  });
});

describe("SPEC-ADDON-132 Library step 1-2: the URL a change writes", () => {
  const base = new URLSearchParams("view=all&folder=Notes&sort=title&q=x&note=n1");

  it("a segment change removes folder, tag and note and keeps sort and search", () => {
    const href = libraryHref("/p", base, { folder: null, tag: null, note: null });
    expect(href).toBe("/p?view=all&sort=title&q=x");
  });

  it("a selection change removes the note and writes the root as an empty folder", () => {
    expect(libraryHref("/p", base, { folder: "", tag: null, note: null })).toBe(
      "/p?view=all&folder=&sort=title&q=x",
    );
  });

  it("leaves the default sort and an empty search out of the URL", () => {
    expect(libraryHref("/p", base, { sort: "updated", q: "  ", note: null })).toBe("/p?view=all&folder=Notes");
  });

  it("keeps parameters the Library does not own", () => {
    expect(libraryHref("/p", new URLSearchParams("view=all&other=1"), { note: "n2" })).toBe(
      "/p?view=all&other=1&note=n2",
    );
  });

  it("falls back to the default sort for an unknown value", () => {
    expect(read("sort=nope").sort).toBe("updated");
    expect(read("sort=created").sort).toBe("created");
  });
});

describe("SPEC-ADDON-132 I9: the stored segment", () => {
  it("defaults to folders, round-trips, and ignores other values", () => {
    expect(readClassification("d")).toBe("folder");
    writeClassification("d", "tag");
    expect(window.localStorage.getItem("litloft.addon.knowledge.classification.d")).toBe("tag");
    expect(readClassification("d")).toBe("tag");
    expect(readClassification("other")).toBe("folder");
    window.localStorage.setItem("litloft.addon.knowledge.classification.d", "junk");
    expect(readClassification("d")).toBe("folder");
  });
});
