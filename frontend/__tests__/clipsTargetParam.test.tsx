/**
 * SPEC-ADDON-157: Clips opened on `?target=<id>` (I4, I5, I6) and the Home row
 * in its Target menu carrying the Clips entry key (I12).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import {
  CLIPS,
  DRIVE,
  captureHistory,
  installClipsServer,
  isFiles,
  isShelves,
  nav,
  profile,
  resetSocket,
  setViewport,
  settle,
  smartFolder,
  type Call,
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
vi.mock("@/components/SidebarProvider", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/SidebarProvider");
  return { ...actual, useOverlaySidebar: () => undefined };
});
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("@/components/ToastProvider", () => ({
  useToast: () => toast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const Page = (await import("../pages/clips")).default;

const TARGET_KEY = `litloft.addon.knowledge-clips.target.${DRIVE}`;
const VIEW_KEY = `litloft.addon.knowledge-clips.view.${DRIVE}`;
const BASE = CLIPS;

const NOTES: Clip[] = [
  { id: "w1", title: "Web one", folder: "web", created: "2026-11-10T09:00:00Z", tags: ["trip"], collections: ["Trip box"] },
  { id: "w2", title: "Web two", folder: "web", created: "2026-11-09T09:00:00Z", tags: ["food"] },
  { id: "n1", title: "News one", folder: "news", created: "2026-10-08T09:00:00Z" },
];
const SMART_FOLDERS = [smartFolder("sf-trip", "Trip", "tag:trip"), smartFolder("sf-food", "Food", "tag:food")];

function collection(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    drive: DRIVE,
    item_count: 1,
    first_file_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}
const COLLECTIONS = [collection("c-trip", "Trip box"), collection("c-other", "Other box")];

/** Ids that need no held list to be ignored. The Clips Library's own view is filled in already and drops an unknown parameter, so it does not run them. */
const IGNORED_WITHOUT_A_HELD_LIST: [string, string, string | null, ((c: Call) => boolean) | undefined][] = [
  ["an id not in the Smart Folder list", "sf-gone", "sf-gone", undefined],
  ["default", "default", null, undefined],
  ["an empty value", "", null, undefined],
];

let server: Server;
const released: (() => void)[] = [];

const isCollections = (c: Call) => c.url.pathname === `/api/drives/${DRIVE}/collections`;
const isSmartFolders = (c: Call) => c.url.pathname === `/api/drives/${DRIVE}/smart-folders`;
const isShortcuts = (c: Call) => c.url.pathname === `/api/drives/${DRIVE}/home-shortcuts`;

const gate = { open: false };

function open(url: string, hold?: (c: Call) => boolean, fail?: (c: Call) => boolean) {
  nav.set(url);
  server = installClipsServer({ files: NOTES, smartFolders: SMART_FOLDERS, collections: COLLECTIONS });
  const normal = server.override;
  server.override = (call) => {
    if (isShortcuts(call)) return call.method === "GET" ? json([]) : new Response(null, { status: 204 });
    if (hold?.(call) && !gate.open) {
      return new Promise<Response>((resolve) => {
        released.push(() =>
          resolve(fail?.(call) ? json({ detail: "boom" }, 500) : json(isCollections(call) ? COLLECTIONS : SMART_FOLDERS)),
        );
      });
    }
    if (fail?.(call)) return json({ detail: "boom" }, 500);
    return normal(call);
  };
  return render(<Page />);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function releaseAll() {
  gate.open = true;
  await act(async () => {
    for (const release of released.splice(0)) release();
  });
}

function storage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    out[key] = localStorage.getItem(key)!;
  }
  return out;
}

const targetButton = () => screen.getByRole("button", { name: /Target/ });
const underTarget = () => server.calls.filter((c) => isFiles(c) || isShelves(c));

/** I6: the first replace of the load removed `target`, nothing pushed, and no later navigation brought it back. */
function expectTargetRemoved() {
  expect(nav.params.has("target")).toBe(false);
  expect(nav.log.length).toBeGreaterThan(0);
  expect(nav.log[0].kind).toBe("replace");
  for (const n of nav.log) {
    expect(n.kind).toBe("replace");
    expect(n.url.searchParams.has("target")).toBe(false);
  }
}

