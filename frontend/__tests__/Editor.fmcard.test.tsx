import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Phase 3 spec 2026-05-10 §D2 / hako B5QG4AcZjbn47MDErmQAO: the Editor's
// preview pane re-renders frontmatter as a "pinned" PropertiesPanel
// directly above the body, with MarkdownPreview running in chrome=false
// so its wrapper card disappears. Tag editing belongs to the inspector,
// so the panel must be invoked with `hideTags`.

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, vars?: Record<string, string | number>) => {
      if (vars) {
        return Object.entries(vars).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
          key,
        );
      }
      return key;
    },
}));

vi.mock("@/hooks/useShortcuts", () => ({
  useShortcuts: () => undefined,
}));

const propertiesPanelCalls: Array<Record<string, unknown>> = [];
const markdownPreviewCalls: Array<Record<string, unknown>> = [];

vi.mock("@/components/PropertiesPanel", () => ({
  PropertiesPanel: (props: Record<string, unknown>) => {
    propertiesPanelCalls.push(props);
    return <div data-testid="properties-panel-stub" />;
  },
}));

vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: (props: Record<string, unknown>) => {
    markdownPreviewCalls.push(props);
    return <div data-testid="markdown-preview-stub" />;
  },
}));

const Editor = (await import("../Editor")).default;

interface FetchSpec {
  ok: boolean;
  status?: number;
  text?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function stubFetch(plan: Record<string, FetchSpec[]>) {
  const orderedPatterns = Object.keys(plan).sort(
    (a, b) => b.length - a.length,
  );
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const pattern of orderedPatterns) {
      if (!url.includes(pattern)) continue;
      const queue = plan[pattern];
      const next = queue.shift();
      if (!next) {
        throw new Error(`stubFetch: queue empty for ${pattern} (url=${url})`);
      }
      return {
        ok: next.ok,
        status: next.status ?? (next.ok ? 200 : 400),
        headers: new Headers(next.headers ?? {}),
        json: async () => next.body,
        text: async () => next.text ?? "",
      } as Response;
    }
    throw new Error(`stubFetch: unmatched ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  propertiesPanelCalls.length = 0;
  markdownPreviewCalls.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SOURCE_WITH_FRONTMATTER = `---
origin: ask_answer
query: テスト用クエリ
tags:
  - foo
  - bar
saved_at: 2026-05-06T07:23:40Z
---

# Body heading

paragraph.
`;

describe("Editor preview pane Phase 3 fm-card", () => {
  it("renders PropertiesPanel with hideTags above MarkdownPreview in preview mode", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        {
          ok: true,
          text: SOURCE_WITH_FRONTMATTER,
          headers: { etag: '"abc"' },
        },
      ],
    });

    const { container } = render(
      <Editor fileId="f1" filename="note.md" drive="d" inlineMode />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("editArea")).toBeInTheDocument();
    });

    // Default mode is "edit" — switch to preview so the preview pane
    // mounts.
    fireEvent.click(screen.getByLabelText("preview"));

    await waitFor(() => {
      expect(screen.getByTestId("properties-panel-stub")).toBeInTheDocument();
    });
    expect(screen.getByTestId("markdown-preview-stub")).toBeInTheDocument();

    // PropertiesPanel was invoked with the parsed frontmatter and
    // hideTags=true (tag editing lives in the inspector).
    const lastPanel = propertiesPanelCalls.at(-1);
    expect(lastPanel).toBeDefined();
    expect(lastPanel!.hideTags).toBe(true);
    const fm = lastPanel!.frontmatter as Record<string, unknown>;
    expect(fm.origin).toBe("ask_answer");
    expect(fm.query).toBe("テスト用クエリ");
    expect(fm.tags).toEqual(["foo", "bar"]);

    // MarkdownPreview runs in chrome=false so it stops rendering its
    // own wrapper card / built-in PropertiesPanel.
    const lastBody = markdownPreviewCalls.at(-1);
    expect(lastBody).toBeDefined();
    expect(lastBody!.chrome).toBe(false);
    // The body source it receives must NOT contain the YAML
    // frontmatter — it has been hoisted into the panel above.
    const renderedSource = (lastBody!.source as string) ?? "";
    expect(renderedSource).not.toContain("---");
    expect(renderedSource).not.toContain("ask_answer");
    expect(renderedSource).toContain("Body heading");

    // DOM order: PropertiesPanel must come before MarkdownPreview
    // inside the preview pane, matching the mock fm-card layout.
    const panelEl = container.querySelector(
      '[data-testid="properties-panel-stub"]',
    );
    const previewEl = container.querySelector(
      '[data-testid="markdown-preview-stub"]',
    );
    expect(panelEl).not.toBeNull();
    expect(previewEl).not.toBeNull();
    expect(
      panelEl!.compareDocumentPosition(previewEl!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not render the fm-card panel when frontmatter is empty", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        {
          ok: true,
          text: "# just a heading\n\nplain note, no frontmatter.\n",
          headers: { etag: '"abc"' },
        },
      ],
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);

    await waitFor(() => {
      expect(screen.getByLabelText("editArea")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("preview"));

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview-stub")).toBeInTheDocument();
    });

    // When there is no frontmatter, the panel must not render. The
    // PropertiesPanel stub itself is mounted only if Editor invokes
    // it — Phase 3 must short-circuit on empty frontmatter to avoid a
    // stray empty card above the body (mirrors PropertiesPanel's own
    // entries.length === 0 → null behaviour).
    expect(screen.queryByTestId("properties-panel-stub")).toBeNull();
  });

  it("hides the fm-card panel in edit mode (mounted under hidden ancestor)", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        {
          ok: true,
          text: SOURCE_WITH_FRONTMATTER,
          headers: { etag: '"abc"' },
        },
      ],
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);

    await waitFor(() => {
      expect(screen.getByLabelText("editArea")).toBeInTheDocument();
    });

    // Default view mode is "edit". The preview pane is kept mounted
    // (so mermaid SVGs etc. don't get re-rendered on every view-mode
    // flip) but is CSS-hidden via Tailwind ``hidden``. Verify the
    // panel is mounted inside a hidden ancestor — that's the contract
    // that protects "no fm-card visible while editing".
    const panel = screen.queryByTestId("properties-panel-stub");
    expect(panel).not.toBeNull();
    let ancestor: HTMLElement | null = panel;
    let foundHidden = false;
    while (ancestor) {
      if (ancestor.classList.contains("hidden")) {
        foundHidden = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    expect(foundHidden).toBe(true);
  });

  it("renders the fm-card panel in split mode (right side preview)", async () => {
    stubFetch({
      "/api/files/f1/stream": [
        {
          ok: true,
          text: SOURCE_WITH_FRONTMATTER,
          headers: { etag: '"abc"' },
        },
      ],
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);

    await waitFor(() => {
      expect(screen.getByLabelText("editArea")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("split"));

    await waitFor(() => {
      expect(screen.getByTestId("properties-panel-stub")).toBeInTheDocument();
    });
    const lastPanel = propertiesPanelCalls.at(-1);
    expect(lastPanel!.hideTags).toBe(true);
  });
});
