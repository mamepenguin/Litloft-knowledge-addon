/**
 * SPEC-ADDON-101: Notes leaves clips out unless asked. Invariant ids are those
 * of docs/specs/clips-app.md. Core requests are answered at `fetch`, so the
 * assertions read the query strings the spec names. Labels are the English
 * messages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { FileItem } from "@/types";

const DRIVE = "d";
const PATH = "/drive/d/addons/knowledge";

let params = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push, replace, back: vi.fn() }),
  usePathname: () => PATH,
}));
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => DRIVE }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
let nickname: string | null = "alice";
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname, setNickname: vi.fn(), clearNickname: vi.fn() }),
}));
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => ({ enabled: true, isLoading: false }) }));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => null }));
vi.mock("@/components/FolderPicker", () => ({ FolderPicker: () => <div data-testid="folder-picker" /> }));
vi.mock("@/components/quick-note", () => ({ useQuickNote: () => ({ open: vi.fn() }) }));
vi.mock("../ConnectionsGraph", () => ({ default: () => null }));
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, fetchNoteOpenings: vi.fn(async () => ({})) };
});

const NotesPage = (await import("../NotesPage")).default;

const calls: URL[] = [];

function note(id: string, folder = "journal"): FileItem {
  return {
    id,
    filename: `${id}.md`,
    title: `Note ${id}`,
    drive: DRIVE,
    folder_path: folder,
    mime_type: "text/markdown",
    file_type: "document",
    tags: ["AI"],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as FileItem;
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function route(input: RequestInfo | URL): Promise<Response> {
  const u = new URL(String(input), "http://x");
  calls.push(u);
  if (u.pathname.endsWith("/files")) {
    return respond({ data: [note("a", "Knowledge"), note("b", "")], meta: { total: 2, page: 1, limit: 30 } });
  }
  if (u.pathname.endsWith("/watch-history")) return respond({ data: [note("w")] });
  if (u.pathname.endsWith("/folder-counts")) {
    return respond([
      { path: "", count: 1 },
      { path: "Knowledge", count: 1 },
    ]);
  }
  if (u.pathname.endsWith("/tags")) return respond([{ name: "AI", count: 2 }]);
  return respond({}, 404);
}

const at = (suffix: string) => calls.filter((u) => u.pathname === `/api/drives/${DRIVE}/${suffix}`);
const excluded = (u: URL) => u.searchParams.get("exclude_origin");
const INCLUDE = "Include clips";

beforeEach(() => {
  params = new URLSearchParams();
  nickname = "alice";
  calls.length = 0;
  push.mockReset();
  replace.mockReset();
  vi.stubGlobal("fetch", vi.fn(route));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SPEC-ADDON-101 I13 I15 the Notes landing", () => {
  it("SPEC-ADDON-101 drops clips from Recent notes and Continue writing, and its search still finds them", async () => {
    const { rerender } = render(<NotesPage />);
    await screen.findByText("Note a");
    await waitFor(() => expect(at("watch-history").length).toBeGreaterThan(0));

    expect(at("files").map(excluded)).toEqual(at("files").map(() => "webclip"));
    expect(at("files").length).toBeGreaterThan(0);
    expect(at("watch-history").map(excluded)).toEqual(at("watch-history").map(() => "webclip"));

    calls.length = 0;
    params = new URLSearchParams({ q: "kyoto" });
    rerender(<NotesPage />);
    await waitFor(() => expect(at("files").some((u) => u.searchParams.get("search") === "kyoto")).toBe(true));

    const search = at("files").filter((u) => u.searchParams.get("search") === "kyoto");
    expect(search.map(excluded)).toEqual(search.map(() => null));
  });
});

describe("SPEC-ADDON-101 I13 I14 All notes", () => {
  it.each([
    ["the list", {}],
    ["a search", { q: "kyoto" }],
    ["a folder and a tag", { folder: "Knowledge", tag: "AI", sort: "title" }],
  ])("SPEC-ADDON-101 drops clips from %s and from the folder counts by default", async (_, extra) => {
    params = new URLSearchParams({ view: "all", ...extra });
    render(<NotesPage />);
    await screen.findByText("Note a");
    await waitFor(() => expect(at("folder-counts").length).toBeGreaterThan(0));

    expect(at("files").map(excluded)).toEqual(at("files").map(() => "webclip"));
    expect(at("folder-counts").map(excluded)).toEqual(at("folder-counts").map(() => "webclip"));
  });

  it("SPEC-ADDON-101 I14 asks with no origin condition, and keeps clips=1 on every link, with clips=1", async () => {
    params = new URLSearchParams({ view: "all", clips: "1", folder: "Knowledge" });
    render(<NotesPage />);
    await screen.findByText("Note a");
    await waitFor(() => expect(at("folder-counts").length).toBeGreaterThan(0));
    await screen.findByRole("link", { name: /^AI/ });

    expect(at("files").map(excluded)).toEqual(at("files").map(() => null));
    expect(at("folder-counts").map(excluded)).toEqual(at("folder-counts").map(() => null));
    const viewLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a"))
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => h.startsWith(PATH) && h.includes("view=all"));
    expect(viewLinks.length).toBeGreaterThan(2);
    for (const href of viewLinks) expect(new URL(href, "http://x").searchParams.get("clips"), href).toBe("1");
  });

  it("SPEC-ADDON-101 leaves clips out of the URL by default, behind an unpressed Include clips toggle that sets it", async () => {
    params = new URLSearchParams({ view: "all", folder: "Knowledge" });
    render(<NotesPage />);
    await screen.findByText("Note a");

    const toggle = screen.getByRole("button", { name: INCLUDE });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((h) => h.includes("clips="))).toEqual([]);

    fireEvent.click(toggle);
    const went = [...push.mock.calls, ...replace.mock.calls].map(([to]) => new URL(String(to), "http://x"));
    expect(went).toHaveLength(1);
    expect(went[0].pathname).toBe(PATH);
    expect(went[0].searchParams.get("view")).toBe("all");
    expect(went[0].searchParams.get("clips")).toBe("1");
    expect(went[0].searchParams.get("folder")).toBe("Knowledge");
  });

  it("SPEC-ADDON-101 shows the toggle pressed with clips=1, and turning it off removes clips", async () => {
    params = new URLSearchParams({ view: "all", clips: "1" });
    render(<NotesPage />);
    await screen.findByText("Note a");

    const toggle = screen.getByRole("button", { name: INCLUDE });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    const went = [...push.mock.calls, ...replace.mock.calls].map(([to]) => new URL(String(to), "http://x"));
    expect(went).toHaveLength(1);
    expect(went[0].searchParams.get("view")).toBe("all");
    expect(went[0].searchParams.has("clips")).toBe(false);
  });

  it("SPEC-ADDON-101 re-fetches page 1 without the condition when clips=1 arrives", async () => {
    params = new URLSearchParams({ view: "all" });
    const { rerender } = render(<NotesPage />);
    await screen.findByText("Note a");
    const before = at("files").length;

    params = new URLSearchParams({ view: "all", clips: "1" });
    rerender(<NotesPage />);
    await act(async () => {});

    await waitFor(() => expect(at("files").length).toBeGreaterThan(before));
    const latest = at("files").at(-1)!;
    expect(excluded(latest)).toBeNull();
    expect(["1", null]).toContain(latest.searchParams.get("page"));
    expect(["0", null]).toContain(latest.searchParams.get("offset"));
  });
});
