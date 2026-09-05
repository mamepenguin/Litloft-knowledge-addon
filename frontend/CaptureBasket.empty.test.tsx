/**
 * The empty capture basket, which said "No captures yet" and nothing else —
 * neither what belongs in it nor how anything gets there.
 *
 * A separate file because of the `next-intl` stand-in below. Three claims
 * are in play and rendering can carry only one of them:
 *
 *   - *the panel draws core's `EmptyState`* — a hand-rolled `<div>` holding
 *     an icon, an `<h2>` and a `<p>` is indistinguishable in the DOM, and a
 *     reviewer built exactly that and watched every assertion pass. So it is
 *     asserted at the seam, on the props the component is called with;
 *   - *the panel passes its own two keys* — which needs `t()` to render keys
 *     rather than English, or a hardcoded English literal reads the same as
 *     a translated one;
 *   - *the keys hold sentences* — which no rendered assertion in this file
 *     can see, so the catalogues are read directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Quote } from "lucide-react";

import CaptureBasket from "@/addons/knowledge/CaptureBasket";
import { clearSourceCaptures } from "@/lib/sourceCapture";

import ja from "./messages/ja.json";
import en from "./messages/en.json";

/**
 * `t()` renders the key here, not English.
 *
 * The global stand-in resolves against the merged catalogue, which makes a
 * hardcoded English literal indistinguishable from a translated one: a
 * reviewer replaced `title={t("empty")}` with the literal `"No captures
 * yet"` and every assertion stayed green.
 *
 * It exports what the components rendered here actually call and nothing
 * else. A missing export fails loudly — verified, by adding a
 * `useFormatter()` call to the component and watching every test in this
 * file fail on it — whereas a stub of the wrong shape (a `t.rich` returning
 * a string where a node belongs) would pass while rendering the wrong
 * thing. Nothing in core or any addon calls `t.rich` / `t.raw` today, so
 * there is nothing here to get wrong.
 */
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

/**
 * Core's `EmptyState`, wrapped so the call can be inspected.
 *
 * The wrapper delegates, so the DOM below is still the real component's;
 * what it adds is a record of the props, which is the only place "this is
 * core's component and not a copy of it" is visible.
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
      // An element, not a call: calling it would put its hooks on this
      // wrapper's fiber, which works today only because the component has
      // none, and breaks the day core wraps it in `memo` or `forwardRef`.
      return <actual.EmptyState {...props} />;
    },
  };
});

const TITLE = /^knowledge\.captureBasket\.title$/;
const EMPTY_TITLE = /^knowledge\.captureBasket\.empty$/;

describe("CaptureBasket when it is empty", () => {
  beforeEach(() => {
    // Captures live in a store this file never seeds. Clearing is still not
    // optional: the store is module state in core, shared with any other
    // file that ran before this one in the same worker.
    clearSourceCaptures("family");
    emptyStateProps.length = 0;
  });

  const openEmptyBasket = () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: TITLE }));
    return screen.getByRole("dialog", { name: TITLE });
  };

  it("draws it with core's EmptyState, given the quote mark and both strings", () => {
    openEmptyBasket();

    // Every recorded render, not the last one. Opening the panel renders the
    // subtree more than once (twice, as measured — an effect settles the
    // destination clock), and reading only the final call would let a panel
    // that drew two different empty states pass, and would crash rather than
    // fail when it drew none. What matters is that all of them are the same
    // one, so that is what is asserted: a set of size one, whose member is
    // named.
    expect(new Set(emptyStateProps.map((p) => p.icon))).toEqual(
      // The glyph is the tie between this panel and the buttons the copy
      // sends the reader to look for; every one of them is a lucide `Quote`.
      new Set([Quote]),
    );
    expect(new Set(emptyStateProps.map((p) => p.title))).toEqual(
      new Set(["knowledge.captureBasket.empty"]),
    );
    expect(new Set(emptyStateProps.map((p) => p.description))).toEqual(
      new Set(["knowledge.captureBasket.emptyDescription"]),
    );
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

    expect(new Set(emptyStateProps.map((p) => p.primaryAction))).toEqual(
      new Set([undefined]),
    );
    expect(new Set(emptyStateProps.map((p) => p.secondaryActions))).toEqual(
      new Set([undefined]),
    );
  });

  /**
   * What the keys hold, which nothing above can see.
   *
   * The floors are per locale because one number cannot span both scripts:
   * the same sentence is 199 characters in en and 91 in ja, so a floor set
   * where en is comfortable rejects good ja copy. Measured today —
   * empty 15/10, emptyDescription 199/91 — each floor sits between a junk
   * value and the shortest sentence its language can honestly write.
   *
   * This is the weakest assertion here on purpose: it separates a sentence
   * from `""`, `"   "` and `"TODO"`, all three of which an earlier version
   * accepted, and it cannot tell a sentence from thirty characters of
   * nonsense. Nothing automatic can. The reviewer of the copy is the check
   * on the copy.
   */
  it.each([
    ["ja", ja, 3, 25],
    ["en", en, 4, 40],
  ])(
    "ships both strings in the %s catalogue",
    (_locale, catalogue, titleFloor, descriptionFloor) => {
      const basket = catalogue.knowledge.captureBasket as Record<
        string,
        string
      >;
      expect(basket.empty.trim().length).toBeGreaterThan(titleFloor);
      expect(basket.emptyDescription.trim().length).toBeGreaterThan(
        descriptionFloor,
      );
      expect(basket.emptyDescription).not.toBe(basket.empty);
    },
  );

  // Across locales, not within one: an untranslated catalogue that copied
  // the other's sentence passes every per-locale check above.
  it("translates the description rather than copying it", () => {
    expect(ja.knowledge.captureBasket.emptyDescription).not.toBe(
      en.knowledge.captureBasket.emptyDescription,
    );
    expect(ja.knowledge.captureBasket.empty).not.toBe(
      en.knowledge.captureBasket.empty,
    );
  });
});
