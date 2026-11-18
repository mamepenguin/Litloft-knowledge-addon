import { describe, expect, it } from "vitest";

import { notesConditions } from "../../notesapp/listing";
import type { ReadyNotesTarget } from "../../notesapp/useNotesTarget";

const ready = (params: ReadyNotesTarget["params"]): ReadyNotesTarget => ({
  status: "ready",
  key: "k",
  params,
  fileIds: null,
});

describe("SPEC-ADDON-132 frame step 2: every listing or counting request carries type=text and exclude_origin=webclip", () => {
  it("adds both to the default target", () => {
    expect(notesConditions(ready(null))).toEqual({ type: "text", exclude_origin: "webclip" });
  });

  it("fixes them last, so the target cannot widen them", () => {
    const widened = ready({ type: ["text", "pdf"], origin: "webclip", exclude_origin: "" } as never);
    expect(notesConditions(widened)).toMatchObject({ type: "text", exclude_origin: "webclip" });
  });

  it("keeps the target's other conditions and adds the caller's tag to its tags", () => {
    const target = ready({ type: ["text"], tag: ["work"], folder: ["A"], favorite: true });
    expect(notesConditions(target, { tag: "ai", search: "q" })).toEqual({
      type: "text",
      exclude_origin: "webclip",
      tag: ["work", "ai"],
      folder: ["A"],
      favorite: true,
      search: "q",
    });
  });
});
