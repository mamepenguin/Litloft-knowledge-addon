import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
}));

const _pushSpy = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: _pushSpy }),
}));

import ConnectionsGraph from "../ConnectionsGraph";

const baseGraph = {
  nodes: [
    {
      id: "fA",
      title: "Note A",
      path: "a.md",
      mime_kind: "md",
      folder: "notes",
      tags: ["llm"],
      relation_count: 2,
    },
    {
      id: "fB",
      title: "Source B",
      path: "b.mp4",
      mime_kind: "video",
      folder: "media",
      tags: [],
      relation_count: 1,
    },
    {
      id: "fC",
      title: "Source C",
      path: "c.pdf",
      mime_kind: "pdf",
      folder: "media",
      tags: ["book"],
      relation_count: 1,
    },
  ],
  edges: [
    { a: "fA", b: "fB", kind: "note_source" },
    { a: "fA", b: "fC", kind: "related" },
  ],
  orphan_count: 1,
  orphans: [{ id: "fOrphan", title: "lonely", path: "lonely.md" }],
};

function stubGraphFetch(payload: unknown, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  _pushSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConnectionsGraph", () => {
  it("renders nodes and edges from API", async () => {
    stubGraphFetch(baseGraph);
    render(<ConnectionsGraph drive="test-drive" />);

    await waitFor(() => {
      expect(screen.getByText("Note A")).toBeTruthy();
    });
    expect(screen.getByText("Source B")).toBeTruthy();
    expect(screen.getByText("Source C")).toBeTruthy();

    // Stats label uses ICU-style param translation
    expect(
      screen.getByText(/stats\.nodes:.*"count":3/),
    ).toBeTruthy();
    expect(
      screen.getByText(/stats\.edges:.*"count":2/),
    ).toBeTruthy();
  });

  it("shows empty state when no nodes and no orphans", async () => {
    stubGraphFetch({ nodes: [], edges: [], orphan_count: 0, orphans: [] });
    render(<ConnectionsGraph drive="test-drive" />);

    await waitFor(() => {
      expect(screen.getByText("emptyGraph")).toBeTruthy();
    });
  });

  it("renders orphan toggle when orphan_count > 0", async () => {
    stubGraphFetch({
      nodes: [],
      edges: [],
      orphan_count: 3,
      orphans: [
        { id: "f1", title: "t1", path: "p1.md" },
        { id: "f2", title: "t2", path: "p2.md" },
      ],
    });
    render(<ConnectionsGraph drive="test-drive" />);

    const toggle = await screen.findByText(/orphans\.show/);
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    expect(await screen.findByText(/orphans\.hide/)).toBeTruthy();
    expect(screen.getByText("t1")).toBeTruthy();
    expect(screen.getByText("t2")).toBeTruthy();
  });

  it("renders each node with a data-node-id attribute for selection", async () => {
    stubGraphFetch(baseGraph);
    render(<ConnectionsGraph drive="test-drive" />);

    await waitFor(() => {
      expect(screen.getByText("Note A")).toBeTruthy();
    });

    // The graph SVG (viewBox identifies it among lucide icons) should
    // expose data-node-id on each node group. The interactive click path
    // (pointer-capture aware) is covered by E2E rather than unit tests
    // because jsdom's Pointer Events implementation is partial.
    const svgs = Array.from(
      document.querySelectorAll("svg"),
    ) as SVGSVGElement[];
    const svg = svgs.find((s) =>
      s.getAttribute("viewBox")?.startsWith("0 0 1100"),
    );
    expect(svg).toBeTruthy();
    expect(svg!.querySelector('[data-node-id="fA"]')).toBeTruthy();
    expect(svg!.querySelector('[data-node-id="fB"]')).toBeTruthy();
    expect(svg!.querySelector('[data-node-id="fC"]')).toBeTruthy();
  });

  it("shows error message when API fails", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ detail: "boom" }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<ConnectionsGraph drive="test-drive" />);
    await waitFor(() => {
      expect(screen.getByText(/loadFailed/)).toBeTruthy();
    });
  });

  it("color-by chip group reflects selection", async () => {
    stubGraphFetch(baseGraph);
    render(<ConnectionsGraph drive="test-drive" />);

    await waitFor(() => {
      expect(screen.getByText("Note A")).toBeTruthy();
    });

    const tagChip = screen.getByText("colorBy.tag");
    fireEvent.click(tagChip);
    // The component re-renders; tag chip is highlighted (we don't assert
    // the class change here, just that the click doesn't throw and the
    // graph still renders).
    expect(screen.getByText("Note A")).toBeTruthy();
  });
});
