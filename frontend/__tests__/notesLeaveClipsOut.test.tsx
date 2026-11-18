/**
 * SPEC-ADDON-130 / SPEC-ADDON-131 I1: Notes shows no web clip, whatever the
 * Target or the URL says. Core requests are answered at `fetch`, so the
 * assertions read the query strings the spec names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import type { FileItem } from "@/types";

const DRIVE = "d";
const PATH = "/drive/d/addons/knowledge";

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => PATH,
}));
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => DRIVE }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname: "alice", setNickname: vi.fn(), clearNickname: vi.fn() }),
}));
vi.mock("@/components/quick-note", () => ({ useQuickNote: () => ({ open: vi.fn() }) }));
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, fetchNoteOpenings: vi.fn(async () => ({})) };
});
vi.mock("../notesapp/sourcesApi", async () => ({
  getNotesWithSources: vi.fn(async () => ["a"]),
  getNoteSources: vi.fn(async () => ({})),
}));
vi.mock("../library/NotesLibrary", () => ({ default: () => <div data-testid="library" /> }));

const NotesPage = (await import("../NotesPage")).default;

const calls: URL[] = [];

function note(id: string): FileItem {
  return {
    id,
    filename: `${id}.md`,
    title: `Note ${id}`,
    drive: DRIVE,
    folder_path: "journal",
    mime_type: "text/markdown",
    file_type: "document",
    tags: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as FileItem;
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function route(input: RequestInfo | URL): Promise<Response> {
  const u = new URL(String(input), "http://x");
  calls.push(u);
  if (u.pathname.endsWith("/files")) {
    return respond({ data: [note("a"), note("b")], meta: { total: 2, page: 1, limit: 60 } });
  }
  if (u.pathname.endsWith("/watch-history")) return respond({ data: [note("w")] });
  if (u.pathname.endsWith("/smart-folders") || u.pathname.endsWith("/collections")) return respond([]);
  return respond({}, 404);
}

const at = (suffix: string) => calls.filter((u) => u.pathname === `/api/drives/${DRIVE}/${suffix}`);

beforeEach(() => {
  params = new URLSearchParams();
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(route));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SPEC-ADDON-131 I1 Notes Home leaves clips out", () => {
  it.each([
    ["by default", {}],
    ["with clips=1, which is ignored", { clips: "1" }],
  ])("asks for every listing and the history without clips %s", async (_, extra) => {
    params = new URLSearchParams(extra);
    render(<NotesPage />);
    await screen.findByText("Note b");
    await waitFor(() => expect(at("watch-history").length).toBeGreaterThan(0));

    expect(at("files").length).toBeGreaterThanOrEqual(3);
    for (const u of at("files")) {
      expect(u.searchParams.get("exclude_origin")).toBe("webclip");
      expect(u.searchParams.get("origin")).toBeNull();
      expect(u.searchParams.getAll("type")).toEqual(["text"]);
    }
    for (const u of at("watch-history")) expect(u.searchParams.get("exclude_origin")).toBe("webclip");
  });

  it("draws no toggle that would bring clips back", async () => {
    params = new URLSearchParams({ view: "all", clips: "1" });
    render(<NotesPage />);
    await screen.findByTestId("library");
    expect(screen.queryByRole("button", { name: /clips/i })).toBeNull();
    for (const u of at("files")) expect(u.searchParams.get("exclude_origin")).toBe("webclip");
  });
});
