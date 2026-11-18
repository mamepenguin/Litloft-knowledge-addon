/**
 * SPEC-ADDON-130: the Notes frame — header, scope line, Target, tabs, entry URLs
 * and the empty state. Invariant ids are those of docs/specs/notes-app.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { usePathname } from "next/navigation";

import type { WireCall } from "@/__tests__/helpers/wireFetch";
import {
  BASE,
  DRIVE,
  captureHistory,
  findText,
  installNotesServer,
  isFiles,
  isFilesQuery,
  listsOrCounts,
  nav,
  router,
  setViewport,
  settle,
  textNodes,
  type Note,
  type Server,
} from "./notesAppHarness";

vi.mock("next-intl", async () => (await import("./notesAppHarness")).intlModule());
vi.mock("next/navigation", async () => (await import("./notesAppHarness")).navigationModule);
vi.mock("next/link", async () => {
  const { router: r } = await import("./notesAppHarness");
  return {
    default: ({ href, onClick, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
      <a
        href={String(href)}
        {...rest}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          onClick?.(e);
          if (!e.defaultPrevented) {
            e.preventDefault();
            r.push(String(href));
          }
        }}
      >
        {children}
      </a>
    ),
  };
});
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => "d" }));
const profile = vi.hoisted(() => ({ nickname: null as string | null }));
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname: profile.nickname, setNickname: vi.fn(), clearNickname: vi.fn() }),
}));
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => ({ enabled: true, isLoading: false }) }));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => null }));
const quickNote = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/components/quick-note", () => ({ useQuickNote: () => quickNote }));
const sidebar = vi.hoisted(() => ({ overlay: vi.fn() }));
vi.mock("@/components/SidebarProvider", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/SidebarProvider");
  return { ...actual, useOverlaySidebar: (...a: unknown[]) => sidebar.overlay(...a) };
});
const flags = vi.hoisted(() => ({ inline: true }));
vi.mock("@/lib/featureFlags", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/featureFlags");
  return { ...actual, isInlineKnowledgeEditorEnabled: () => flags.inline };
});
vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: (props: Record<string, unknown>) => (
    <div data-testid="markdown">
      {Object.entries(props)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => (
          <div key={k}>{v as string}</div>
        ))}
    </div>
  ),
}));
const member = vi.hoisted(() => ({ evaluation: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/memberTarget", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/memberTarget");
  return {
    ...actual,
    evaluateMemberTarget: (...a: unknown[]) =>
      member.evaluation ? member.evaluation() : (actual.evaluateMemberTarget as (...b: unknown[]) => unknown)(...a),
  };
});

const KnowledgePage = (await import("../Page")).default;

/** The App Router stops drawing a page whose route the URL has left. */
function Page() {
  const pathname = usePathname();
  return pathname === BASE ? <KnowledgePage /> : null;
}

const TARGET_KEY = `litloft.addon.knowledge.target.${DRIVE}`;

function smartFolder(id: string, name: string, query: string) {
  return {
    id,
    drive: DRIVE,
    name,
    query,
    file_type: null,
    sort_by: null,
    sort_order: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
  };
}

const NOTES: Note[] = [
  { id: "n1", title: "Alpha", folder: "Journal", tags: ["trip"], updated: "2026-11-10T09:00:00Z" },
  { id: "n2", title: "Beta", folder: "", tags: [], updated: "2026-11-09T09:00:00Z" },
  { id: "n3", title: "Gamma", folder: "Work", tags: ["trip"], updated: "2026-11-08T09:00:00Z" },
  { id: "c1", title: "Clipped", folder: "Clips", origin: "webclip", updated: "2026-11-11T09:00:00Z" },
];

let server: Server;
let smartFolders: unknown[];

function serve(notes: Note[] = NOTES, extra: Partial<Parameters<typeof installNotesServer>[0]> = {}) {
  server = installNotesServer({ notes, ...extra });
  const base = server.override;
  server.override = (call: WireCall) => {
    if (call.url.pathname === `/api/drives/${DRIVE}/smart-folders`) {
      return new Response(JSON.stringify(smartFolders), { status: 200, headers: { "content-type": "application/json" } });
    }
    return base(call);
  };
  return server;
}

