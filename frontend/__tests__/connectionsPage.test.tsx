import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    (ns?: string) =>
    (key: string, params?: Record<string, unknown>) =>
      `${ns ?? ""}.${key}${params ? JSON.stringify(params) : ""}`,
}));
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
let drive: string | null = "d";
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => drive }));

const ConnectionsPage = (await import("../pages/connections")).default;

function stubGraph(status: number, payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: status < 300, status, json: async () => payload })),
  );
}

const GRAPH = {
  nodes: [
    { id: "fA", title: "Note A", path: "a.md", mime_kind: "md", folder: "notes", tags: [], relation_count: 1 },
    { id: "fB", title: "Source B", path: "b.pdf", mime_kind: "pdf", folder: "media", tags: [], relation_count: 1 },
  ],
  edges: [{ a: "fA", b: "fB", kind: "related" }],
  orphan_count: 1,
  orphans: [{ id: "fO", title: "lonely", path: "lonely.md" }],
};

function body(container: HTMLElement): HTMLElement {
  return container.querySelector("header")!.nextElementSibling as HTMLElement;
}

describe("the connections page", () => {
  it("wears the wide column", () => {
    stubGraph(200, GRAPH);
    const { container } = render(<ConnectionsPage />);
    expect(container.querySelector("header")!.parentElement?.getAttribute("data-page-frame")).toBe("wide");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    search = "";
  });

  it("draws the graph under one page heading, with a way back to Notes for this drive", async () => {
    drive = "動画 d";
    stubGraph(200, GRAPH);
    const { container } = render(<ConnectionsPage />);
    await screen.findByText("Note A");

    expect([...container.querySelectorAll("h1")].map((h) => h.textContent)).toEqual([
      "knowledge.notes.connections",
    ]);
    expect(screen.getByRole("link", { name: "knowledge.notes.back" }).getAttribute("href")).toBe(
      "/drive/%E5%8B%95%E7%94%BB%20d/addons/knowledge",
    );
    drive = "d";
  });

  it("centres the graph on the file named in the focus query", async () => {
    search = "focus=fB";
    stubGraph(200, GRAPH);
    render(<ConnectionsPage />);

    const label = await screen.findByText(/^knowledge\.connections\.focus\.label/);
    expect(label.parentElement).toHaveTextContent("Source B");
  });

  it.each([
    ["no focus query", ""],
    ["an empty focus query", "focus="],
  ])("shows the whole graph without a notice for %s", async (_label, query) => {
    search = query;
    stubGraph(200, GRAPH);
    render(<ConnectionsPage />);
    await screen.findByText("Note A");

    expect(screen.queryByText(/^knowledge\.connections\.focus\.label/)).toBeNull();
    expect(screen.queryByText("knowledge.connections.focus.notInGraph")).toBeNull();
  });

  it.each([
    [
      "the graph",
      () => stubGraph(200, GRAPH),
      () => screen.findByText("Note A"),
      [
        "knowledge.connections.colorBy.kind",
        "knowledge.connections.colorBy.tag",
        "knowledge.connections.colorBy.folder",
        "knowledge.connections.colorBy.flat",
        "knowledge.connections.zoom.in",
        "knowledge.connections.zoom.out",
        "knowledge.connections.zoom.reset",
        'knowledge.connections.orphans.show{"count":1}',
      ],
      (root: HTMLElement) => {
        expect(root.querySelector('svg[viewBox^="0 0 1100"]')).not.toBeNull();
        expect(within(root).getByText("Note A")).toBeInTheDocument();
      },
    ],
    [
      "the empty state",
      () => stubGraph(200, { nodes: [], edges: [], orphan_count: 0, orphans: [] }),
      () => screen.findByText("knowledge.connections.emptyGraph"),
      [],
      (root: HTMLElement) => expect(within(root).getByText("knowledge.connections.emptyGraph")).toBeInTheDocument(),
    ],
    [
      "the failure state",
      () => stubGraph(500, { detail: "boom" }),
      () => screen.findByRole("alert"),
      [],
      (root: HTMLElement) => expect(within(root).getByRole("alert")).toBeInTheDocument(),
    ],
  ])("offers nothing that empties %s", async (_label, arrange, settled, controls, stillThere) => {
    arrange();
    const { container } = render(<ConnectionsPage />);
    await settled();
    const root = body(container);

    const buttons = within(root).queryAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.getAttribute("title") ?? b.textContent)).toEqual(
      controls,
    );
    for (const button of buttons) fireEvent.click(button);
    stillThere(root);
  });
});