beforeEach(() => {
  localStorage.clear();
  released.length = 0;
  gate.open = false;
  profile.nickname = "alice";
  resetSocket();
  toast.error.mockReset();
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  ["Home", `${BASE}`],
  ["the Library", `${BASE}?view=all`],
])("SPEC-ADDON-157 Clips %s opened with ?target=", (_, url) => {
  const withTarget = (id: string) => `${url}${url.includes("?") ? "&" : "?"}target=${encodeURIComponent(id)}`;

  it("SPEC-ADDON-157 I4 I5 I6 holds every request until the collection list resolves the id, then saves it and removes target", async () => {
    open(withTarget("collection:c-trip"), isCollections);
    await waitFor(() => expect(server.calls.some(isCollections)).toBe(true));
    await act(() => settle());
    expect(underTarget()).toEqual([]);

    await releaseAll();
    await waitFor(() => expect(underTarget().length).toBeGreaterThan(0));
    await act(() => settle());

    expect(localStorage.getItem(TARGET_KEY)).toBe("collection:c-trip");
    for (const call of underTarget()) expect(call.url.searchParams.getAll("collection")).toEqual(["Trip box"]);
    expect(targetButton()).toHaveTextContent("Trip box");
    expectTargetRemoved();
  });

  it("SPEC-ADDON-157 I4 I5 holds every request until the Smart Folder list resolves the id, then saves it", async () => {
    localStorage.setItem(TARGET_KEY, "sf-food");
    open(withTarget("sf-trip"), isSmartFolders);
    await waitFor(() => expect(server.calls.some(isSmartFolders)).toBe(true));
    await act(() => settle());
    expect(underTarget()).toEqual([]);

    await releaseAll();
    await waitFor(() => expect(underTarget().length).toBeGreaterThan(0));
    await act(() => settle());

    expect(localStorage.getItem(TARGET_KEY)).toBe("sf-trip");
    expect(targetButton()).toHaveTextContent("Trip");
    expectTargetRemoved();
  });

  it.each([
    ["an id not in the collection list", "collection:gone", "gone", undefined],
    ["a collection whose list failed to load", "collection:c-trip", "c-trip", isCollections],
  ])("SPEC-ADDON-157 I4 I5 I6 ignores %s once the list answered: the saved Target stays and is used, nothing is written, target is removed", async (_label, id, leaked, fail) => {
    localStorage.setItem(TARGET_KEY, "sf-food");
    const before = storage();
    open(withTarget(id), isCollections, fail);
    await waitFor(() => expect(server.calls.some(isCollections)).toBe(true));
    await act(() => settle());
    expect(underTarget()).toEqual([]);

    await releaseAll();
    await waitFor(() => expect(underTarget().length).toBeGreaterThan(0));
    await act(() => settle());

    expect(storage()).toEqual(before);
    expect(targetButton()).toHaveTextContent("Food");
    expectTargetRemoved();
    expect(toast.error).not.toHaveBeenCalled();
    for (const call of server.calls) {
      expect(call.url.href).not.toContain(leaked);
      expect(JSON.stringify(call.body ?? "")).not.toContain(leaked);
    }
  });

  it.each(IGNORED_WITHOUT_A_HELD_LIST.filter(() => !url.includes("view=all")))("SPEC-ADDON-157 I4 I5 I6 ignores %s: the saved Target stays and is used, nothing is written, target is removed", async (_label, id, leaked, fail) => {
    localStorage.setItem(TARGET_KEY, "sf-food");
    const before = storage();
    open(withTarget(id), undefined, fail);
    await waitFor(() => expect(underTarget().length).toBeGreaterThan(0));
    await act(() => settle());

    expect(storage()).toEqual(before);
    expect(targetButton()).toHaveTextContent("Food");
    expectTargetRemoved();
    expect(toast.error).not.toHaveBeenCalled();
    if (leaked) {
      for (const call of server.calls) {
        expect(call.url.href).not.toContain(leaked);
        expect(JSON.stringify(call.body ?? "")).not.toContain(leaked);
      }
    }
  });

  it("SPEC-ADDON-157 I6 a Target chosen in the menu while pending wins, and the pending id is never written", async () => {
    open(withTarget("collection:c-trip"), isCollections);
    await waitFor(() => expect(server.calls.some(isCollections)).toBe(true));
    await act(() => settle());
    expect(underTarget()).toEqual([]);

    fireEvent.click(targetButton());
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Food/ }));
    await releaseAll();
    await act(() => settle());

    expect(localStorage.getItem(TARGET_KEY)).toBe("sf-food");
    for (const call of underTarget()) expect(call.url.searchParams.getAll("collection")).toEqual([]);
    expect(targetButton()).toHaveTextContent("Food");
  });

  it("SPEC-ADDON-157 I6 navigating to another view while pending drops the id unwritten", async () => {
    const elsewhere = url.includes("view=all") ? `${BASE}` : `${BASE}?view=all`;
    open(withTarget("collection:c-trip"), isCollections);
    await waitFor(() => expect(server.calls.some(isCollections)).toBe(true));
    await act(() => settle());
    expect(underTarget()).toEqual([]);

    act(() => nav.set(elsewhere));
    await act(() => settle());
    await releaseAll();
    await waitFor(() => expect(underTarget().length).toBeGreaterThan(0));
    await act(() => settle());

    expect(localStorage.getItem(TARGET_KEY)).toBeNull();
    for (const call of underTarget()) expect(call.url.searchParams.getAll("collection")).toEqual([]);
    expect(nav.params.has("target")).toBe(false);
  });

  it("SPEC-ADDON-157 I6 leaving the page while pending drops the id unwritten", async () => {
    const view = open(withTarget("collection:c-trip"), isCollections);
    await waitFor(() => expect(server.calls.some(isCollections)).toBe(true));
    await act(() => settle());
    expect(underTarget()).toEqual([]);

    view.unmount();
    await releaseAll();
    await act(() => settle());

    expect(localStorage.getItem(TARGET_KEY)).toBeNull();
  });
});

