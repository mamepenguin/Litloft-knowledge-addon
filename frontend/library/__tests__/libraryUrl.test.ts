import { afterEach, describe, expect, it } from "vitest";

import { readTargetView, writeAppTarget, writeTargetView } from "@/lib/appPrefs";

import {
  hasConflictingSelection,
  legacySegment,
  libraryHref,
  readLibraryParams,
  segmentOf,
  selectionOf,
} from "../libraryUrl";

const read = (query: string, sort?: "updated" | "title" | "created") =>
  readLibraryParams(new URLSearchParams(query), sort);

afterEach(() => window.localStorage.clear());

describe("SPEC-ADDON-148 the segment shown", () => {
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

describe("SPEC-ADDON-148 the sort in the URL", () => {
  it("reads a sort the app offers and otherwise takes the Target's", () => {
    expect(read("sort=title").sort).toBe("title");
    expect(read("sort=created").sort).toBe("created");
    expect(read("sort=nope").sort).toBe("updated");
    expect(read("sort=nope", "created").sort).toBe("created");
    expect(read("").sort).toBe("updated");
  });
});

describe("SPEC-ADDON-148 the URL a change writes", () => {
  const base = new URLSearchParams("view=all&folder=Notes&sort=title&q=x&note=n1");

  it("a segment change removes folder, tag and note and keeps sort and search", () => {
    const href = libraryHref("/p", base, { folder: null, tag: null, note: null }, "title");
    expect(href).toBe("/p?view=all&sort=title&q=x");
  });

  it("a selection change removes the note and writes the root as an empty folder", () => {
    expect(libraryHref("/p", base, { folder: "", tag: null, note: null }, "title")).toBe(
      "/p?view=all&folder=&sort=title&q=x",
    );
  });

  it("always names the sort in force, Date Modified included", () => {
    expect(libraryHref("/p", new URLSearchParams("view=all"), {}, "updated")).toBe("/p?view=all&sort=updated");
    expect(libraryHref("/p", new URLSearchParams("view=all&sort=title"), { q: "  " }, "updated")).toBe(
      "/p?view=all&sort=updated",
    );
  });

  it("keeps parameters the Library does not own", () => {
    expect(libraryHref("/p", new URLSearchParams("view=all&other=1"), { note: "n2" }, "updated")).toBe(
      "/p?view=all&other=1&sort=updated&note=n2",
    );
  });
});

describe("SPEC-ADDON-148 the pre-view per-drive segment", () => {
  it("is read only from the old key, which nothing writes any more", () => {
    expect(legacySegment("d")).toBeNull();
    window.localStorage.setItem("litloft.addon.knowledge.classification.d", "tag");
    expect(legacySegment("d")).toBe("tag");
    window.localStorage.setItem("litloft.addon.knowledge.classification.d", "junk");
    expect(legacySegment("d")).toBeNull();
    writeTargetView({ addon: "knowledge" }, "d", "default", { group: "folder" });
    expect(window.localStorage.getItem("litloft.addon.knowledge.classification.d")).toBe("junk");
    expect(readTargetView({ addon: "knowledge" }, "d", "default")).toEqual({ group: "folder" });
  });

  it("encodes the drive as the target key does", () => {
    writeAppTarget("動画 & 音", { addon: "knowledge" }, "x");
    const targetKey = window.localStorage.key(0)!;
    window.localStorage.setItem(targetKey.replace(".target.", ".classification."), "tag");

    expect(legacySegment("動画 & 音")).toBe("tag");
  });
});
