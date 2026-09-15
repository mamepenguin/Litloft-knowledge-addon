import { describe, expect, it } from "vitest";

import type { FileItem } from "@/types";

import { formatNoteTime, groupNotesByAge, noteAgeGroup } from "../noteDates";

const NOW = new Date(2026, 8, 14, 15, 0);
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const file = (id: string, updated_at: string) => ({ id, updated_at }) as FileItem;

describe("noteAgeGroup", () => {
  it("counts calendar days, not hours", () => {
    expect([
      noteAgeGroup(at(2026, 9, 14, 0, 1), NOW),
      noteAgeGroup(at(2026, 9, 13, 23, 59), NOW),
      noteAgeGroup(at(2026, 9, 8), NOW),
      noteAgeGroup(at(2026, 9, 7), NOW),
      noteAgeGroup(at(2026, 8, 16), NOW),
      noteAgeGroup(at(2026, 8, 15), NOW),
    ]).toEqual(["today", "week", "week", "month", "month", "earlier"]);
  });
});

describe("groupNotesByAge", () => {
  it("keeps the given order inside each group and omits empty groups", () => {
    const groups = groupNotesByAge(
      [file("a", at(2026, 9, 14, 9)), file("b", at(2026, 9, 1)), file("c", at(2026, 9, 14, 8)), file("d", at(2025, 1, 1))],
      NOW,
    );
    expect(groups.map((g) => [g.group, g.files.map((f) => f.id)])).toEqual([
      ["today", ["a", "c"]],
      ["month", ["b"]],
      ["earlier", ["d"]],
    ]);
  });
});

describe("formatNoteTime", () => {
  it("shows the clock today, a month and day this year, and the year before that", () => {
    expect(formatNoteTime(at(2026, 9, 14, 9, 5), NOW, "en")).toBe("09:05");
    expect(formatNoteTime(at(2026, 9, 11), NOW, "en")).toBe("Sep 11");
    expect(formatNoteTime(at(2025, 12, 31), NOW, "en")).toBe("Dec 31, 2025");
  });
});
