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
import { accentFills } from "@/__tests__/helpers/accentFills";

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

/**
 * DESIGN.md §2.2: one accent fill per screen, at rest.
 *
 * The panel had three, which was the state §2.2 describes as "the screen has
 * not decided what it is for". Two of them are the arms of a ternary on
 * `targetMode`, so the worst case on screen at once is two — the footer's
 * own action plus whichever alternative the disclosure is showing — and that
 * is still one too many. The footer action keeps the fill; the two behind
 * `Other save methods` take `secondary`.
 *
 * Asserted in the state that can actually hold two, not only at rest: a
 * budget checked with the disclosure closed cannot see either of them.
 *
 * **Filtered to controls.** §2.2's operational form is "at most one
 * *control* on a screen carries `bg-accent` as a background", and
 * `accentFills` reports elements by class without asking what they are. The
 * one it reports here that is not a control is the unread-count badge on the
 * basket's own trigger — a 16px dot inside the button, not a second thing to
 * press. Tinting it the way `SelectionBar` tints its count chip is not the
 * answer either: `bg-accent/15` behind 10px text does not carry at that size.
 */
describe("the capture basket's accent budget", () => {
  const openBasket = () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: TITLE }));
  };

  /**
   * The filled *controls*, which is what §2.2 budgets.
   *
   * Stated as the reason actually given — "not inside another control" —
   * rather than as a list of tags. An allowlist of `button, a[href],
   * [role=button]` reads the same and is not: it drops
   * `input[type=submit]`, and a filled one added beside the footer action
   * survived the mutation.
   */
  const filledControls = () =>
    accentFills(document.body).filter(
      (el) => !el.parentElement?.closest("button, a[href], [role=button]"),
    );

  it("spends its one fill on the footer's own action", () => {
    openBasket();
    const fills = filledControls();
    expect(fills).toHaveLength(1);
    expect(fills[0].textContent).toMatch(QUICK_APPEND);
  });

  it.each([
    ["saving to a new note", /New note|knowledge\.captureBasket\.newNote/],
    ["appending to an existing one", /Existing note|knowledge\.captureBasket\.existingNote/],
  ])("still spends only one while %s", (_case, tab) => {
    openBasket();
    fireEvent.click(screen.getByRole("button", { name: OTHER_METHODS }));
    fireEvent.click(screen.getByRole("button", { name: tab }));
    const fills = filledControls();
    expect(fills).toHaveLength(1);
    expect(fills[0].textContent).toMatch(QUICK_APPEND);
  });
});

/**
 * The empty basket, which said "No captures yet" and nothing else — neither
 * what belongs in it nor how anything gets there.
 *
 * The heading assertion is what holds the shape: the old copy was a bare
 * `<p>`, so a return to it fails here rather than only losing the second
 * line. Core's `EmptyState` is the thing being asked for (CB-1), and its
 * `<h2>` is the part of it that a hand-rolled replacement would not have.
 */
describe("CaptureBasket when it is empty", () => {
  const EMPTY_TITLE = /No captures yet|knowledge\.captureBasket\.empty$/;
  const EMPTY_DESCRIPTION =
    /quote button|knowledge\.captureBasket\.emptyDescription/;

  beforeEach(() => {
    clearSourceCaptures("family");
  });

  it("says what belongs in it and how to put it there", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: TITLE }));

    const dialog = screen.getByRole("dialog", { name: TITLE });
    expect(
      within(dialog).getByRole("heading", { name: EMPTY_TITLE }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(EMPTY_DESCRIPTION)).toBeInTheDocument();
  });

  /**
   * `DESIGN.md` §2.2 — one accent fill per screen. The footer's own action
   * is disabled with nothing to save, and CB-1 deliberately adds no call to
   * action here (nothing is added to the basket from inside the basket), so
   * the empty panel spends none.
   */
  it("offers no call to action", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: TITLE }));

    const dialog = screen.getByRole("dialog", { name: TITLE });
    const emptyState = within(dialog)
      .getByRole("heading", { name: EMPTY_TITLE })
      .closest("div");
    expect(emptyState?.querySelector("button")).toBeNull();
  });
});
