import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import KnowledgeDashboard from "../KnowledgeDashboard";
import FolderView from "../FolderView";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ""}.${key}`,
}));
vi.mock("@/components/CurrentDriveProvider", () => ({
  useCurrentDrive: () => "test-drive",
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => undefined }));
// The graph pulls a layout worker and a network round trip, and neither is
// what this file is about.
vi.mock("../ConnectionsGraph", () => ({ default: () => null }));
vi.mock("../api", () => ({
  listFolder: vi.fn().mockResolvedValue({ folders: [], notes: [] }),
  createNote: vi.fn(),
}));

/**
 * The chrome C3 changed: one page heading, drawn by the core component, and
 * a pane heading that stopped claiming to be one.
 *
 * Both are also counted by core's `page-headings.test.ts`, which greps this
 * tree for `<h1`. That detector cannot see *which* element is the heading or
 * what draws it — it reads source text. These render.
 */
describe("the knowledge dashboard's page header", () => {
  afterEach(cleanup);

  it("gets its heading from PageHeader, not from a hand-written <h1>", () => {
    // One `<h1>`, its icon outside it, and the words the page asked for.
    //
    // **This does not prove the header is `PageHeader`.** A hand-rolled
    // `<header>` with the icon beside the heading passes every line here —
    // tried, and it does. What forbids one is core's
    // `page-headings.test.ts`, which greps this tree for `<h1` and holds
    // the count against a ledger; this file checks that what the component
    // renders is what the page needs.
    const { container } = render(<KnowledgeDashboard />);
    const h1s = [...container.querySelectorAll("h1")];
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("knowledge.dashboard.heading");
    // An icon, and outside the heading. Both halves: without the first,
    // dropping `titleIcon` changes nothing here; without the second, an
    // icon wrapped inside the `<h1>` would read as part of the title.
    const header = h1s[0].closest("header")!;
    expect(header.querySelector("svg")).not.toBeNull();
    expect(h1s[0].querySelector("svg")).toBeNull();
  });

  it("says what the page is for under the title", () => {
    render(<KnowledgeDashboard />);
    expect(screen.getByText("knowledge.dashboard.description")).toBeInTheDocument();
  });
});

describe("the knowledge folder pane's heading", () => {
  afterEach(cleanup);

  it("heads a region, not the page", () => {
    // A pane heading, so an `<h2>`. Core's heading ledger has listed this
    // file as the exception since D1 and declares the window that closes
    // it.
    //
    // The component has no route today — `Page.tsx` renders the dashboard
    // alone — so this pins the shape for whenever the two-pane view comes
    // back rather than describing something a reader can open.
    const { container } = render(
      <FolderView
        drive="test-drive"
        path="notes"
        name="Notes"
        sidebarHidden={false}
        onToggleSidebar={vi.fn()}
        onBack={vi.fn()}
        onSelectFile={vi.fn()}
        onSelectFolder={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(container.querySelector("h2")?.textContent).toBe("Notes");
  });
});
