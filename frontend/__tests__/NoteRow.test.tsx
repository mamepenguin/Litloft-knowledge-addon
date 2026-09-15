import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import type { FileItem } from "@/types";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ""}.${key}`,
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

const { NoteRows } = await import("../NoteRow");
const { excerptFromText } = await import("../useNoteExcerpt");

const NOW = new Date(2026, 8, 14, 15, 0);

function note(id: string, title: string, folder: string): FileItem {
  return {
    id,
    filename: `${id}.md`,
    title,
    drive: "d",
    folder_path: folder,
    mime_type: "text/markdown",
    updated_at: new Date(2026, 8, 14, 9, 5).toISOString(),
  } as FileItem;
}

function respondWith(body: string, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, text: async () => body })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("excerptFromText", () => {
  it("drops frontmatter and a first line that only repeats the title", () => {
    expect(excerptFromText("---\nid: 1\n---\n# Trip\n\nDay one: the market.", "Trip")).toBe("Day one: the market.");
    expect(excerptFromText("# Other heading\nBody", "Trip")).toBe("Other heading\nBody");
  });
});

describe("NoteRows", () => {
  it("shows the body's opening line, the folder or the drive root, and today's time", async () => {
    respondWith("# Trip\n\nDay one:\nthe market.");
    render(<NoteRows files={[note("a", "Trip", "Travel"), note("b", "Root note", "")]} now={NOW} />);

    const [trip, root] = screen.getAllByRole("link");
    expect(await within(trip).findByTestId("note-excerpt")).toHaveTextContent(/^Day one: the market\.$/);
    expect(trip).toHaveTextContent("Travel");
    expect(trip).toHaveTextContent("09:05");
    expect(root).toHaveTextContent("knowledge.notes.rootFolder");
    expect(trip.getAttribute("href")).toBe("/drive/d/Travel?file=a");
  });

  it("draws no excerpt line when the body is empty or cannot be read", async () => {
    respondWith("", false);
    render(<NoteRows files={[note("a", "Trip", "Travel")]} now={NOW} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("note-excerpt")).toBeNull();
  });

  it("marks every case-insensitive match of the query in the title and the folder", () => {
    respondWith("");
    render(<NoteRows files={[note("a", "AI and ai tools", "Knowledge/AI")]} now={NOW} query="ai" />);
    const marks = screen.getAllByText((_, el) => el?.tagName === "MARK").map((m) => m.textContent);
    expect(marks).toEqual(["AI", "ai", "AI", "AI"]);
  });

  it("marks the matched letters in a title whose lowercase form is longer", () => {
    respondWith("");
    render(<NoteRows files={[note("a", "İstanbul ai", "")]} now={NOW} query="ai" />);
    const marks = screen.getAllByText((_, el) => el?.tagName === "MARK").map((m) => m.textContent);
    expect(marks).toEqual(["ai"]);
    expect(screen.getByRole("link")).toHaveTextContent(/^İstanbul ai/);
  });

  it("marks a query whose own lowercase form is longer", () => {
    respondWith("");
    render(<NoteRows files={[note("a", "In İstanbul", "")]} now={NOW} query="İst" />);
    const marks = screen.getAllByText((_, el) => el?.tagName === "MARK").map((m) => m.textContent);
    expect(marks).toEqual(["İst"]);
  });
});
