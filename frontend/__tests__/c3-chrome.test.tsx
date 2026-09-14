import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import NotesPage from "../NotesPage";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ""}.${key}`,
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
vi.mock("@/lib/api", () => ({
  getDriveFiles: vi.fn(() => new Promise(() => {})),
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
    expect(h1s[0].textContent).toBe("knowledge.notes.heading");
    const header = h1s[0].closest("header")!;
    expect(header.querySelector("svg")).not.toBeNull();
    expect(h1s[0].querySelector("svg")).toBeNull();
  });

  it("says what the page is for under the title, and puts New note in the header", () => {
    render(<NotesPage />);
    expect(screen.getByText("knowledge.notes.description")).toBeInTheDocument();
    const newNote = screen.getByRole("button", { name: "knowledge.notes.newNote" });
    expect(newNote.closest("header")).not.toBeNull();
  });
});