beforeEach(() => {
  localStorage.clear();
  nav.set(BASE);
  router.push.mockClear();
  router.replace.mockClear();
  quickNote.open.mockReset();
  sidebar.overlay.mockReset();
  profile.nickname = null;
  flags.inline = true;
  member.evaluation = null;
  smartFolders = [];
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const tab = (name: string) => screen.getByRole("link", { name });
const listings = () => server.calls.filter(listsOrCounts);

describe("SPEC-ADDON-130 frame step 1, step 4: the app header and its tabs", () => {
  it("SPEC-ADDON-130 draws the title, the Target, New note and the two tabs, Home current", async () => {
    serve();
    render(<Page />);

    expect(await screen.findByRole("heading", { level: 1, name: "Notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Target/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New note" })).toBeInTheDocument();
    expect(new URL(tab("Home").getAttribute("href")!, "http://localhost").pathname).toBe(BASE);
    expect(new URL(tab("Home").getAttribute("href")!, "http://localhost").searchParams.get("view")).toBeNull();
    const library = new URL(tab("Library").getAttribute("href")!, "http://localhost");
    expect([library.pathname, library.searchParams.get("view")]).toEqual([BASE, "all"]);
    expect(tab("Home")).toHaveAttribute("aria-current", "page");
    expect(tab("Library")).not.toHaveAttribute("aria-current", "page");
  });

  it("SPEC-ADDON-130 I13 the page does not ask for an overlay sidebar", async () => {
    serve();
    render(<Page />);

    await screen.findByRole("link", { name: "Library" });
    expect(sidebar.overlay).not.toHaveBeenCalled();
  });

  it("SPEC-ADDON-130 the landing's search box, Web clip tile and whole-drive Connections tile are gone", async () => {
    serve();
    render(<Page />);

    await screen.findByRole("link", { name: "Library" });
    expect(screen.queryByRole("search")).toBeNull();
    const links = screen.queryAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    expect(links.filter((h) => h.endsWith(`${BASE}/connections`))).toEqual([]);
    expect(screen.queryByRole("button", { name: /clip/i })).toBeNull();
  });

  it("SPEC-ADDON-130 ?view=all marks Library current", async () => {
    nav.set(`${BASE}?view=all`);
    serve();
    render(<Page />);

    expect(await screen.findByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
    expect(tab("Home")).not.toHaveAttribute("aria-current", "page");
  });
});

describe("SPEC-ADDON-130 frame step 3, I2, I10: the scope line", () => {
  it("SPEC-ADDON-130 shows the drive and the listing's total under type=text and exclude_origin=webclip", async () => {
    serve();
    render(<Page />);

    expect(await findText(`${DRIVE} · 3 notes`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
    const counted = server.calls.filter((c) => isFiles(c) || isFilesQuery(c));
    expect(counted.length).toBeGreaterThan(0);
    for (const call of counted) {
      expect(call.url.searchParams.getAll("type")).toEqual(["text"]);
      expect(call.url.searchParams.get("exclude_origin")).toBe("webclip");
    }
  });

  it("SPEC-ADDON-130 I10 while the count loads the scope line names the drive and no 0", async () => {
    serve();
    server.override = (call) => (isFiles(call) || isFilesQuery(call) ? new Promise<Response>(() => {}) : null);
    render(<Page />);

    await screen.findByRole("link", { name: "Library" });
    await act(() => settle());
    expect(document.body.textContent).not.toMatch(/\b0 notes/);
    expect(screen.getAllByText(new RegExp(`^${DRIVE}$`)).length).toBeGreaterThan(0);
    expect(screen.queryByText("No notes yet")).toBeNull();
  });

  it("SPEC-ADDON-130 I10 when the count fails the scope line names the drive alone and Home still loads", async () => {
    serve();
    server.override = (call) => (isFiles(call) || isFilesQuery(call) ? new Response("{}", { status: 500 }) : null);
    render(<Page />);

    expect(await screen.findByText("Recently updated")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    await act(() => settle());
    expect(document.body.textContent).not.toMatch(/\d+ notes/);
    expect(screen.getAllByText(new RegExp(`^${DRIVE}$`)).length).toBeGreaterThan(0);
  });
});

describe("SPEC-ADDON-130 frame step 7, I19: the empty state", () => {
  it.each([
    ["Home", BASE],
    ["Library", `${BASE}?view=all`],
  ])("SPEC-ADDON-130 I19 a drive with no notes draws only the header, tabs and No notes yet on %s", async (_n, url) => {
    nav.set(url);
    profile.nickname = "alice";
    serve([{ id: "c1", title: "Clipped", folder: "", origin: "webclip" }], {
      history: [{ id: "h1", title: "Opened", folder: "" }],
    });
    render(<Page />);

    expect(await screen.findByText("No notes yet")).toBeInTheDocument();
    expect(textNodes(`${DRIVE} · 0 notes`)).not.toHaveLength(0);
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByText("Continue writing")).toBeNull();
    expect(screen.queryByText("Recently updated")).toBeNull();
    expect(screen.queryByText("Notes with sources")).toBeNull();
    expect(screen.queryByText("No notes here")).toBeNull();
    expect(screen.queryByText("Opened")).toBeNull();
  });
});

describe("SPEC-ADDON-130 frame step 2, I9: the Target", () => {
  it("SPEC-ADDON-130 a saved Smart Collection narrows every listing and count", async () => {
    smartFolders = [smartFolder("sf-trip", "Trip", "tag:trip")];
    localStorage.setItem(TARGET_KEY, "sf-trip");
    serve();
    render(<Page />);

    expect(await findText(`${DRIVE} · 2 notes`)).toBeInTheDocument();
    for (const call of listings()) {
      expect(call.url.searchParams.getAll("tag")).toContain("trip");
      expect(call.url.searchParams.getAll("type")).toEqual(["text"]);
      expect(call.url.searchParams.get("exclude_origin")).toBe("webclip");
    }
    expect(screen.getByRole("button", { name: /Target/ })).toHaveTextContent("Trip");
  });

  it("SPEC-ADDON-130 nothing that lists or counts notes goes out while the target is looked up", async () => {
    localStorage.setItem(TARGET_KEY, "sf-trip");
    serve();
    const base = server.override;
    server.override = (call) =>
      call.url.pathname === `/api/drives/${DRIVE}/smart-folders` ? new Promise<Response>(() => {}) : base(call);
    render(<Page />);

    await screen.findByRole("heading", { level: 1, name: "Notes" });
    await act(() => settle(100));
    expect(listings()).toEqual([]);
  });

  it("SPEC-ADDON-130 I9 choosing a target writes the Knowledge key and no other app's", async () => {
    smartFolders = [smartFolder("sf-trip", "Trip", "tag:trip")];
    serve();
    render(<Page />);
    await findText(`${DRIVE} · 3 notes`);

    fireEvent.click(screen.getByRole("button", { name: /Target/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Trip/ }));

    await waitFor(() => expect(localStorage.getItem(TARGET_KEY)).toBe("sf-trip"));
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
    expect(keys.filter((k) => /target\./.test(k))).toEqual([TARGET_KEY]);
    expect(await findText(`${DRIVE} · 2 notes`)).toBeInTheDocument();
  });

  it("SPEC-ADDON-130 I9 a saved target that is gone puts the default in force and keeps the saved id", async () => {
    smartFolders = [smartFolder("sf-other", "Other", "tag:trip")];
    localStorage.setItem(TARGET_KEY, "sf-gone");
    serve();
    render(<Page />);

    expect(await findText(`${DRIVE} · 3 notes`)).toBeInTheDocument();
    for (const call of listings()) expect(call.url.searchParams.getAll("tag")).toEqual([]);
    expect(localStorage.getItem(TARGET_KEY)).toBe("sf-gone");
    expect(screen.getByRole("button", { name: /Target/ })).toHaveTextContent("All notes");
  });

  it("SPEC-ADDON-130 frame step 2 a target with no text sends no listing and shows 0 notes", async () => {
    smartFolders = [smartFolder("sf-vid", "Videos", "type:video")];
    localStorage.setItem(TARGET_KEY, "sf-vid");
    serve();
    render(<Page />);

    expect(await findText(`${DRIVE} · 0 notes`)).toBeInTheDocument();
    expect(screen.getByText("No notes yet")).toBeInTheDocument();
    expect(server.calls.filter((c) => isFiles(c) || isFilesQuery(c))).toEqual([]);
  });

  it("SPEC-ADDON-130 frame step 2 a free-text Smart Collection sends its members through files/query", async () => {
    smartFolders = [smartFolder("sf-beach", "Beach", "beach")];
    localStorage.setItem(TARGET_KEY, "sf-beach");
    member.evaluation = async () => ({ status: "ready", fileIds: ["n1", "n3"] });
    serve();
    render(<Page />);

    expect(await findText(`${DRIVE} · 2 notes`)).toBeInTheDocument();
    expect(server.calls.filter(isFiles)).toEqual([]);
    const queried = server.calls.filter(isFilesQuery);
    expect(queried.length).toBeGreaterThan(0);
    for (const call of queried) {
      expect((call.body as { file_ids: string[] }).file_ids).toEqual(["n1", "n3"]);
      expect(call.url.searchParams.getAll("type")).toEqual(["text"]);
      expect(call.url.searchParams.get("exclude_origin")).toBe("webclip");
    }
  });

  it.each(["tooLarge", "failed"])(
    "SPEC-ADDON-130 I9 a member target that answers %s is unusable: default in force, saved id kept, marked unavailable",
    async (status) => {
      smartFolders = [smartFolder("sf-beach", "Beach", "beach")];
      localStorage.setItem(TARGET_KEY, "sf-beach");
      member.evaluation = async () => ({ status });
      serve();
      render(<Page />);

      expect(await findText(`${DRIVE} · 3 notes`)).toBeInTheDocument();
      expect(server.calls.filter(isFilesQuery)).toEqual([]);
      expect(localStorage.getItem(TARGET_KEY)).toBe("sf-beach");
      fireEvent.click(screen.getByRole("button", { name: /Target/ }));
      const item = await screen.findByRole("menuitemradio", { name: /Beach/ });
      expect(item).toBeDisabled();
      expect(item).toHaveAttribute("title", "Unavailable");
    },
  );

  it("SPEC-ADDON-130 the open menu counts All notes without clips", async () => {
    smartFolders = [smartFolder("sf-trip", "Trip", "tag:trip")];
    localStorage.setItem(TARGET_KEY, "sf-trip");
    serve();
    render(<Page />);
    await findText(`${DRIVE} · 2 notes`);

    fireEvent.click(screen.getByRole("button", { name: /Target/ }));

    await waitFor(() => {
      const counts = server.calls.filter(
        (c) => isFiles(c) && c.url.searchParams.get("limit") === "1" && !c.url.searchParams.has("tag"),
      );
      expect(counts.length).toBeGreaterThan(0);
      for (const call of counts) {
        expect([call.url.searchParams.getAll("type"), call.url.searchParams.get("exclude_origin")]).toEqual([["text"], "webclip"]);
      }
    });
  });

  it("SPEC-ADDON-130 frame step 4 the Target survives a tab switch", async () => {
    smartFolders = [smartFolder("sf-trip", "Trip", "tag:trip")];
    localStorage.setItem(TARGET_KEY, "sf-trip");
    serve();
    render(<Page />);
    await findText(`${DRIVE} · 2 notes`);

    fireEvent.click(screen.getByRole("link", { name: "Library" }));

    await waitFor(() => expect(nav.params.get("view")).toBe("all"));
    expect(nav.last()?.kind).toBe("push");
    await act(() => settle());
    expect(textNodes(`${DRIVE} · 2 notes`)).not.toHaveLength(0);
    expect(localStorage.getItem(TARGET_KEY)).toBe("sf-trip");
  });
});

describe("SPEC-ADDON-130 frame step 5: New note", () => {
  it("SPEC-ADDON-130 opens the quick-note composer for the drive", async () => {
    serve();
    render(<Page />);

    await screen.findByRole("link", { name: "Library" });
    fireEvent.click(screen.getByRole("button", { name: "New note" }));

    expect(quickNote.open).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(quickNote.open.mock.calls[0])).toContain(`"${DRIVE}"`);
  });

  it("SPEC-ADDON-130 preselects the Library's selected folder", async () => {
    nav.set(`${BASE}?view=all&folder=Work`);
    serve();
    render(<Page />);

    await screen.findAllByText("Gamma");
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "New note" }));

    expect(quickNote.open).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(quickNote.open.mock.calls[0])).toContain('"Work"');
  });
});

