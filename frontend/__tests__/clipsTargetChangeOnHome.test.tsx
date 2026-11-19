import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import {
  CLIPS,
  DRIVE,
  captureHistory,
  deferred,
  installClipsServer,
  nav,
  profile,
  resetSocket,
  setViewport,
  settle,
  smartFolder,
  type Clip,
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

const member = vi.hoisted(() => ({ evaluation: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/memberTarget", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/memberTarget");
  return {
    ...actual,
    evaluateMemberTarget: (...a: unknown[]) =>
      member.evaluation ? member.evaluation() : (actual.evaluateMemberTarget as (...b: unknown[]) => unknown)(...a),
  };
});

const Page = (await import("../pages/clips")).default;

const VIEW_KEY = `litloft.addon.knowledge-clips.view.${DRIVE}`;
const LIBRARY = `${CLIPS}?view=all`;

const SPREAD: Clip[] = [
  { id: "w1", title: "Web one", folder: "web", created: "2026-11-10T09:00:00Z", tags: ["trip"] },
  { id: "w2", title: "Web two", folder: "web", created: "2026-11-09T09:00:00Z" },
  { id: "n1", title: "News one", folder: "news", created: "2026-10-08T09:00:00Z", tags: ["work"] },
  { id: "n2", title: "News two", folder: "news", created: "2026-10-07T09:00:00Z" },
  { id: "r1", title: "Root one", folder: "", created: "2026-11-01T09:00:00Z" },
];

beforeEach(() => {
  localStorage.clear();
  nav.set(CLIPS);
  profile.nickname = "alice";
  resetSocket();
  setViewport(1440);
  captureHistory();
  member.evaluation = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function chooseTarget(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /Target/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: new RegExp(name) }));
}

describe("a Target chosen on Clips Home", () => {
  it("leaves a Library URL reached afterwards with its own group and sort", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ "sf-work": { group: "none" } }));
    nav.set(`${LIBRARY}&group=folder&sort=title`);
    installClipsServer({ files: SPREAD, smartFolders: [smartFolder("sf-work", "Work", "tag:work")] });
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "web" });

    fireEvent.click(screen.getByRole("link", { name: "Home" }));
    await screen.findByRole("heading", { level: 2, name: "Unread" });
    await chooseTarget("Work");
    await act(() => settle());

    nav.set(`${LIBRARY}&group=folder&sort=title`);

    await act(() => settle());
    expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["folder", "title"]);
  });

  it("leaves a Library URL reached while the chosen member Target is still evaluating with its own group and sort", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ "sf-beach": { group: "none" } }));
    nav.set(`${LIBRARY}&group=folder&sort=title`);
    installClipsServer({ files: SPREAD, smartFolders: [smartFolder("sf-beach", "Beach", "beach")] });
    render(<Page />);
    await screen.findByRole("heading", { level: 2, name: "web" });

    fireEvent.click(screen.getByRole("link", { name: "Home" }));
    await screen.findByRole("heading", { level: 2, name: "Unread" });
    const held = deferred<unknown>();
    member.evaluation = () => held.promise;
    await chooseTarget("Beach");

    nav.set(`${LIBRARY}&group=folder&sort=title`);
    await act(() => settle());
    held.resolve({ status: "ready", fileIds: ["w1", "w2", "n1", "n2", "r1"] });

    await act(() => settle());
    expect([nav.params.get("group"), nav.params.get("sort")]).toEqual(["folder", "title"]);
  });
});
