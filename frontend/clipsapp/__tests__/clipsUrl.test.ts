/** SPEC-ADDON-147: what the Clips URL says, and where an unreadable one goes. */
import { describe, expect, it } from "vitest";

import {
  backTarget,
  clipFiltersKey,
  clipsHref,
  hasClipFilters,
  hasUnknownView,
  needsViewFillIn,
  parseShelfId,
  readClipFilters,
  readClipsView,
  rewrittenHref,
  shelfIdString,
} from "../clipsUrl";

const PATH = "/drive/d/addons/knowledge/clips";
const sp = (query: string) => new URLSearchParams(query);

describe("SPEC-ADDON-147 reading the URL", () => {
  it.each([
    ["", { view: "home" }],
    ["view=all", { view: "library", group: "tags", sort: "newest" }],
    ["view=all&group=none&sort=title", { view: "library", group: "none", sort: "title" }],
    ["view=all&group=folder&sort=oldest", { view: "library", group: "folder", sort: "oldest" }],
    ["view=all&group=month", { view: "library", group: "month", sort: "newest" }],
    ["view=all&group=folders&sort=random", { view: "library", group: "tags", sort: "newest" }],
    ["view=bogus", { view: "home" }],
    ["view=shelf", { view: "home" }],
    ["view=shelf&shelf=nope", { view: "home" }],
    ["view=shelf&shelf=unverified", { view: "shelf", shelf: { kind: "unverified" }, sort: "newest" }],
    ["view=shelf&shelf=tag%3Asoup&sort=oldest", { view: "shelf", shelf: { kind: "tag", name: "soup" }, sort: "oldest" }],
    ["view=shelf&shelf=tag%3Aa%3Ab", { view: "shelf", shelf: { kind: "tag", name: "a:b" }, sort: "newest" }],
    ["view=shelf&shelf=tag%3A", { view: "home" }],
    ["view=shelf&shelf=folder%3Aweb%2F", { view: "shelf", shelf: { kind: "folder", key: "web/" }, sort: "newest" }],
    ["view=shelf&shelf=folder%3A", { view: "shelf", shelf: { kind: "folder", key: "" }, sort: "newest" }],
    ["view=shelf&shelf=month%3A2026-11", { view: "shelf", shelf: { kind: "month", key: "2026-11" }, sort: "newest" }],
    ["view=shelf&shelf=month%3A2026-3", { view: "home" }],
  ])("reads %s", (query, want) => {
    expect(readClipsView(sp(query))).toEqual(want);
  });

  it("reads an absent or unknown group and sort as the Target's resolved view", () => {
    const resolved = { group: "folder", sort: "title" } as const;
    expect(readClipsView(sp("view=all"), resolved)).toEqual({ view: "library", group: "folder", sort: "title" });
    expect(readClipsView(sp("view=all&group=shelves&sort=random"), resolved)).toEqual({
      view: "library",
      group: "folder",
      sort: "title",
    });
  });

  it.each([
    ["view=shelf&shelf=nope", true],
    ["view=shelf&shelf=month%3Asoon", true],
    ["view=all&group=folders", false],
    ["view=all&sort=random", false],
    ["view=shelf&shelf=untagged&sort=random", false],
    ["", false],
    ["prefill=https%3A%2F%2Fexample.com", false],
  ])("says %s is an unknown view: %s", (query, want) => {
    expect(hasUnknownView(sp(query))).toBe(want);
  });

  it("fills in what a drawn view lacks", () => {
    expect(needsViewFillIn(sp("view=all"), readClipsView(sp("view=all")))).toBe(true);
    expect(needsViewFillIn(sp("view=all&sort=random"), readClipsView(sp("view=all")))).toBe(true);
    expect(needsViewFillIn(sp("view=all&group=none&sort=title"), readClipsView(sp("view=all")))).toBe(false);
    expect(needsViewFillIn(sp("view=shelf&shelf=untagged"), readClipsView(sp("view=shelf&shelf=untagged")))).toBe(true);
    expect(needsViewFillIn(sp("view=shelf&shelf=unverified"), readClipsView(sp("view=shelf&shelf=unverified")))).toBe(false);
    expect(needsViewFillIn(sp(""), { view: "home" })).toBe(false);
  });

  it("sends an unknown shelf id to Home", () => {
    expect(rewrittenHref(PATH)).toBe(PATH);
  });

  it.each(["unread", "recent", "new", "unverified", "untagged", "tag:soup", "folder:", "folder:a/b", "month:2026-11"])(
    "round-trips the shelf id %s",
    (id) => {
      expect(shelfIdString(parseShelfId(id)!)).toBe(id);
    },
  );
});

