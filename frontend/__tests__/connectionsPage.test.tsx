import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ""}.${key}`,
}));
let drive: string | null = "d";
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => drive }));
const graph = vi.fn();
vi.mock("../ConnectionsGraph", () => ({
  default: (props: { drive: string }) => {
    graph(props);
    return <div data-testid="graph" />;
  },
}));

const ConnectionsPage = (await import("../pages/connections")).default;

describe("the connections page", () => {
  afterEach(cleanup);

  it("draws the graph for this drive under one page heading, with a way back to Notes", () => {
    drive = "動画 d";
    const { container } = render(<ConnectionsPage />);

    expect([...container.querySelectorAll("h1")].map((h) => h.textContent)).toEqual([
      "knowledge.notes.connections",
    ]);
    expect(screen.getByTestId("graph")).toBeInTheDocument();
    expect(graph.mock.calls.map(([p]) => p)).toEqual([{ drive: "動画 d" }]);
    expect(screen.getByRole("link", { name: "knowledge.notes.back" }).getAttribute("href")).toBe(
      "/drive/%E5%8B%95%E7%94%BB%20d/addons/knowledge",
    );
  });
});
