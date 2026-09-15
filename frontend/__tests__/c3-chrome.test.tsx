import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import NotesPage from "../NotesPage";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string, values?: Record<string, unknown>) =>
    key === "driveScope"
      ? `${values!.drive} · ${values!.detail}`
      : key === "items"
        ? `${values!.count} items`
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
vi.mock("@/hooks/usePolicy", () => ({
  usePolicy: () => ({ enabled: true, isLoading: false }),
}));
const api = vi.hoisted(() => ({
  getDriveFiles: vi.fn((): Promise<unknown> => new Promise(() => {})),
}));
vi.mock("@/lib/api", () => ({
  getDriveFiles: api.getDriveFiles,
  getWatchHistory: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../ClipSection", () => ({ default: () => null }));
vi.mock("../ConnectionsGraph", () => ({ default: () => null }));

describe("the Notes page header", () => {
  afterEach(cleanup);

  it("gets its heading from PageHeader, not from a hand-written <h1>", () => {
    const { container } = render(<NotesPage />);
    const h1s = [...container.querySelectorAll("h1")];
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("knowledge.nav.label");
    const header = h1s[0].closest("header")!;
    expect(header.querySelector("svg")).not.toBeNull();
    expect(h1s[0].querySelector("svg")).toBeNull();
  });

  it("names the drive under the title before the count is known, and puts New note in the header", () => {
    render(<NotesPage />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.nextElementSibling?.textContent).toBe("test-drive");
    expect(screen.queryByText("knowledge.notes.description")).toBeNull();
    const newNote = screen.getByRole("button", { name: "knowledge.notes.newNote" });
    expect(newNote.closest("header")).not.toBeNull();
  });

  it("states the count the recent list reports", async () => {
    api.getDriveFiles.mockResolvedValueOnce({ data: [], meta: { total: 42, page: 1, limit: 12 } });
    render(<NotesPage />);
    const heading = screen.getByRole("heading", { level: 1 });
    await vi.waitFor(() => expect(heading.nextElementSibling?.textContent).toBe("test-drive · 42 items"));
  });

  it("names the drive alone when the list fails", async () => {
    api.getDriveFiles.mockRejectedValueOnce(new Error("down"));
    render(<NotesPage />);
    await screen.findByRole("alert");
    expect(screen.getByRole("heading", { level: 1 }).nextElementSibling?.textContent).toBe("test-drive");
  });

  it("wears the list column on the landing", () => {
    render(<NotesPage />);
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(header.parentElement?.getAttribute("data-page-frame")).toBe("list");
  });
});
