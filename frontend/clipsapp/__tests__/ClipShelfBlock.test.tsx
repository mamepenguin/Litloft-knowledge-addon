/** SPEC-ADDON-138 step 6 and item 12: how many cards a shelf draws, and what it draws instead of them. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const measured = vi.hoisted(() => ({ columns: 0 }));
vi.mock("@/lib/cardGrid", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cardGrid")>("@/lib/cardGrid");
  return { ...actual, useCardColumns: () => ({ ref: () => {}, columns: measured.columns }) };
});
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

const { ClipShelfBlock } = await import("../ClipShelfBlock");

afterEach(() => {
  cleanup();
  measured.columns = 0;
  vi.unstubAllGlobals();
});

const items = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}` }));
const shelf = (view: Parameters<typeof ClipShelfBlock<{ id: string }>>[0]["view"]) =>
  render(
    <ClipShelfBlock
      title="Unread"
      count="12"
      seeAllHref="/all"
      view={view}
      onRetry={() => {}}
      renderItem={(item) => <span data-testid="card">{item.id}</span>}
    />,
  );

describe("SPEC-ADDON-138 how many cards a shelf draws", () => {
  it.each([
    [2, 4],
    [3, 3],
    [5, 5],
    [8, 8],
    [0, 4],
  ])("draws %s columns as %s cards: one row from three columns, two rows at two", (columns, drawn) => {
    measured.columns = columns;
    shelf({ status: "loaded", items });

    expect(screen.getAllByTestId("card")).toHaveLength(drawn);
  });

  it("draws skeleton cards for as many places while loading, and no cards", () => {
    measured.columns = 3;
    shelf({ status: "loading" });

    expect(screen.queryAllByTestId("card")).toHaveLength(0);
    expect(screen.getAllByTestId("clip-skeleton")).toHaveLength(3);
  });

  it("draws every card as a sideways strip of 150px cards on a coarse pointer", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    measured.columns = 3;
    shelf({ status: "loaded", items });

    expect(screen.getAllByTestId("card")).toHaveLength(12);
    const strip = screen.getAllByTestId("card")[0].closest("ul")!;
    expect(strip.className).toContain("overflow-x-auto");
    expect(screen.getAllByTestId("card")[0].closest("li")!.className).toContain("w-[150px]");
  });
});

describe("SPEC-ADDON-138 the shelf's heading", () => {
  it("draws the title, the count and See all beside the cards", () => {
    shelf({ status: "loaded", items });

    expect(screen.getByRole("heading", { level: 2, name: "Unread" })).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all: Unread" })).toHaveAttribute("href", "/all");
  });

  it("draws Couldn't load and Try again in place of the cards, without See all, and retries", () => {
    const onRetry = vi.fn();
    render(
      <ClipShelfBlock
        title="Unread"
        seeAllHref="/all"
        view={{ status: "failed" }}
        onRetry={onRetry}
        renderItem={() => null}
      />,
    );

    expect(screen.getByText("Couldn't load")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /See all/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