describe("SPEC-ADDON-147 writing the URL", () => {
  it("writes Home as the bare path and the Library with its menus", () => {
    expect(clipsHref(PATH, { view: "home" })).toBe(PATH);
    expect(clipsHref(PATH, { view: "library", group: "none", sort: "oldest" })).toBe(`${PATH}?view=all&group=none&sort=oldest`);
  });

  it("carries the sort only on the shelf pages that follow it", () => {
    expect(clipsHref(PATH, { view: "shelf", shelf: { kind: "tag", name: "soup" }, sort: "title" })).toBe(
      `${PATH}?view=shelf&shelf=tag%3Asoup&sort=title`,
    );
    expect(clipsHref(PATH, { view: "shelf", shelf: { kind: "folder", key: "web" }, sort: "oldest" })).toBe(
      `${PATH}?view=shelf&shelf=folder%3Aweb&sort=oldest`,
    );
    expect(clipsHref(PATH, { view: "shelf", shelf: { kind: "unverified" }, sort: "title" })).toBe(`${PATH}?view=shelf&shelf=unverified`);
  });

  it("goes back to the grouping a shelf belongs to, and to Home for the others", () => {
    expect(backTarget({ kind: "untagged" }, "title")).toEqual({ view: "library", group: "tags", sort: "title" });
    expect(backTarget({ kind: "tag", name: "x" }, "oldest")).toEqual({ view: "library", group: "tags", sort: "oldest" });
    expect(backTarget({ kind: "folder", key: "web" }, "title")).toEqual({ view: "library", group: "folder", sort: "title" });
    expect(backTarget({ kind: "month", key: "2026-11" }, "title")).toEqual({ view: "library", group: "month", sort: "title" });
    expect(backTarget({ kind: "recent" }, "title")).toEqual({ view: "home" });
  });
});

describe("SPEC-ADDON-159 the name in the URL", () => {
  it.each([
    ["view=all&q=kyoto", "kyoto"],
    ["view=all&q=%20%20kyoto%20%20", "kyoto"],
    ["view=all&q=%E4%BA%AC%E9%83%BD", "京都"],
    ["view=all&q=%20%20%20", ""],
    ["view=all&q=", ""],
    ["view=all", ""],
    [`view=all&q=${"x".repeat(250)}`, "x".repeat(200)],
    [`view=all&q=${encodeURIComponent(`  ${"a".repeat(199)}  b  `)}`, "a".repeat(199)],
  ])("SPEC-ADDON-159 I6 I10 reads %s as the name %j", (query, name) => {
    expect(readClipFilters(sp(query))).toMatchObject({ name });
  });

  it("SPEC-ADDON-159 I6 a name alone counts as a filter in force, and no name and no tag or trust does not", () => {
    expect(hasClipFilters(readClipFilters(sp("view=all&q=kyoto")))).toBe(true);
    expect(hasClipFilters(readClipFilters(sp("view=all&q=%20")))).toBe(false);
  });

  it("SPEC-ADDON-159 I3 the filters key changes with the name", () => {
    const none = clipFiltersKey(readClipFilters(sp("view=all&tag=trip")));
    const kyoto = clipFiltersKey(readClipFilters(sp("view=all&tag=trip&q=kyoto")));
    const osaka = clipFiltersKey(readClipFilters(sp("view=all&tag=trip&q=osaka")));
    expect(new Set([none, kyoto, osaka]).size).toBe(3);
    expect(clipFiltersKey(readClipFilters(sp("view=all&tag=trip&q=%20kyoto")))).toBe(kyoto);
  });
});
