import { describe, expect, it } from "vitest";

import { resolveShownNote, type NoteCheck } from "../shownNote";

const idle: NoteCheck = { status: "idle" };

describe("SPEC-ADDON-132 Library step 3: resolving the note", () => {
  it("shows the first row when the URL names no note", () => {
    expect(resolveShownNote(null, ["a", "b"], "ready", idle)).toEqual({ kind: "show", id: "a", setNote: null });
  });

  it("waits while the list loads, and draws no pane for an empty list", () => {
    expect(resolveShownNote(null, [], "loading", idle)).toEqual({ kind: "pending" });
    expect(resolveShownNote(null, [], "ready", idle)).toEqual({ kind: "none", removeNote: false });
  });

  it("shows a note among the loaded rows without a check", () => {
    expect(resolveShownNote("b", ["a", "b"], "ready", idle)).toEqual({ kind: "show", id: "b", setNote: null });
  });

  it("waits for the check of a note that is not among the rows", () => {
    expect(resolveShownNote("z", ["a"], "ready", { status: "loading" })).toEqual({ kind: "pending" });
  });

  it("total 1: shows it, even when the list is empty", () => {
    const check: NoteCheck = { status: "loaded", total: 1 };
    expect(resolveShownNote("z", ["a"], "ready", check)).toEqual({ kind: "show", id: "z", setNote: null });
    expect(resolveShownNote("z", [], "ready", check)).toEqual({ kind: "show", id: "z", setNote: null });
  });

  it("total 0: shows the first row and replaces note with it", () => {
    expect(resolveShownNote("z", ["a", "b"], "ready", { status: "loaded", total: 0 })).toEqual({
      kind: "show",
      id: "a",
      setNote: "a",
    });
  });

  it("total 0 with an empty list: removes note and draws no pane", () => {
    expect(resolveShownNote("z", [], "ready", { status: "loaded", total: 0 })).toEqual({
      kind: "none",
      removeNote: true,
    });
  });

  it("total 0 while the list still loads: waits instead of removing the note", () => {
    expect(resolveShownNote("z", [], "loading", { status: "loaded", total: 0 })).toEqual({ kind: "pending" });
  });

  it("a failed check is the pane's error state and does not touch the URL", () => {
    expect(resolveShownNote("z", ["a"], "ready", { status: "failed" })).toEqual({ kind: "error" });
  });
});
