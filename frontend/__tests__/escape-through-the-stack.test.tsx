/**
 * Escape reaches this dialog through the shortcut stack.
 *
 * It used to bind its own `window` / `document` keydown listener and
 * test `e.key === "Escape"` there. Two things follow from that, both
 * invisible until you hit them: a listener does not know what is
 * stacked above it, so two layers answer one press; and it fires on a
 * graph or a panel that is not the thing in front of the user,
 * because a listener bound at mount is claimed for as long as the
 * component lives.
 *
 * This covered three surfaces until the two-pane view was deleted. The
 * clip modal and the tag panel went with it — and they were the two that
 * had fields, which left the file asserting its own premise against a
 * dialog with nothing focusable in it: `editingOnly: false` could be
 * deleted from the survivor and every test here stayed green. The
 * unresolved-link dialog, restored beside them, focuses its own filename
 * input, so it is the surface that makes the paragraph below true.
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
  createTextFile: vi.fn(async () => ({ id: "x" })),
}));

import BookmarkletDialog from "../BookmarkletDialog";
import UnresolvedLinkDialog from "../UnresolvedLinkDialog";

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

describe("UnresolvedLinkDialog", () => {
  it("closes on Escape from its own focused field", () => {
    const onClose = vi.fn();
    withStack(
      <UnresolvedLinkDialog
        drive="vault"
        open
        target="Year-in-review"
        defaultFolder="notes"
        onClose={onClose}
      />,
    );
    // The dialog focuses this input on open, and the provider reads
    // `e.target` — so without `editingOnly: false` on its Escape entry,
    // the press below is "editing" and nothing answers it.
    escapeFromAFocusedField();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
