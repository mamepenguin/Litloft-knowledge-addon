/** SPEC-ADDON-130: the Notes header is the core's app header, not a hand-written one. */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import NotesPage from "../NotesPage";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (ns?: string) => (key: string, values?: Record<string, unknown>) =>
    key === "driveScope"
      ? `${values!.drive} · ${values!.detail}`
      : key === "count"
        ? `${values!.count} notes`
        : `${ns ?? ""}.${key}`,
}));
vi.mock("@/components/CurrentDriveProvider", () => ({
  useCurrentDrive: () => "test-drive",
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/drive/test-drive/addons/knowledge",
}));
vi.mock("@/components/ProfileProvider", () => ({
  useProfile: () => ({ nickname: null, setNickname: vi.fn(), clearNickname: vi.fn() }),
}));
vi.mock("@/components/quick-note", () => ({ useQuickNote: () => ({ open: vi.fn() }) }));
const api = vi.hoisted(() => ({
  getDriveFiles: vi.fn((): Promise<unknown> => new Promise(() => {})),
}));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getDriveFiles: api.getDriveFiles,
    getWatchHistory: vi.fn(() => new Promise(() => {})),
    getSmartFolders: vi.fn(async () => []),
    getCollections: vi.fn(async () => []),
  };
});
vi.mock("../notesapp/sourcesApi", () => ({
  getNotesWithSources: vi.fn(() => new Promise(() => {})),
  getNoteSources: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../library/NotesLibrary", () => ({ default: () => null }));

describe("the Notes page header", () => {
  afterEach(cleanup);

  it("gets its heading from the app header, not from a hand-written <h1>", () => {
    const { container } = render(<NotesPage />);
    const h1s = [...container.querySelectorAll("h1")];
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("knowledge.notesApp.title");
    const header = h1s[0].closest("header")!;
    expect(header.querySelector("svg")).not.toBeNull();
    expect(h1s[0].querySelector("svg")).toBeNull();
  });

  it("names the drive under the title before the count is known, and puts New note in the header", () => {
    render(<NotesPage />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.nextElementSibling?.textContent).toMatch(/^test-drive/);
    expect(heading.nextElementSibling?.textContent).not.toContain(" · ");
    const newNote = screen.getByRole("button", { name: "knowledge.notesApp.newNote" });
    expect(newNote.closest("header")).not.toBeNull();
    expect(newNote.className).toContain("max-sm:w-");
  });

  it("states the count the listing reports", async () => {
    api.getDriveFiles.mockResolvedValue({ data: [], meta: { total: 42, page: 1, limit: 1 } });
    render(<NotesPage />);
    const heading = screen.getByRole("heading", { level: 1 });
    await vi.waitFor(() => expect(heading.nextElementSibling?.textContent).toContain("42 notes"));
  });

  it("wears the wide column, as the other apps do", () => {
    render(<NotesPage />);
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(header.parentElement?.getAttribute("data-page-frame")).toBe("wide");
  });
});
