/**
 * Escape reaches these surfaces through the shortcut stack.
 *
 * Each of them used to bind its own `window` / `document` keydown
 * listener and test `e.key === "Escape"` there. Two things follow from
 * that, both invisible until you hit them: a listener does not know
 * what is stacked above it, so two layers answer one press; and it
 * fires on a graph or a panel that is not the thing in front of the
 * user, because a listener bound at mount is claimed for as long as
 * the component lives.
 *
 * The flag that matters here is `editingOnly: false`. The provider
 * treats a focused input as "editing", and the default — the flag
 * left off — means "only when nothing is being edited". In a dialog
 * that focuses its own field on open, that is never. So every
 * assertion below presses Escape **with the input focused**: pressing
 * it against `document.body` would pass either way and prove nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { ShortcutsProvider } from "@/components/ShortcutsProvider";

vi.mock("../api", () => ({
  getFileTags: vi.fn(async () => []),
  listDriveTags: vi.fn(async () => []),
  updateFileTags: vi.fn(async () => undefined),
  createTextFile: vi.fn(async () => ({ id: "x" })),
}));

import BookmarkletDialog from "../BookmarkletDialog";

function withStack(ui: React.ReactElement) {
  return render(<ShortcutsProvider>{ui}</ShortcutsProvider>);
}

/** Press Escape where the user actually is: inside a focused field. */
function escapeFromAFocusedField() {
  const field =
    document.querySelector("input") ?? document.querySelector("textarea");
  if (field) {
    (field as HTMLElement).focus();
    fireEvent.keyDown(field, { key: "Escape" });
    return;
  }
  fireEvent.keyDown(document.body, { key: "Escape" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("BookmarkletDialog", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    withStack(<BookmarkletDialog drive="vault" open onClose={onClose} />);
    escapeFromAFocusedField();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not answer Escape while closed", () => {
    // A listener bound at mount answers for as long as the component
    // lives. A stack entry is only pushed while `open`.
    const onClose = vi.fn();
    withStack(<BookmarkletDialog drive="vault" open={false} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
