import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Quote } from "lucide-react";

import ja from "./messages/ja.json";
import en from "./messages/en.json";

/**
 * Core's `EmptyState`, wrapped so the call can be inspected.
 *
 * The wrapper delegates, so everything below still renders the real
 * component — what it adds is a record of the props, which is the only
 * place "this is core's component and not a copy of it" is visible.
 */
const { emptyStateProps } = vi.hoisted(() => ({
  emptyStateProps: [] as import("@/components/EmptyState").EmptyStateProps[],
}));
vi.mock("@/components/EmptyState", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/EmptyState")>();
  return {
    ...actual,
    EmptyState: (props: import("@/components/EmptyState").EmptyStateProps) => {
      emptyStateProps.push(props);
      return actual.EmptyState(props);
    },
  };
});

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
 * Three separate claims, and rendering can only carry one of them:
 *
 *   - *the panel draws core's `EmptyState`* — a hand-rolled `<div>` holding
 *     an icon, an `<h2>` and a `<p>` is indistinguishable in the DOM, and a
 *     reviewer built exactly that and watched every assertion here stay
 *     green. So this is asserted at the seam, on the props the component is
 *     called with, not on what comes out of it;
 *   - *the strings exist* — the next-intl stand-in renders a missing key as
 *     the key, and `pnpm test` does not run `merge-addon-messages.mjs`, so
 *     any assertion on rendered text passes with both catalogues emptied.
 *     The catalogues are read directly instead;
 *   - *there is one empty message, not two* — a bad merge that keeps the old
 *     `<p>` beside the new component leaves the panel saying it twice.
 */
describe("CaptureBasket when it is empty", () => {
  const EMPTY_TITLE = /No captures yet|knowledge\.captureBasket\.empty$/;

  beforeEach(() => {
    clearSourceCaptures("family");
    emptyStateProps.length = 0;
  });

  /**
   * What `t(key)` can legitimately return here, which is three things and
   * not one: the locale under test decides between ja and en, and a key the
   * merged catalogue does not carry yet renders as the key itself —
   * `pnpm test` does not run `merge-addon-messages.mjs`, so a string added
   * in this PR resolves to its key until something regenerates the merge.
   *
   * So this pins *which key* the panel passes, and the catalogue test below
   * pins what that key holds. Neither can do both.
   */
  const resolutionsOf = (key: "empty" | "emptyDescription") => [
    `knowledge.captureBasket.${key}`,
    (ja.knowledge.captureBasket as Record<string, string>)[key],
    (en.knowledge.captureBasket as Record<string, string>)[key],
  ];

  const openEmptyBasket = () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: TITLE }));
    return screen.getByRole("dialog", { name: TITLE });
  };

  it("draws it with core's EmptyState, given the quote mark and both strings", () => {
    openEmptyBasket();

    // The last call, not the only one: opening the panel settles a piece of
    // state (the destination clock), so the tree renders again behind the
    // dialog. How many empty messages the panel ends up with is the next
    // test's business, where the DOM can answer it.
    const props = emptyStateProps[emptyStateProps.length - 1];
    // The glyph is the tie between this panel and the buttons the copy sends
    // the reader to look for; every one of them is a lucide `Quote`.
    expect(props.icon).toBe(Quote);
    expect(resolutionsOf("empty")).toContain(props.title);
    expect(resolutionsOf("emptyDescription")).toContain(props.description);
  });

  it("says what belongs in it and how to put it there", () => {
    const dialog = openEmptyBasket();

    expect(
      within(dialog).getByRole("heading", { name: EMPTY_TITLE }),
    ).toBeInTheDocument();
    // Exactly one. Two is what a merge that kept the old paragraph produces.
    expect(within(dialog).getAllByText(EMPTY_TITLE)).toHaveLength(1);
  });

  /**
   * `DESIGN.md` §2.2 — one accent fill per screen. CB-1 deliberately adds no
   * call to action here: nothing is added to the basket from inside the
   * basket, so there is no destination to offer.
   */
  it("offers no call to action", () => {
    openEmptyBasket();

    const props = emptyStateProps[emptyStateProps.length - 1];
    expect(props.primaryAction).toBeUndefined();
    expect(props.secondaryActions).toBeUndefined();
  });

  // The rendered text cannot check this: a key missing from both catalogues
  // renders as the key and satisfies any regex written to accept one.
  it.each([
    ["ja", ja],
    ["en", en],
  ])("ships both strings in the %s catalogue", (_locale, catalogue) => {
    const basket = catalogue.knowledge.captureBasket as Record<string, string>;
    expect(basket.empty?.length).toBeGreaterThan(0);
    expect(basket.emptyDescription?.length).toBeGreaterThan(0);
    expect(basket.emptyDescription).not.toBe(basket.empty);
  });
});
