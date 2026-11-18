/** SPEC-ADDON-140 item 13 and SPEC-ADDON-138 step 7: what the page asks once, and what it asks again. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchClipCovers = vi.fn();
const loadUnreadAmong = vi.fn();
vi.mock("../../api", () => ({ fetchClipCovers: (...a: unknown[]) => fetchClipCovers(...a) }));
vi.mock("../requests", async () => {
  const actual = await vi.importActual<typeof import("../requests")>("../requests");
  return { ...actual, loadUnreadAmong: (...a: unknown[]) => loadUnreadAmong(...a) };
});

const { ClipMeta } = await import("../clipMeta");
const { ApiStatusError } = await import("@/lib/apiError");

const flush = () => new Promise((r) => setTimeout(r, 0));
const many = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);

beforeEach(() => {
  fetchClipCovers.mockReset().mockImplementation(async (_d: string, ids: string[]) =>
    Object.fromEntries(ids.filter((id) => id !== "gone").map((id) => [id, { image_id: null, image_url: null, site: `${id}.com` }])),
  );
  loadUnreadAmong.mockReset().mockImplementation(async (_d: string, ids: string[]) => new Set(ids.filter((id) => id.startsWith("u"))));
});

describe("SPEC-ADDON-140 covers", () => {
  it("asks 60 ids at most per request, once per id, and keeps the answers", async () => {
    const meta = new ClipMeta("d", () => {});
    meta.ensure(many(130));
    meta.ensure(many(130));
    await flush();

    expect(fetchClipCovers.mock.calls.map((c) => (c[1] as string[]).length)).toEqual([60, 60, 10]);
    expect(meta.coverOf("id5")?.site).toBe("id5.com");
  });

  it("does not ask again for an id the answer left out, and asks again after a failure only at a refresh", async () => {
    const meta = new ClipMeta("d", () => {});
    meta.ensure(["gone", "a"]);
    await flush();
    meta.ensure(["gone", "a"]);
    await flush();
    expect(fetchClipCovers).toHaveBeenCalledTimes(1);

    fetchClipCovers.mockRejectedValueOnce(new Error("down"));
    meta.ensure(["b"]);
    await flush();
    meta.ensure(["b"]);
    await flush();
    expect(fetchClipCovers).toHaveBeenCalledTimes(2);
    meta.refresh();
    meta.ensure(["b"]);
    await flush();
    expect(fetchClipCovers).toHaveBeenCalledTimes(3);
  });

  it("asks again, at a refresh, for the clip the event names, and keeps the old cover until then", async () => {
    const meta = new ClipMeta("d", () => {});
    meta.ensure(["a"]);
    await flush();
    meta.refresh("a");
    expect(meta.coverOf("a")?.site).toBe("a.com");
    meta.ensure(["a"]);
    await flush();
    expect(fetchClipCovers).toHaveBeenCalledTimes(2);
  });
});

describe("SPEC-ADDON-138 I4 the unread dots", () => {
  it("draws a dot only for the nickname asked under, and starts over for another one", async () => {
    const meta = new ClipMeta("d", () => {});
    meta.ensure(["u1", "r1"], "alice");
    await flush();
    expect(meta.hasDot("u1", "alice")).toBe(true);
    expect(meta.hasDot("r1", "alice")).toBe(false);
    expect(meta.hasDot("u1", null)).toBe(false);
    expect(meta.hasDot("u1", "bob")).toBe(false);

    meta.ensure(["u1"], "bob");
    await flush();
    expect(loadUnreadAmong).toHaveBeenCalledTimes(2);
    expect(meta.hasDot("u1", "bob")).toBe(true);
    expect(meta.hasDot("u1", "alice")).toBe(false);
  });

  it("asks no dots without a nickname", async () => {
    const meta = new ClipMeta("d", () => {});
    meta.ensure(["u1"]);
    await flush();
    expect(loadUnreadAmong).not.toHaveBeenCalled();
  });

  it("drops an answer that belongs to a nickname that has gone", async () => {
    let release!: (s: Set<string>) => void;
    loadUnreadAmong.mockImplementationOnce(() => new Promise((res) => (release = res)));
    const meta = new ClipMeta("d", () => {});
    meta.ensure(["u1"], "alice");
    meta.ensure(["u1"], "bob");
    await flush();
    release(new Set(["u1"]));
    await flush();

    expect(meta.hasDot("u1", "alice")).toBe(false);
  });

  it("tells the page about a 400 viewer_required and draws nothing for those cards", async () => {
    const onViewerRequired = vi.fn();
    loadUnreadAmong.mockRejectedValueOnce(new ApiStatusError(400, "bad", "viewer_required"));
    const meta = new ClipMeta("d", onViewerRequired);
    meta.ensure(["u1"], "alice");
    await flush();

    expect(onViewerRequired).toHaveBeenCalledTimes(1);
    expect(meta.hasDot("u1", "alice")).toBe(false);
  });

  it("asks again for the cards whose ask failed only at a refresh", async () => {
    loadUnreadAmong.mockRejectedValueOnce(new Error("down"));
    const meta = new ClipMeta("d", () => {});
    meta.ensure(["u1"], "alice");
    await flush();
    meta.ensure(["u1"], "alice");
    await flush();
    expect(loadUnreadAmong).toHaveBeenCalledTimes(1);
    meta.refresh();
    meta.ensure(["u1"], "alice");
    await flush();
    expect(loadUnreadAmong).toHaveBeenCalledTimes(2);
    expect(meta.hasDot("u1", "alice")).toBe(true);
  });
});
