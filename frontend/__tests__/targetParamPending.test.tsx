/**
 * SPEC-ADDON-157 I4: a pending `?target=` also holds the saved Target's member
 * evaluation, so no request carries a Target before the URL's id is resolved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import { navigationGuard } from "@/lib/navigationGuard";
import type { WireCall } from "@/__tests__/helpers/wireFetch";
import {
  BASE,
  DRIVE,
  captureHistory,
  installNotesServer,
  listsOrCounts,
  nav,
  setViewport,
  settle,
  smartFolder,
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
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname: "alice", setNickname: vi.fn(), clearNickname: vi.fn() }),
}));
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => ({ enabled: true, isLoading: false }) }));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => null }));
vi.mock("@/components/quick-note", () => ({ useQuickNote: () => ({ open: vi.fn() }) }));
vi.mock("@/components/SidebarProvider", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/SidebarProvider");
  return { ...actual, useOverlaySidebar: () => undefined };
});
vi.mock("@/components/MarkdownPreview", () => ({ MarkdownPreview: () => <div data-testid="markdown" /> }));
vi.mock("@/components/appshell/useNearEnd", () => ({ useNearEnd: () => () => {} }));
vi.mock("@/components/FileDetail/hooks/usePlainTextDocument", () => ({
  usePlainTextDocument: () => ({ decided: true, plainTextDocument: false }),
}));
vi.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const Page = (await import("../Page")).default;

const TARGET_KEY = `litloft.addon.knowledge.target.${DRIVE}`;

const NOTES: Note[] = [
  { id: "n1", title: "Holiday plan", folder: "Journal", tags: ["trip"] },
  { id: "n2", title: "Beta", folder: "" },
];
const SMART_FOLDERS = [
  smartFolder("sf-member", "Holiday", "holiday"),
  smartFolder("sf-trip", "Trip", "tag:trip"),
];

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
const COLLECTIONS = [collection("c-trip", "Trip box")];

let server: Server;
const released: (() => void)[] = [];
const gate = { open: false };

const isCollections = (c: WireCall) => c.url.pathname === `/api/drives/${DRIVE}/collections`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function open(url: string) {
  nav.set(url);
  server = installNotesServer({ notes: NOTES, smartFolders: SMART_FOLDERS, collections: COLLECTIONS });
  const normal = server.override;
  server.override = (call) => {
    if (isCollections(call) && !gate.open) {
      return new Promise<Response>((resolve) => {
        released.push(() => resolve(json(COLLECTIONS)));
      });
    }
    return normal(call);
  };
  return render(<Page />);
}

async function releaseAll() {
  gate.open = true;
  await act(async () => {
    for (const release of released.splice(0)) release();
  });
}

beforeEach(() => {
  localStorage.clear();
  released.length = 0;
  gate.open = false;
  navigationGuard.reset();
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  navigationGuard.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SPEC-ADDON-157 I4 a pending ?target= and a saved member Target", () => {
  it("holds the saved Target's member evaluation and shows the loading block", async () => {
    localStorage.setItem(TARGET_KEY, "sf-member");
    open(`${BASE}?target=collection:c-trip`);

    await waitFor(() => expect(server.calls.some(isCollections)).toBe(true));
    await act(() => settle());

    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(server.calls.filter(listsOrCounts)).toEqual([]);
    expect(localStorage.getItem(TARGET_KEY)).toBe("sf-member");

    await releaseAll();
    await waitFor(() => expect(server.calls.filter(listsOrCounts).length).toBeGreaterThan(0));
    await act(() => settle());

    expect(localStorage.getItem(TARGET_KEY)).toBe("collection:c-trip");
    for (const call of server.calls.filter(listsOrCounts)) {
      expect(call.url.searchParams.getAll("collection")).toEqual(["Trip box"]);
    }
  });
});
