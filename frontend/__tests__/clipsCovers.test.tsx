/**
 * SPEC-ADDON-140: covers, sites and reading time on the Clips cards.
 * Invariant ids are those of docs/specs/clips-frame.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import {
  CLIPS,
  DRIVE,
  NOT_CLIPS,
  captureHistory,
  clips,
  coverIds,
  deferred,
  emit,
  findText,
  installClipsServer,
  metaNodes,
  isCovers,
  reachEnd,
  nav,
  profile,
  resetSocket,
  setViewport,
  settle,
  smartFolder,
  type Clip,
  type Server,
} from "./clipsAppHarness";

vi.mock("next-intl", async () => (await import("./clipsAppHarness")).intlModule());
vi.mock("next/navigation", async () => (await import("./clipsAppHarness")).navigationModule);
vi.mock("next/link", async () => {
  const { router: r } = await import("./clipsAppHarness");
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
vi.mock("@/components/ProfileProvider", async () => (await import("./clipsAppHarness")).profileModule);
vi.mock("@/hooks/useWebSocket", async () => (await import("./clipsAppHarness")).socketModule);
vi.mock("@/components/appshell/useNearEnd", async () => (await import("./clipsAppHarness")).nearEndModule());
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => ({ enabled: true, isLoading: false }) }));
vi.mock("@/components/FolderPicker", () => ({
  FolderPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="folder" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
const sidebar = vi.hoisted(() => ({ overlay: vi.fn() }));
vi.mock("@/components/SidebarProvider", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/SidebarProvider");
  return { ...actual, useOverlaySidebar: (...a: unknown[]) => sidebar.overlay(...a) };
});

const Page = (await import("../pages/clips")).default;

const CLIPS_TARGET_KEY = `litloft.addon.knowledge-clips.target.${DRIVE}`;
const NOTES_TARGET_KEY = `litloft.addon.knowledge.target.${DRIVE}`;
const TRIP = smartFolder("sf-trip", "Trip", "tag:trip");
const WORK = smartFolder("sf-work", "Work", "tag:work");

let server: Server;

function serve(files: Clip[] = [...clips(3), ...NOT_CLIPS], extra: Parameters<typeof installClipsServer>[0] = {}) {
  server = installClipsServer({ files, smartFolders: [TRIP, WORK], ...extra });
  return server;
}

beforeEach(() => {
  localStorage.clear();
  nav.set(CLIPS);
  profile.nickname = "alice";
  resetSocket();
  sidebar.overlay.mockClear();
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const GRID = `${CLIPS}?view=all&group=none`;
const cardOf = (title: string) => screen.getByText(title).closest("a") as HTMLElement;
const asked = () => server.calls.filter(isCovers);

describe("SPEC-ADDON-140 step 13, step 15, I8: covers on the cards", () => {
  it("SPEC-ADDON-140 I8 a card is drawn with the tint and no site at once, and its cover and site when the answer arrives", async () => {
    nav.set(GRID);
    serve(
      [
        { id: "c1", title: "Loft cover", created: "2026-11-10T00:00:00Z" },
        { id: "c2", title: "Web cover", created: "2026-11-09T00:00:00Z" },
        { id: "c3", title: "No cover", created: "2026-11-08T00:00:00Z" },
        ...NOT_CLIPS,
      ],
      {
        covers: {
          c1: { image_id: "img1", image_url: null, site: "loft.example" },
          c2: { image_id: null, image_url: "https://img.example/c2.jpg", site: "web.example" },
        },
      },
    );
    const gate = deferred<void>();
    server.override = (call) => (isCovers(call) ? gate.promise.then(() => server.answer(call)) : null);
    render(<Page />);

    await screen.findByText("Loft cover");
    await waitFor(() => expect(asked().length).toBeGreaterThan(0));
    expect(cardOf("Loft cover").querySelector("img")).toBeNull();
    expect(screen.queryByText(/loft\.example/)).toBeNull();

    await act(async () => gate.resolve());

    await waitFor(() => expect(cardOf("Loft cover").querySelector("img")).not.toBeNull());
    expect(cardOf("Loft cover").querySelector("img")!.getAttribute("src")).toBe("/api/files/img1/thumbnail");
    const web = cardOf("Web cover").querySelector("img")!;
    expect(web.getAttribute("src")).toBe("https://img.example/c2.jpg");
    expect(web.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(web.getAttribute("loading")).toBe("lazy");
    expect(cardOf("No cover").querySelector("img")).toBeNull();
    expect(cardOf("Loft cover")).toHaveTextContent("loft.example");
    expect(cardOf("Web cover")).toHaveTextContent("web.example");
  });

  it("SPEC-ADDON-140 asks clip-covers for the drive's cards, 60 ids at most, each card once while the page is mounted", async () => {
    nav.set(GRID);
    serve([...clips(65), ...NOT_CLIPS]);
    render(<Page />);

    await screen.findByText("C clip 60");
    await waitFor(() => expect(asked().flatMap(coverIds)).toContain("c60"));
    await reachEnd();
    await screen.findByText("C clip 65");
    await waitFor(() => expect(asked().flatMap(coverIds)).toContain("c65"));

    for (const call of asked()) {
      expect(call.method).toBe("POST");
      expect(decodeURIComponent(call.headers.get("X-Lit-Drive") ?? "")).toBe(DRIVE);
      expect(coverIds(call).length).toBeLessThanOrEqual(60);
    }
    const ids = asked().flatMap(coverIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("pic1");
    expect(ids).not.toContain("note1");

    fireEvent.click(screen.getByRole("link", { name: "Home" }));
    await screen.findByRole("heading", { level: 2, name: "Unread" });
    await act(() => settle(100));
    const again = asked().flatMap(coverIds);
    expect(again.filter((id) => id === "c1")).toHaveLength(1);
  });

  it("SPEC-ADDON-140 when clip-covers fails the cards keep the tint and no site until a refresh asks for them again", async () => {
    nav.set(GRID);
    serve([...clips(2), ...NOT_CLIPS], {
      covers: { c1: { image_id: null, image_url: "https://img.example/c1.jpg", site: "one.example" } },
    });
    let failing = true;
    server.override = (call) => (isCovers(call) && failing ? new Response("{}", { status: 502 }) : null);
    render(<Page />);

    await screen.findByText("C clip 1");
    await waitFor(() => expect(asked().length).toBeGreaterThan(0));
    await act(() => settle());
    expect(cardOf("C clip 1").querySelector("img")).toBeNull();
    expect(cardOf("C clip 1")).not.toHaveTextContent("one.example");

    failing = false;
    emit("knowledge.clip.ready", { file_id: "other", job_id: 4 });

    await waitFor(() => expect(cardOf("C clip 1").querySelector("img")?.getAttribute("src")).toBe("https://img.example/c1.jpg"));
    expect(cardOf("C clip 1")).toHaveTextContent("one.example");
  });
});

describe("SPEC-ADDON-140 step 15: reading time", () => {
  it.each([
    [0, "1 min"],
    [700, "1 min"],
    [4500, "3 min"],
    [15000, "10 min"],
  ])("SPEC-ADDON-140 a clip of %i bytes reads in %s", async (size, minutes) => {
    nav.set(GRID);
    serve([{ id: "c1", title: "Sized", size, created: "2026-11-10T00:00:00Z" }, ...NOT_CLIPS], {
      covers: { c1: { image_id: null, image_url: null, site: "s.example" } },
    });
    render(<Page />);

    await waitFor(() => expect(metaNodes(new RegExp(`^s\\.example · ${minutes}$`))).toHaveLength(1));
  });

  it("SPEC-ADDON-140 a Home card reads site, reading time and age", async () => {
    serve([{ id: "c1", title: "Curry", size: 4500, created: "2026-11-10T00:00:00Z" }, ...NOT_CLIPS], {
      covers: { c1: { image_id: null, image_url: null, site: "cooking.example" } },
    });
    render(<Page />);

    await screen.findByText("Curry");
    await waitFor(() => {
      expect(metaNodes(/^cooking\.example · 3 min · \S/, cardOf("Curry"))).toHaveLength(1);
    });
  });
});