describe("SPEC-ADDON-157 the Clips Library view filled in", () => {
  it("SPEC-ADDON-157 I5 I6 puts the applied Target's saved view in the URL by the one replace that drops target, and writes no view key", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ "sf-trip": { group: "folder", sort: "title" } }));
    const viewBefore = localStorage.getItem(VIEW_KEY);
    open(`${BASE}?view=all&target=sf-trip`);

    await waitFor(() => expect(nav.params.get("group")).toBe("folder"));
    await act(() => settle());

    expect(nav.params.get("sort")).toBe("title");
    expect(nav.params.get("view")).toBe("all");
    expect(localStorage.getItem(TARGET_KEY)).toBe("sf-trip");
    expect(localStorage.getItem(VIEW_KEY)).toBe(viewBefore);
    expect(nav.log[0].url.searchParams.get("group")).toBe("folder");
    expectTargetRemoved();
  });

  it("SPEC-ADDON-157 I5 a Target change drops tag and trust the URL carried", async () => {
    localStorage.setItem(TARGET_KEY, "sf-food");
    open(`${BASE}?view=all&tag=food&trust=unverified&target=sf-trip`);

    await waitFor(() => expect(localStorage.getItem(TARGET_KEY)).toBe("sf-trip"));
    await act(() => settle());

    expect(nav.params.has("tag")).toBe(false);
    expect(nav.params.has("trust")).toBe(false);
    expectTargetRemoved();
  });
});

describe("SPEC-ADDON-157 I12 the Home row carries the Clips entry key", () => {
  it("SPEC-ADDON-157 I12 Put on Home from Clips sends app knowledge/clips", async () => {
    localStorage.setItem(TARGET_KEY, "sf-trip");
    open(`${BASE}?view=all`);
    await waitFor(() => expect(underTarget().length).toBeGreaterThan(0));

    fireEvent.click(targetButton());
    fireEvent.click(await screen.findByRole("menuitem", { name: "Put on Home" }));

    await waitFor(() => expect(server.calls.filter((c) => isShortcuts(c) && c.method === "PUT")).toHaveLength(1));
    expect(server.calls.find((c) => isShortcuts(c) && c.method === "PUT")!.body).toEqual({
      kind: "app_target",
      app: "knowledge/clips",
      id: "sf-trip",
      on_home: true,
    });
  });
});