describe("SPEC-ADDON-130 frame step 6, I8: entry URLs", () => {
  it("SPEC-ADDON-130 I8 ?q= without view lands on the Library search", async () => {
    nav.set(`${BASE}?q=alp`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.get("view")).toBe("all"));
    expect(nav.last()?.kind).toBe("replace");
    expect(nav.params.get("q")).toBe("alp");
    expect(nav.pathname).toBe(BASE);
  });

  it("SPEC-ADDON-130 I8 ?prefill= lands on the Clips page with the same query string", async () => {
    nav.set(`${BASE}?prefill=https%3A%2F%2Fexample.com&title=T&autosubmit=1`);
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.pathname).toBe(`${BASE}/clips`));
    expect(nav.last()?.kind).toBe("replace");
    expect(nav.params.get("prefill")).toBe("https://example.com");
    expect(nav.params.get("title")).toBe("T");
    expect(nav.params.get("autosubmit")).toBe("1");
  });

  it("SPEC-ADDON-130 I8 ?edit= with the flag on and a Markdown file reaches the file page in edit mode", async () => {
    nav.set(`${BASE}?edit=n1`);
    flags.inline = true;
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.last()?.kind).toBe("replace"));
    expect(nav.pathname.startsWith(`/drive/${DRIVE}`)).toBe(true);
    expect(nav.params.get("file")).toBe("n1");
    expect(nav.params.get("edit")).toBe("1");
  });

  it("SPEC-ADDON-130 I8 ?edit= with the flag off removes edit and draws Home", async () => {
    nav.set(`${BASE}?edit=n1`);
    flags.inline = false;
    serve();
    render(<Page />);

    await waitFor(() => expect(nav.params.has("edit")).toBe(false));
    expect(nav.last()?.kind).toBe("replace");
    expect(nav.pathname).toBe(BASE);
    expect(await screen.findByText("Recently updated")).toBeInTheDocument();
  });

  it("SPEC-ADDON-130 I8 ?edit= for a file that is not text removes edit and draws Home", async () => {
    nav.set(`${BASE}?edit=v1`);
    flags.inline = true;
    serve([...NOTES, { id: "v1", title: "clip.mp4", folder: "", mime: "video/mp4" }]);
    render(<Page />);

    await waitFor(() => expect(nav.params.has("edit")).toBe(false));
    expect(nav.pathname).toBe(BASE);
    expect(await screen.findByText("Recently updated")).toBeInTheDocument();
  });

  it("SPEC-ADDON-130 I1 ?view=all&clips=1 opens the Library and still leaves clips out", async () => {
    nav.set(`${BASE}?view=all&clips=1`);
    serve();
    render(<Page />);

    expect((await screen.findAllByText("Alpha")).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Clipped")).toBeNull();
    for (const call of listings()) {
      expect(call.url.searchParams.get("exclude_origin")).toBe("webclip");
      expect(call.url.searchParams.get("origin")).toBeNull();
    }
  });
});
