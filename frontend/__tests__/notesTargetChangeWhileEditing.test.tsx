import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import { dirtyRegistry } from "@/lib/dirtyRegistry";
import { navigationGuard } from "@/lib/navigationGuard";
import {
  BASE,
  captureHistory,
  installNotesServer,
  nav,
  setViewport,
  smartFolder,
  type Note,
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
vi.mock("@/components/appshell/useNearEnd", () => ({ useNearEnd: () => () => {} }));
vi.mock("../KnowledgeEditSection", async () => {
  const { useEffect } = await import("react");
  const Stub = (props: Record<string, unknown>) => {
    const handle = props.saveHandle as { current: unknown } | undefined;
    useEffect(() => {
      if (!handle) return;
      handle.current = { dirty: () => true, flush: async () => "saved" };
      dirtyRegistry.set("stub-editor", "knowledge-editor", true);
      return () => {
        handle.current = null;
        dirtyRegistry.set("stub-editor", "knowledge-editor", false);
      };
    }, [handle]);
    return <div data-testid="pane-editor" />;
  };
  return { default: Stub, KnowledgeEditSection: Stub };
});
vi.mock("@/lib/featureFlags", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/featureFlags");
  return { ...actual, isInlineKnowledgeEditorEnabled: () => true };
});
vi.mock("@/components/FileDetail/hooks/usePlainTextDocument", () => ({
  usePlainTextDocument: () => ({ decided: true, plainTextDocument: false }),
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

const Page = (await import("../Page")).default;

const VIEW_KEY = "litloft.addon.knowledge.view.d";

const NOTES: Note[] = [
  { id: "n1", title: "Alpha", folder: "Journal", tags: ["trip"], updated: "2026-11-10T09:00:00Z", created: "2026-10-01T09:00:00Z", body: "Body of Alpha" },
  { id: "n2", title: "Beta", folder: "", tags: [], updated: "2026-11-09T09:00:00Z", created: "2026-10-03T09:00:00Z", body: "Body of Beta" },
];

beforeEach(() => {
  localStorage.clear();
  navigationGuard.reset();
  setViewport(1440);
  captureHistory();
  member.evaluation = null;
});

afterEach(() => {
  cleanup();
  navigationGuard.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function chooseTarget(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /Target/ }));
  fireEvent.click(await screen.findByRole("menuitemradio", { name: new RegExp(name) }));
}

describe("a Target change while a note is being edited", () => {
  it("replaces the URL's sort with the new Target's stored sort once the save gate passes", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ "sf-trip": { sort: "title" } }));
    nav.set(`${BASE}?view=all&folder=Journal&note=n1&sort=created`);
    installNotesServer({ notes: NOTES, smartFolders: [smartFolder("sf-trip", "Trip", "tag:trip")] });
    render(<Page />);

    await waitFor(() => expect(screen.queryByText("Body of Alpha")).not.toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await waitFor(() => expect(screen.queryByTestId("pane-editor")).not.toBeNull());

    await chooseTarget("Trip");

    await waitFor(() => expect(nav.params.get("sort")).toBe("title"));
    expect(nav.params.get("folder")).toBe("Journal");
    expect(nav.params.has("note")).toBe(false);
  });

  it("shows the default Target's sort when a chosen member Target falls back to it", async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ default: { sort: "created" } }));
    nav.set(`${BASE}?view=all&sort=title`);
    installNotesServer({ notes: NOTES, smartFolders: [smartFolder("sf-beach", "Beach", "beach")] });
    render(<Page />);
    await waitFor(() => expect(screen.queryByText("Alpha")).not.toBeNull());

    member.evaluation = async () => ({ status: "tooLarge" });
    await chooseTarget("Beach");

    await waitFor(() => expect(nav.params.get("sort")).toBe("created"));
  });
});
