import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { ShortcutsProvider } from "@/components/ShortcutsProvider";
import { useShortcuts } from "@/hooks/useShortcuts";
import { OVERLAY_PRIORITY } from "@/lib/shortcuts";
import CaptureBasket from "@/addons/knowledge/CaptureBasket";
import { defaultCaptureFilename } from "@/addons/knowledge/CaptureBasket";
import {
  addSourceCapture,
  clearSourceCaptures,
} from "@/lib/sourceCapture";

const TITLE = /Capture basket|knowledge\.captureBasket\.title/;
const NOTE_PLACEHOLDER = /Add a note|knowledge\.captureBasket\.notePlaceholder/;
const OTHER_METHODS = /Other save methods|knowledge\.captureBasket\.otherSaveMethods/;
const SAVE_NEW = /Save \d+ captures|knowledge\.captureBasket\.saveNew/;
const SAVE_NEW_TITLE = /Save capture note|knowledge\.captureBasket\.saveNewTitle/;
const QUICK_APPEND = /Append to Inbox\.md|knowledge\.captureBasket\.quickAppend/;

// One capture in the basket, for every test in this file.
//
// It used to be seeded inside the first `describe` only, and the second one
// read it anyway: captures live in localStorage, which nothing clears between
// tests, so whatever the first block left behind was still there when the
// second one ran. That held only because the blocks ran in source order —
// under `--sequence.shuffle` the second block draws an empty basket and its
// assertions fail. A test may not depend on another test having run.
beforeEach(() => {
  clearSourceCaptures("family");
  addSourceCapture({
    drive: "family",
    sourceFileId: "video123",
    filename: "lecture.mp4",
    fileType: "video",
    kind: "media_timestamp",
    locator: { seconds: 65 },
  });
});

describe("CaptureBasket", () => {
  it("keeps a capture deselected while its note is edited", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: TITLE }));

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.change(
      screen.getByPlaceholderText(NOTE_PLACEHOLDER),
      { target: { value: "Follow up" } },
    );

    expect(checkbox).not.toBeChecked();
  });

  it("animates the backdrop and responsive basket sheet when opened", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: TITLE }));

    const dialog = screen.getByRole("dialog", {
      name: TITLE,
    });
    expect(dialog.firstElementChild).toHaveClass("animate-fade-in");
    expect(dialog.querySelector("section")).toHaveClass(
      "animate-slide-up-bar",
      "sm:animate-slide-in-right",
    );
  });

  it("portals the basket and filename dialog outside the header stacking context", () => {
    render(
      <div data-testid="header-stacking-context">
        <CaptureBasket drive="family" />
      </div>,
    );
    const header = screen.getByTestId("header-stacking-context");
    fireEvent.click(
      within(header).getByRole("button", {
        name: TITLE,
      }),
    );

    const basket = screen.getByRole("dialog", {
      name: TITLE,
    });
    expect(header).not.toContainElement(basket);
    expect(basket.parentElement).toBe(document.body);

    fireEvent.click(
      within(basket).getByRole("button", {
        name: OTHER_METHODS,
      }),
    );
    fireEvent.click(
      within(basket).getByRole("button", {
        name: SAVE_NEW,
      }),
    );
    const filenameDialog = screen.getByRole("dialog", {
      name: SAVE_NEW_TITLE,
    });
    expect(header).not.toContainElement(filenameDialog);
    expect(filenameDialog.parentElement).toBe(document.body);
  });

  it("opens the filename dialog above the basket", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: TITLE }));
    fireEvent.click(
      screen.getByRole("button", {
        name: OTHER_METHODS,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: SAVE_NEW }),
    );

    expect(
      screen.getByRole("dialog", { name: SAVE_NEW_TITLE }),
    ).toHaveClass("z-[100]");
  });

  it("uses a collision-resistant timestamp in the default filename", () => {
    expect(defaultCaptureFilename(new Date(2026, 7, 10, 9, 5, 7, 42))).toBe(
      "captures-2026-08-10-090507-042.md",
    );
  });

  it("shows the fixed default destination as the primary action", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(
      screen.getByRole("button", { name: TITLE }),
    );

    expect(
      screen.getByRole("button", {
        name: QUICK_APPEND,
      }),
    ).toBeVisible();
    expect(screen.getByText("Captures/Inbox.md")).toBeVisible();
  });
});

// keyboard-shortcuts.md promises Esc closes the topmost modal on every page,
// and "topmost" is implemented by ShortcutsProvider walking its stack and
// returning on the first match. A handler bound straight to `document` fires
// alongside whatever the stack picked — the basket used to close together with
// a cheat sheet or a search modal opened over it.
describe("CaptureBasket Escape handling", () => {
  function openBasket() {
    fireEvent.click(screen.getByRole("button", { name: TITLE }));
    expect(screen.getByRole("dialog", { name: TITLE })).toBeInTheDocument();
  }

  /** A second surface in the stack, above or below the basket as needed. */
  function Other({
    onEscape,
    priority,
  }: {
    onEscape: () => void;
    priority: number;
  }) {
    useShortcuts(
      "surface-other",
      "Other",
      [{ key: "escape", label: "close", handler: onEscape, editingOnly: false }],
      true,
      priority,
    );
    return null;
  }

  it("closes on Escape", () => {
    render(
      <ShortcutsProvider>
        <CaptureBasket drive="family" />
      </ShortcutsProvider>,
    );
    openBasket();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: TITLE })).toBeNull();
  });

  it("leaves the basket open when a surface above it takes the key", () => {
    const closeOther = vi.fn();
    render(
      <ShortcutsProvider>
        <CaptureBasket drive="family" />
        <Other onEscape={closeOther} priority={OVERLAY_PRIORITY + 1} />
      </ShortcutsProvider>,
    );
    openBasket();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(closeOther).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: TITLE })).toBeInTheDocument();
  });

  it("lets Escape through to a lower surface while it is closed", () => {
    // The other surface sits *below* the basket on purpose. With it above, a
    // basket that registered unconditionally would still lose the key and this
    // would pass against the bug it exists to catch.
    const closeOther = vi.fn();
    render(
      <ShortcutsProvider>
        <CaptureBasket drive="family" />
        <Other onEscape={closeOther} priority={OVERLAY_PRIORITY - 1} />
      </ShortcutsProvider>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(closeOther).toHaveBeenCalledTimes(1);
  });

  it("stands down while the filename dialog is open above it", () => {
    // `FileSaveDialog` listens on `document` rather than joining the stack, so
    // the basket cannot out-rank it — it leaves the stack entirely instead.
    // Without that, one Escape closes the dialog and the basket together.
    render(
      <ShortcutsProvider>
        <CaptureBasket drive="family" />
      </ShortcutsProvider>,
    );
    openBasket();

    const basket = screen.getByRole("dialog", { name: TITLE });
    fireEvent.click(within(basket).getByRole("button", { name: OTHER_METHODS }));
    fireEvent.click(within(basket).getByRole("button", { name: SAVE_NEW }));
    expect(screen.getByRole("dialog", { name: SAVE_NEW_TITLE })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: SAVE_NEW_TITLE })).toBeNull();
    expect(screen.getByRole("dialog", { name: TITLE })).toBeInTheDocument();
  });
});
