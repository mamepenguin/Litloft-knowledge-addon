import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
  useSearchParams: () => ({ get: (_k: string) => _searchParam }),
  useRouter: () => ({
    replace: _routerReplace,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

// Stub MarkdownPreview: the real one uses remark/rehype which breaks jsdom.
vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => null,
}));

const Page = (await import("../Page")).default;

const vault = {
  id: 1,
  label: "Work",
  drive: "test-drive",
  path: "Notes",
  is_active: true,
  created_at: "",
};

const fileA = {
  id: "file-a",
  filename: "a.md",
  title: "A",
  drive: "test-drive",
  folder_path: "Notes",
  file_type: "document",
  mime_type: "text/markdown",
  thumbnail_url: "",
  file_size: 0,
  created_at: "",
  updated_at: "",
};

function stubFetch(handler: (url: string) => { ok: boolean; status: number; body: unknown; headers?: Record<string, string> }) {
  const fetchMock = vi.fn(async (url: string) => {
    const { ok, status, body, headers } = handler(url);
    return {
      ok,
      status,
      headers: new Headers(headers ?? {}),
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function defaultHandler(url: string) {
  if (url.includes("/api/addons/knowledge/vaults")) {
    return {
      ok: true,
      status: 200,
      body: { vaults: [vault], active_vault_id: 1 },
    };
  }
  if (url.match(/\/api\/addons\/knowledge\/folders/)) {
    return { ok: true, status: 200, body: [] };
  }
  if (url.match(/\/api\/addons\/knowledge\/files\?/)) {
    return { ok: true, status: 200, body: { data: [fileA], total: 1 } };
  }
  if (url.match(/\/api\/files\/[^/]+\/stream$/)) {
    return {
      ok: true,
      status: 200,
      body: "# hello",
      headers: { etag: '"abc123"' },
    };
  }
  if (url.match(/\/api\/files\/[^/]+$/)) {
    return { ok: true, status: 200, body: fileA };
  }
  return { ok: false, status: 404, body: null };
}

// jsdom storage may be missing in some envs — provide an in-memory shim.
function setupStorage() {
  const store = new Map<string, string>();
  const shim = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: shim,
  });
  return shim;
}

describe("KnowledgePage sidebar toggle & mobile layout", () => {
  beforeEach(() => {
    _mockDrive = "test-drive";
    _searchParam = null;
    _routerReplace.mockReset();
    setupStorage();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("renders sidebar by default (no file selected)", async () => {
    stubFetch(defaultHandler);
    const { container } = render(<Page />);
    await waitFor(() => {
      expect(container.querySelector("aside")).toBeTruthy();
    });
  });

  it("persists sidebar-hidden state to localStorage via editor toggle", async () => {
    // Toggle lives in Editor header now, so a file must be selected.
    _searchParam = "file-a";
    stubFetch(defaultHandler);
    render(<Page />);

    const toggle = await screen.findByLabelText("hide");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(window.localStorage.getItem("knowledge:sidebarHidden")).toBe("1");
    });
  });

  it("restores sidebar-hidden state from localStorage (with file open)", async () => {
    window.localStorage.setItem("knowledge:sidebarHidden", "1");
    _searchParam = "file-a";
    stubFetch(defaultHandler);
    render(<Page />);

    await screen.findByLabelText("show");
  });

  it("applies md:hidden to sidebar wrapper when hidden AND a file is selected", async () => {
    window.localStorage.setItem("knowledge:sidebarHidden", "1");
    _searchParam = "file-a";
    stubFetch(defaultHandler);
    const { container } = render(<Page />);

    await waitFor(() => {
      const wrapper = container.querySelector("[data-testid='knowledge-sidebar-wrapper']");
      expect(wrapper).toBeTruthy();
      expect(wrapper!.className).toContain("md:hidden");
    });
  });

  it("fallback: forces sidebar visible when no file is selected even if sidebarHidden=1", async () => {
    // A persisted "hidden" preference must NOT collapse the sidebar while
    // the EmptyState is showing — otherwise the user is stranded with no
    // way to navigate.
    window.localStorage.setItem("knowledge:sidebarHidden", "1");
    stubFetch(defaultHandler);
    const { container } = render(<Page />);

    await waitFor(() => {
      const wrapper = container.querySelector("[data-testid='knowledge-sidebar-wrapper']");
      expect(wrapper).toBeTruthy();
      // No file selected: effectiveSidebarHidden=false → md:flex, not md:hidden
      expect(wrapper!.className).toContain("md:flex");
      expect(wrapper!.className).not.toContain("md:hidden");
    });
  });

  it("sidebar wrapper has mobile exclusive classes when file selected", async () => {
    _searchParam = "file-a";
    stubFetch(defaultHandler);
    const { container } = render(<Page />);

    await waitFor(() => {
      const wrapper = container.querySelector("[data-testid='knowledge-sidebar-wrapper']");
      expect(wrapper).toBeTruthy();
      // When a file is selected, sidebar should be hidden on mobile (hidden class)
      // but visible on md+ (md:flex)
      expect(wrapper!.className).toContain("hidden");
      expect(wrapper!.className).toContain("md:flex");
    });
  });

  it("main wrapper is hidden on mobile when no file selected", async () => {
    stubFetch(defaultHandler);
    const { container } = render(<Page />);

    await waitFor(() => {
      const main = container.querySelector("[data-testid='knowledge-main-wrapper']");
      expect(main).toBeTruthy();
      // No file selected: main hidden on mobile, visible on md+
      expect(main!.className).toContain("hidden");
      expect(main!.className).toContain("md:flex");
    });
  });

  it("sidebar wrapper is full width on mobile and md:w-72 on desktop", async () => {
    stubFetch(defaultHandler);
    const { container } = render(<Page />);

    await waitFor(() => {
      const wrapper = container.querySelector("[data-testid='knowledge-sidebar-wrapper']");
      expect(wrapper).toBeTruthy();
      expect(wrapper!.className).toContain("w-full");
      expect(wrapper!.className).toContain("md:w-72");
    });

    // Inner <aside> must not pin to a fixed small width, otherwise
    // mobile layout gets a narrow gutter.
    const aside = container.querySelector("aside");
    expect(aside).toBeTruthy();
    expect(aside!.className).toContain("w-full");
    expect(aside!.className).not.toContain("w-72");
  });

  it("redirects ?edit={id} to canonical 2-pane URL when flag is on (case P)", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    _searchParam = "file-a";
    stubFetch(defaultHandler);

    render(<Page />);

    await waitFor(() => {
      expect(_routerReplace).toHaveBeenCalled();
    });
    const target = _routerReplace.mock.calls[0][0] as string;
    const url = new URL(`http://localhost${target}`);
    expect(url.pathname).toBe("/drive/test-drive/Notes");
    expect(url.searchParams.get("file")).toBe("file-a");
    expect(url.searchParams.get("edit")).toBe("1");
  });

  it("does NOT redirect when flag is off (legacy ?edit={id} stays on Knowledge route)", async () => {
    // Flag unset (default false).
    _searchParam = "file-a";
    stubFetch(defaultHandler);

    render(<Page />);

    await waitFor(() => {
      // Legacy path opens the editor inline in Knowledge route — the
      // textarea (label='editArea') is the proof we never bounced.
      expect(screen.getByLabelText("editArea")).toBeInTheDocument();
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
          body: {
            ...fileA,
            id: "file-vid",
            mime_type: "video/mp4",
            filename: "v.mp4",
          },
        };
      }
      return defaultHandler(url);
    });

    render(<Page />);

    // Wait for the metadata fetch to settle.
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    expect(_routerReplace).not.toHaveBeenCalled();
  });

  it("toggle button has aria-pressed reflecting sidebarHidden state", async () => {
    _searchParam = "file-a";
    stubFetch(defaultHandler);
    render(<Page />);

    const toggle = await screen.findByLabelText("hide");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);

    await waitFor(() => {
      const shown = screen.getByLabelText("show");
      expect(shown.getAttribute("aria-pressed")).toBe("true");
    });
  });
});
