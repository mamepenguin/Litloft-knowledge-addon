import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string) =>
      key,
}));

let _mockDrive: string | null = "test-drive";
vi.mock("@/components/CurrentDriveProvider", () => ({
  useCurrentDrive: () => _mockDrive,
}));

vi.mock("@/components/SidebarProvider", () => ({
  useOverlaySidebar: () => undefined,
}));

let _searchParam: string | null = null;
const _routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (k: string) => {
      if (k === "edit") return _searchParam;
      return null;
    },
  }),
  useRouter: () => ({
    replace: _routerReplace,
    push: vi.fn(),
    back: vi.fn(),
  }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/featureFlags", () => ({
  isInlineKnowledgeEditorEnabled: () =>
    process.env.NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR !== "false",
}));

vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => null,
}));

// KnowledgeDashboard mocked to a simple stub so Page tests stay focused.
vi.mock("../KnowledgeDashboard", () => ({
  default: () => <div data-testid="knowledge-dashboard" />,
}));

const fileA = {
  id: "file-a",
  filename: "a.md",
  title: "A",
  drive: "test-drive",
  folder_path: "",
  file_type: "document",
  mime_type: "text/markdown",
  thumbnail_url: "",
  file_size: 0,
  created_at: "",
  updated_at: "",
};

function stubFetch(
  handler: (url: string) => { ok: boolean; status: number; body: unknown },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const { ok, status, body } = handler(url);
      return {
        ok,
        status,
        headers: new Headers(),
        json: async () => body,
      } as Response;
    }),
  );
}

function defaultHandler(url: string) {
  if (url.match(/\/api\/files\/[^/]+$/)) {
    return { ok: true, status: 200, body: fileA };
  }
  return { ok: false, status: 404, body: null };
}

const Page = (await import("../Page")).default;

describe("KnowledgePage", () => {
  beforeEach(() => {
    _mockDrive = "test-drive";
    _searchParam = null;
    _routerReplace.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders KnowledgeDashboard by default", async () => {
    stubFetch(defaultHandler);
    render(<Page />);
    expect(await screen.findByTestId("knowledge-dashboard")).toBeTruthy();
  });

  it("redirects ?edit={id} to canonical 2-pane URL when inline-editor flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    _searchParam = "file-a";
    stubFetch(defaultHandler);

    render(<Page />);

    await waitFor(() => {
      expect(_routerReplace).toHaveBeenCalled();
    });
    const target = _routerReplace.mock.calls[0][0] as string;
    const url = new URL(`http://localhost${target}`);
    expect(url.pathname).toBe("/drive/test-drive");
    expect(url.searchParams.get("file")).toBe("file-a");
    expect(url.searchParams.get("edit")).toBe("1");
  });

  it("does NOT redirect when inline-editor flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "false");
    _searchParam = "file-a";
    stubFetch(defaultHandler);

    render(<Page />);

    // Wait for any async effects to settle.
    await waitFor(() => {
      expect(screen.getByTestId("knowledge-dashboard")).toBeTruthy();
    });
    expect(_routerReplace).not.toHaveBeenCalled();
  });

  it("does NOT redirect non-editable mimes even when flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    _searchParam = "file-vid";
    stubFetch((url) => {
      if (url.match(/\/api\/files\/file-vid$/)) {
        return {
          ok: true,
          status: 200,
          body: { ...fileA, id: "file-vid", mime_type: "video/mp4" },
        };
      }
      return defaultHandler(url);
    });

    render(<Page />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    expect(_routerReplace).not.toHaveBeenCalled();
  });
});
