/** SPEC-ADDON-138 step 2: Clips' Target is saved under its own key; Notes' is untouched. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { CLIPS_APP } from "../clipsApp";
import { NOTES_APP, useNotesTarget } from "../../notesapp/useNotesTarget";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })),
  );
});
afterEach(() => vi.unstubAllGlobals());

const key = (addon: string) => `litloft.addon.${addon}.target.d`;

describe("SPEC-ADDON-138 the Target hook's app key", () => {
  it("saves a choice under the app it was given and leaves the other app's key alone", () => {
    const clips = renderHook(() => useNotesTarget("d", CLIPS_APP));
    act(() => clips.result.current.choose("collection:c1"));
    expect(window.localStorage.getItem(key("knowledge-clips"))).toBe("collection:c1");
    expect(window.localStorage.getItem(key("knowledge"))).toBeNull();

    const notes = renderHook(() => useNotesTarget("d"));
    expect(notes.result.current.selectedId).toBe("default");
    act(() => notes.result.current.choose("collection:c2"));
    expect(window.localStorage.getItem(key("knowledge"))).toBe("collection:c2");
    expect(window.localStorage.getItem(key("knowledge-clips"))).toBe("collection:c1");
  });

  it("defaults to the key Notes uses", () => {
    expect(NOTES_APP).toEqual({ addon: "knowledge" });
    const notes = renderHook(() => useNotesTarget("d"));
    act(() => notes.result.current.choose("collection:c9"));
    expect(window.localStorage.getItem(key("knowledge"))).toBe("collection:c9");
  });

  it("reads the saved choice of its own app when it starts", () => {
    window.localStorage.setItem(key("knowledge-clips"), "collection:c1");
    const clips = renderHook(() => useNotesTarget("d", CLIPS_APP));
    expect(clips.result.current.target.status).toBe("lookingUp");
    const notes = renderHook(() => useNotesTarget("d"));
    expect(notes.result.current.target.status).not.toBe("lookingUp");
  });
});
