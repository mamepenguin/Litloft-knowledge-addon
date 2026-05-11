import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Phase 4 spec 2026-05-10 §D5 / hako sFXCwZDluTPZZkbYuozwJ: on mobile
// widths, the Knowledge Editor's 3-mode toggle drops "split" — Markdown
// split mode is meaningless at <768px (textarea + preview side-by-side
// would each be ~187px on a 375px viewport). Already-established
// Knowledge Page.tsx behaviour, now enforced inside Editor.tsx itself.

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

vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => null,
}));

vi.mock("@/components/PropertiesPanel", () => ({
  PropertiesPanel: () => null,
}));

vi.mock("@/hooks/useShortcuts", () => ({
  useShortcuts: () => undefined,
}));

const Editor = (await import("../Editor")).default;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const minMatch = query.match(/min-width:\s*(\d+)px/);
    const maxMatch = query.match(/max-width:\s*(\d+)px/);
    let matches = false;
    if (minMatch) matches = width >= Number(minMatch[1]);
    if (maxMatch) matches = width <= Number(maxMatch[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
}

interface FetchSpec {
  ok: boolean;
  status?: number;
  text?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function stubFetch(plan: Record<string, FetchSpec[]>) {
  const orderedPatterns = Object.keys(plan).sort((a, b) => b.length - a.length);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      for (const pattern of orderedPatterns) {
        if (!url.includes(pattern)) continue;
        const queue = plan[pattern];
        const next = queue.shift();
        if (!next) throw new Error(`stubFetch: queue empty for ${pattern}`);
        return {
          ok: next.ok,
          status: next.status ?? (next.ok ? 200 : 400),
          headers: new Headers(next.headers ?? {}),
          json: async () => next.body,
          text: async () => next.text ?? "",
        } as Response;
      }
      throw new Error(`stubFetch: unmatched ${url}`);
    }),
  );
}

beforeEach(() => {
  setViewportWidth(1024);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Editor mobile view-mode toggle (Phase 4)", () => {
  it("renders all three toggle buttons (edit/split/preview) at desktop width", async () => {
    setViewportWidth(1024);
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"abc"' } },
      ],
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    await waitFor(() => {
      expect(screen.getByLabelText("editArea")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("edit")).toBeInTheDocument();
    expect(screen.getByLabelText("split")).toBeInTheDocument();
    expect(screen.getByLabelText("preview")).toBeInTheDocument();
  });

  it("hides the split toggle at mobile width (<768px)", async () => {
    setViewportWidth(420);
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"abc"' } },
      ],
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    await waitFor(() => {
      expect(screen.getByLabelText("editArea")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("edit")).toBeInTheDocument();
    expect(screen.queryByLabelText("split")).toBeNull();
    expect(screen.getByLabelText("preview")).toBeInTheDocument();
  });

  it("falls back to preview when split was the persisted mode and viewport shrinks", async () => {
    setViewportWidth(1024);
    stubFetch({
      "/api/files/f1/stream": [
        { ok: true, text: "hello", headers: { etag: '"abc"' } },
      ],
    });

    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    await waitFor(() => {
      expect(screen.getByLabelText("editArea")).toBeInTheDocument();
    });

    // Switch to split at desktop width.
    fireEvent.click(screen.getByLabelText("split"));
    expect(screen.getByLabelText("split")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Resize down: split is no longer a valid mode, so the editor
    // falls back to preview. Bouncing through edit would be jarring;
    // preview keeps the user looking at the rendered version.
    setViewportWidth(420);
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(screen.queryByLabelText("split")).toBeNull();
      expect(screen.getByLabelText("preview")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });
});
