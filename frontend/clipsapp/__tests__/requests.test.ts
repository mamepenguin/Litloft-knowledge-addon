/** SPEC-ADDON-138 step 2 and SPEC-ADDON-139 step 10: the requests every listing sends. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clipConditions, loadShelfPage, loadGroupShelves, loadUnreadAmong, loadClipCount, sortParams } from "../requests";
import type { ReadyNotesTarget } from "../requests";

const calls: { url: URL; method: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://x");
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      const body = url.pathname.endsWith("/watch-history")
        ? { data: [] }
        : url.pathname.endsWith("/files") || url.pathname.endsWith("/files/query")
          ? { data: [], meta: { total: 3, page: 1, limit: 1 } }
          : { by: "all", shelves: [], total_shelves: 0, base: "" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const DEFAULT: ReadyNotesTarget = { status: "ready", key: "default", params: null, fileIds: null };
const MEMBER: ReadyNotesTarget = { status: "ready", key: "member:x:2", params: null, fileIds: ["a", "b"] };
const soups: ReadyNotesTarget = { status: "ready", key: "collection:c", params: { type: ["text"], collection: "Soups", tag: "quick" }, fileIds: null };

describe("SPEC-ADDON-138 clip conditions", () => {
  it("fixes type=text and origin=webclip last, whatever the target carries", () => {
    const widened: ReadyNotesTarget = {
      ...soups,
      params: { ...soups.params, origin: "other", type: ["image"] } as never,
    };
    expect(clipConditions(widened)).toMatchObject({ collection: "Soups", tag: ["quick"], type: "text", origin: "webclip" });
  });

  it("adds the shelf's trust condition", () => {
    expect(clipConditions(DEFAULT, { trust: "unverified" })).toMatchObject({ trust: "unverified", origin: "webclip" });
  });
});

describe("SPEC-ADDON-138 requests", () => {
  it("counts through files for a condition target and through files/query for a member target", async () => {
    await loadClipCount("d", soups);
    await loadClipCount("d", MEMBER);

    expect(calls[0].url.pathname).toBe("/api/drives/d/files");
    expect(calls[0].url.searchParams.get("collection")).toBe("Soups");
    expect(calls[1].url.pathname).toBe("/api/drives/d/files/query");
    expect(calls[1].method).toBe("POST");
    expect(calls[1].body).toEqual({ file_ids: ["a", "b"] });
  });

  it("sends a member target's shelves through shelves/query with its ids", async () => {
    await loadShelfPage("d", MEMBER, { kind: "unread" }, { perShelf: 12, sort: "newest" });

    expect(calls[0].url.pathname).toBe("/api/drives/d/shelves/query");
    expect(calls[0].body).toEqual({ file_ids: ["a", "b"] });
    expect(calls[0].url.searchParams.get("opened")).toBe("false");
  });

  it("asks Recently opened without a target and refuses any other shelf without one", async () => {
    await loadShelfPage("d", null, { kind: "recent" }, { perShelf: 12, sort: "newest" });
    expect(calls[0].url.pathname).toBe("/api/drives/d/watch-history");
    expect(calls[0].url.searchParams.get("limit")).toBe("12");

    await expect(loadShelfPage("d", null, { kind: "unread" }, { perShelf: 12, sort: "newest" })).rejects.toThrow();
  });

  it("caps Recently opened at the route's 50", async () => {
    await loadShelfPage("d", null, { kind: "recent" }, { perShelf: 60, sort: "newest" });
    expect(calls[0].url.searchParams.get("limit")).toBe("50");
  });

  it("follows the sort on every shelf page that sorts, and not on the fixed ones", async () => {
    await loadShelfPage("d", DEFAULT, { kind: "unverified" }, { perShelf: 60, page: 1, sort: "title" });
    await loadShelfPage("d", DEFAULT, { kind: "tag", name: "soup" }, { perShelf: 60, page: 1, sort: "title" });
    await loadShelfPage("d", DEFAULT, { kind: "folder", key: "web" }, { perShelf: 60, page: 1, sort: "oldest" });
    await loadShelfPage("d", DEFAULT, { kind: "month", key: "2026-11" }, { perShelf: 60, page: 1, sort: "title" });

    const [plain, tagged, folder, month] = calls.map((c) => [c.url.searchParams.get("sort"), c.url.searchParams.get("order")]);
    expect(plain).toEqual(["created_at", "desc"]);
    expect(tagged).toEqual(["title", "asc"]);
    expect(folder).toEqual(["created_at", "asc"]);
    expect(month).toEqual(["title", "asc"]);
    expect([calls[2].url.searchParams.get("by"), calls[2].url.searchParams.get("key")]).toEqual(["folder", "web"]);
    expect([calls[3].url.searchParams.get("by"), calls[3].url.searchParams.get("key")]).toEqual(["month", "2026-11"]);
  });

  it("asks the grouped shelves 12 at a time from an offset", async () => {
    await loadGroupShelves("d", DEFAULT, "tag", 12, "oldest");
    await loadGroupShelves("d", DEFAULT, "folder", 24, "newest");
    await loadGroupShelves("d", DEFAULT, "month", 0, "title");

    const p = calls[0].url.searchParams;
    expect(["by", "per_shelf", "shelf_limit", "offset", "sort", "order"].map((k) => p.get(k))).toEqual([
      "tag", "12", "12", "12", "created_at", "asc",
    ]);
    expect(calls[1].url.searchParams.get("by")).toBe("folder");
    expect(calls[1].url.searchParams.get("offset")).toBe("24");
    expect(calls[2].url.searchParams.get("by")).toBe("month");
    expect(calls[2].url.searchParams.get("sort")).toBe("title");
  });

  it("asks the unread dots with the ids and no target conditions", async () => {
    await loadUnreadAmong("d", ["a", "b"]);

    const p = calls[0].url.searchParams;
    expect(p.getAll("ids")).toEqual(["a", "b"]);
    expect(["opened", "per_shelf", "type", "origin"].map((k) => p.get(k))).toEqual(["false", "60", null, null]);
  });

  it.each([
    ["newest", "created_at", "desc"],
    ["oldest", "created_at", "asc"],
    ["title", "title", "asc"],
  ] as const)("maps the %s sort", (sort, field, order) => {
    expect(sortParams(sort)).toEqual({ sort: field, order });
  });
});
