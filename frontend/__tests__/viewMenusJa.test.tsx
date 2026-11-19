/**
 * SPEC-ADDON-147, SPEC-ADDON-148: the Clips and Notes view menus in Japanese.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

import { CLIPS, captureHistory, clips, installClipsServer, nav, profile, resetSocket, setViewport } from "./clipsAppHarness";
import { BASE, installNotesServer, type Note } from "./notesAppHarness";

vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  const messages = (await import("@/messages/ja.json")).default as Record<string, unknown>;
  const translator = (namespace?: string) =>
    actual.createTranslator({
      locale: "ja",
      messages: messages as never,
      namespace: namespace as never,
      onError: () => {},
      getMessageFallback: ({ key, namespace: ns }) => (ns ? `${ns}.${key}` : key),
    });
  return {
    ...actual,
    useTranslations: (namespace?: string) => translator(namespace),
    useLocale: () => "ja",
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});
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
vi.mock("@/components/quick-note", () => ({ useQuickNote: () => ({ open: vi.fn() }) }));
vi.mock("@/components/FolderPicker", () => ({
  FolderPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="folder" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/SidebarProvider", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/SidebarProvider");
  return { ...actual, useOverlaySidebar: () => undefined };
});
vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => <div data-testid="markdown" />,
}));

const ClipsPage = (await import("../pages/clips")).default;
const NotesPage = (await import("../Page")).default;

const RETIRED = ["まとめ方", "並べ替え", "分類の軸", "タグ別", "まとめない", "クリップした順", "タイトル順", "更新順", "作成順"];

const NOTES: Note[] = [
  { id: "n1", title: "Alpha", folder: "Journal", tags: ["trip"], updated: "2026-11-10T09:00:00Z", body: "Body of Alpha" },
];

beforeEach(() => {
  localStorage.clear();
  profile.nickname = "alice";
  resetSocket();
  setViewport(1440);
  captureHistory();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function optionsOf(button: HTMLElement): Promise<string[]> {
  fireEvent.click(button);
  const texts = (await screen.findAllByRole("menuitemradio")).map((o) => o.textContent?.trim() ?? "");
  fireEvent.keyDown(button, { key: "Escape" });
  await waitFor(() => expect(screen.queryAllByRole("menuitemradio")).toEqual([]));
  return texts;
}

describe("SPEC-ADDON-147 I9 Clips Library in Japanese", () => {
  it("SPEC-ADDON-147 the menus read 分類 and 並び順 with the new option names", async () => {
    nav.set(`${CLIPS}?view=all&group=tags&sort=newest`);
    installClipsServer({ files: clips(2, "c", { tags: ["soup"] }) });
    render(<ClipsPage />);

    const group = await screen.findByRole("button", { name: /分類/ });
    expect(group).toHaveTextContent("分類");
    expect(group).toHaveTextContent("タグ");
    expect(await optionsOf(group)).toEqual(["タグ", "フォルダ", "追加日", "なし"]);
    const sort = screen.getByRole("button", { name: /並び順/ });
    expect(sort).toHaveTextContent("追加日（新しい順）");
    expect(await optionsOf(sort)).toEqual(["追加日（新しい順）", "追加日（古い順）", "タイトル"]);
    for (const word of RETIRED) expect(document.body.textContent).not.toContain(word);
  });
});

describe("SPEC-ADDON-148 I9 Notes Library in Japanese", () => {
  it("SPEC-ADDON-148 the rail menu is named 分類: フォルダ, and the sort menu reads 変更日 with the new option names", async () => {
    nav.set(`${BASE}?view=all&sort=updated`);
    installNotesServer({ notes: NOTES });
    render(<NotesPage />);

    const group = await screen.findByRole("button", { name: "分類: フォルダ" });
    expect(await optionsOf(group)).toEqual(["フォルダ", "タグ"]);
    const sort = screen.getByRole("button", { name: /変更日/ });
    expect(sort.textContent?.trim()).toBe("変更日");
    expect(await optionsOf(sort)).toEqual(["変更日", "タイトル", "作成日"]);
    for (const word of RETIRED) expect(document.body.textContent).not.toContain(word);

    fireEvent.click(group);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "タグ" }));
    expect(await screen.findByRole("button", { name: "分類: タグ" })).toBeInTheDocument();
  });
});
