/** SPEC-ADDON-139 steps 10 and 11: what the URL says, and where an unreadable one goes. */
import { describe, expect, it } from "vitest";

import {
  backTarget,
  clipsHref,
  needsRewrite,
  parseShelfId,
  readClipsView,
  rewrittenHref,
  shelfIdString,
} from "../clipsUrl";

const PATH = "/drive/d/addons/knowledge/clips";
const sp = (query: string) => new URLSearchParams(query);

describe("SPEC-ADDON-139 reading the URL", () => {
  it.each([
    ["", { view: "home" }],
    ["view=all", { view: "library", group: "tags", sort: "newest" }],
    ["view=all&group=none&sort=title", { view: "library", group: "none", sort: "title" }],
    ["view=all&group=folders&sort=random", { view: "library", group: "tags", sort: "newest" }],
    ["view=bogus", { view: "home" }],
    ["view=shelf", { view: "home" }],
    ["view=shelf&shelf=nope", { view: "home" }],
    ["view=shelf&shelf=unverified", { view: "shelf", shelf: { kind: "unverified" }, sort: "newest" }],
    ["view=shelf&shelf=tag%3Asoup&sort=oldest", { view: "shelf", shelf: { kind: "tag", name: "soup" }, sort: "oldest" }],
    ["view=shelf&shelf=tag%3Aa%3Ab", { view: "shelf", shelf: { kind: "tag", name: "a:b" }, sort: "newest" }],
    ["view=shelf&shelf=tag%3A", { view: "home" }],
  ])("reads %s", (query, want) => {
    expect(readClipsView(sp(query))).toEqual(want);
  });

  it.each([
    ["view=all&group=folders", true],
    ["view=all&sort=random", true],
    ["view=shelf&shelf=nope", true],
    ["view=shelf&shelf=untagged&sort=random", true],
    ["view=all", false],
    ["view=all&group=none&sort=title", false],
    ["", false],
    ["prefill=https%3A%2F%2Fexample.com", false],
  ])("says %s needs a rewrite: %s", (query, want) => {
    expect(needsRewrite(sp(query))).toBe(want);
  });

  it("replaces an unknown value with the default and an unknown shelf with Home", () => {
    expect(rewrittenHref(PATH, sp("view=all&group=folders&sort=title"))).toBe(`${PATH}?view=all&group=tags&sort=title`);
    expect(rewrittenHref(PATH, sp("view=shelf&shelf=nope"))).toBe(PATH);
  });

  it.each(["unread", "recent", "new", "unverified", "untagged", "tag:soup"])("round-trips the shelf id %s", (id) => {
    expect(shelfIdString(parseShelfId(id)!)).toBe(id);
  });
});

describe("SPEC-ADDON-139 writing the URL", () => {
  it("writes Home as the bare path and the Library with its menus", () => {
    expect(clipsHref(PATH, { view: "home" })).toBe(PATH);
    expect(clipsHref(PATH, { view: "library", group: "none", sort: "oldest" })).toBe(`${PATH}?view=all&group=none&sort=oldest`);
  });

  it("carries the sort only on the shelf pages that follow it", () => {
    expect(clipsHref(PATH, { view: "shelf", shelf: { kind: "tag", name: "soup" }, sort: "title" })).toBe(
      `${PATH}?view=shelf&shelf=tag%3Asoup&sort=title`,
    );
    expect(clipsHref(PATH, { view: "shelf", shelf: { kind: "unverified" }, sort: "title" })).toBe(`${PATH}?view=shelf&shelf=unverified`);
  });

  it("goes back to the Library for a tag shelf and to Home for the others", () => {
    expect(backTarget({ kind: "untagged" }, "title")).toEqual({ view: "library", group: "tags", sort: "title" });
    expect(backTarget({ kind: "tag", name: "x" }, "oldest")).toEqual({ view: "library", group: "tags", sort: "oldest" });
    expect(backTarget({ kind: "recent" }, "title")).toEqual({ view: "home" });
  });
});
