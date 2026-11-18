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

const overlaySidebar = vi.fn();
vi.mock("@/components/SidebarProvider", () => ({
  useOverlaySidebar: () => overlaySidebar(),
}));

let _query = new URLSearchParams();
const _routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => _query,
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

vi.mock("../NotesPage", () => ({
  default: () => <div data-testid="notes-page" />,
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
const BASE = "/drive/test-drive/addons/knowledge";

describe("KnowledgePage", () => {
  beforeEach(() => {
    _mockDrive = "test-drive";
    _query = new URLSearchParams();
    _routerReplace.mockReset();
    overlaySidebar.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders the Notes page by default", async () => {
    stubFetch(defaultHandler);
    render(<Page />);
    expect(await screen.findByTestId("notes-page")).toBeTruthy();
  });

  it("redirects ?edit={id} to canonical 2-pane URL when inline-editor flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    _query = new URLSearchParams({ edit: "file-a" });
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

  it("lands on Home without edit, and sends no file request, when the inline-editor flag is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "false");
    _query = new URLSearchParams({ edit: "file-a" });
    stubFetch(defaultHandler);

    render(<Page />);

    await waitFor(() => expect(_routerReplace).toHaveBeenCalledWith(BASE));
    expect(_routerReplace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("notes-page")).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["a video", { ...fileA, id: "file-vid", mime_type: "video/mp4" }, 200],
    ["a file that is gone", null, 404],
  ])("lands on Home without edit for %s even when the flag is on", async (_, body, status) => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    _query = new URLSearchParams({ edit: "file-vid" });
    stubFetch(() => ({ ok: status === 200, status, body }));

    render(<Page />);

    await waitFor(() => expect(_routerReplace).toHaveBeenCalledWith(BASE));
    expect(_routerReplace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("notes-page")).toBeTruthy();
  });

  it("keeps the other parameters of the URL when it drops edit", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "false");
    _query = new URLSearchParams({ view: "all", folder: "journal", edit: "file-a" });
    stubFetch(defaultHandler);

    render(<Page />);

    await waitFor(() => expect(_routerReplace).toHaveBeenCalledWith(`${BASE}?view=all&folder=journal`));
  });

  it("does not touch the URL when it holds no entry parameter", async () => {
    _query = new URLSearchParams({ view: "all", folder: "journal", q: "kyoto" });
    stubFetch(defaultHandler);
    render(<Page />);
    await screen.findByTestId("notes-page");
    expect(_routerReplace).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not call useOverlaySidebar, so the sidebar stays inline", async () => {
    stubFetch(defaultHandler);
    render(<Page />);
    await screen.findByTestId("notes-page");
    expect(overlaySidebar).not.toHaveBeenCalled();
  });
});

describe("SPEC-ADDON-130 entry URLs", () => {
  beforeEach(() => {
    _mockDrive = "test-drive";
    _routerReplace.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("replaces ?q=<query> without a view with the Library search, and draws no page meanwhile", async () => {
    _query = new URLSearchParams({ q: "  a&b 旅行 " });
    render(<Page />);
    await waitFor(() =>
      expect(_routerReplace).toHaveBeenCalledWith(`${BASE}?view=all&q=${encodeURIComponent("a&b 旅行").replace(/%20/g, "+")}`),
    );
    expect(_routerReplace).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("notes-page")).toBeNull();
  });

  it.each([
    ["with view=all", { view: "all", q: "kyoto" }],
    ["blank", { q: "   " }],
  ])("leaves ?q= alone when it is %s", async (_, query) => {
    _query = new URLSearchParams(query);
    render(<Page />);
    await screen.findByTestId("notes-page");
    expect(_routerReplace).not.toHaveBeenCalled();
  });

  it("replaces ?prefill=… with the Clips page and the same query string", async () => {
    _query = new URLSearchParams({ prefill: "https://example.com/a?b=1", title: "T", autosubmit: "1" });
    render(<Page />);
    await waitFor(() =>
      expect(_routerReplace).toHaveBeenCalledWith(`${BASE}/clips?${_query.toString()}`),
    );
    expect(_routerReplace).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("notes-page")).toBeNull();
  });

  it("sends a prefill with a q to Clips, not to the Library", async () => {
    _query = new URLSearchParams({ prefill: "https://example.com", q: "kyoto" });
    render(<Page />);
    await waitFor(() => expect(_routerReplace).toHaveBeenCalled());
    expect(_routerReplace.mock.calls.map(([to]) => to)).toEqual([`${BASE}/clips?${_query.toString()}`]);
  });

  it("encodes a drive name that needs it into the replacement", async () => {
    _mockDrive = "動画 d";
    _query = new URLSearchParams({ prefill: "https://example.com" });
    render(<Page />);
    await waitFor(() =>
      expect(_routerReplace).toHaveBeenCalledWith(
        `/drive/${encodeURIComponent("動画 d")}/addons/knowledge/clips?prefill=https%3A%2F%2Fexample.com`,
      ),
    );
  });

  it("opens the Library for ?view=all&clips=1 and does not redirect, clips being ignored", async () => {
    _query = new URLSearchParams({ view: "all", clips: "1" });
    render(<Page />);
    await screen.findByTestId("notes-page");
    expect(_routerReplace).not.toHaveBeenCalled();
  });
});
