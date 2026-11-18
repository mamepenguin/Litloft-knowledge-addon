import { describe, expect, it } from "vitest";

import { railItems, type RailModelInput } from "../railModel";

const base: RailModelInput = {
  segment: "folder",
  entries: [
    { key: "", count: 2 },
    { key: "A", count: 5 },
  ],
  railFailed: false,
  selection: { kind: "all" },
  allTotal: 7,
  listTotal: null,
  listPhase: "loading",
};

describe("SPEC-ADDON-132 Library step 1: the rail's entries", () => {
  it("draws All with the scope line's total, then each entry with its own count", () => {
    expect(railItems(base)).toEqual([
      { kind: "all", key: null, count: 7, selected: true },
      { kind: "entry", key: "", count: 2, selected: false },
      { kind: "entry", key: "A", count: 5, selected: false },
    ]);
  });

  it("draws no count for All while the total is unknown", () => {
    expect(railItems({ ...base, allTotal: null })[0].count).toBeNull();
  });

  it("marks the selected entry", () => {
    const items = railItems({ ...base, selection: { kind: "folder", path: "A" } });
    expect(items.filter((i) => i.selected).map((i) => i.key)).toEqual(["A"]);
  });

  it("draws a selected entry that is not among the entries after them, counted by the list's total", () => {
    const items = railItems({
      ...base,
      selection: { kind: "folder", path: "Gone" },
      listTotal: 0,
      listPhase: "ready",
    });
    expect(items.at(-1)).toEqual({ kind: "entry", key: "Gone", count: 0, selected: true });
    expect(items).toHaveLength(4);
  });

  it("gives the selected entry no count before the list has answered, or when the list failed", () => {
    for (const listPhase of ["loading", "failed"] as const) {
      const items = railItems({ ...base, selection: { kind: "folder", path: "Gone" }, listPhase });
      expect(items.at(-1)?.count).toBeNull();
    }
  });

  it("with the rail's request failed, shows All and the selected entry without counts", () => {
    const items = railItems({
      ...base,
      entries: null,
      railFailed: true,
      selection: { kind: "tag", name: "ai" },
      segment: "tag",
      listTotal: 3,
      listPhase: "ready",
    });
    expect(items).toEqual([
      { kind: "all", key: null, count: 7, selected: false },
      { kind: "entry", key: "ai", count: null, selected: true },
    ]);
  });

  it("never selects a folder entry while the Tags segment is shown", () => {
    const items = railItems({
      ...base,
      segment: "tag",
      entries: [{ key: "A", count: 1 }],
      selection: { kind: "all" },
    });
    expect(items.filter((i) => i.selected)).toHaveLength(1);
    expect(items[0].selected).toBe(true);
  });
});
