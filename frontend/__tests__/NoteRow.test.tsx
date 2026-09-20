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
const { excerptFromText } = await import("../noteExcerpt");

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

const OPENINGS = { a: "---\nid: 1\n---\n# Trip\n\nDay one:\nthe market.", b: "Root body." };

afterEach(() => {
  cleanup();
});

describe("excerptFromText", () => {
  it("drops frontmatter and a first line that only repeats the title", () => {
    expect(excerptFromText("---\nid: 1\n---\n# Trip\n\nDay one: the market.", "Trip")).toBe("Day one: the market.");
    expect(excerptFromText("# Other heading\nBody", "Trip")).toBe("Other heading\nBody");
  });
});

describe("NoteRows", () => {
  it("shows the body's opening line, the folder or the drive root, and today's time", () => {
    render(
      <NoteRows
        files={[note("a", "Trip", "Travel"), note("b", "Root note", "")]}
        now={NOW}
        openings={OPENINGS}
      />,
    );

    const [trip, root] = screen.getAllByRole("link");
    // In the first render: a row that grows later pushes every row under it.
    expect(within(trip).getByTestId("note-excerpt")).toHaveTextContent(/^Day one: the market\.$/);
    expect(trip).toHaveTextContent("Travel");
    expect(trip).toHaveTextContent("09:05");
    expect(root).toHaveTextContent("knowledge.notes.rootFolder");
    expect(trip.getAttribute("href")).toBe("/drive/d/Travel?file=a");
  });

  it.each([
    ["the listing brought none", undefined],
    ["the note has no body", {} as Record<string, string>],
    ["the body is only its own title", { a: "# Trip\n" }],
  ])("draws no excerpt line when %s", (_name, openings) => {
    render(<NoteRows files={[note("a", "Trip", "Travel")]} now={NOW} openings={openings} />);
    expect(screen.queryByTestId("note-excerpt")).toBeNull();
  });

  it("marks every case-insensitive match of the query in the title and the folder", () => {
    render(<NoteRows files={[note("a", "AI and ai tools", "Knowledge/AI")]} now={NOW} query="ai" />);
    const marks = screen.getAllByText((_, el) => el?.tagName === "MARK").map((m) => m.textContent);
    expect(marks).toEqual(["AI", "ai", "AI", "AI"]);
  });

  it("marks the matched letters in a title whose lowercase form is longer", () => {
    render(<NoteRows files={[note("a", "İstanbul ai", "")]} now={NOW} query="ai" />);
    const marks = screen.getAllByText((_, el) => el?.tagName === "MARK").map((m) => m.textContent);
    expect(marks).toEqual(["ai"]);
    expect(screen.getByRole("link")).toHaveTextContent(/^İstanbul ai/);
  });

  it.each([
    ["ΟΔΟΣ", "ΟΔΟΣ", ["ΟΔΟΣ"]],
    ["ΟΔΟΣ", "οδος", ["ΟΔΟΣ"]],
    ["Οδός ΚΑΙ ΟΔΟΣ", "ΟΔΟΣ", ["ΟΔΟΣ"]],
    ["AI and ai tools", "Ai", ["AI", "ai"]],
  ])("marks %s for %s the way the whole title lowercases", (title, query, expected) => {
    render(<NoteRows files={[note("a", title, "")]} now={NOW} query={query} />);
    const marks = screen.queryAllByText((_, el) => el?.tagName === "MARK").map((m) => m.textContent);
    expect(marks).toEqual(expected);
  });

  it("marks the matched letters after a character outside the basic plane", () => {
    render(<NoteRows files={[note("a", "😀 ai and 😀😀 AI", "")]} now={NOW} query="ai" />);
    const marks = screen.getAllByText((_, el) => el?.tagName === "MARK").map((m) => m.textContent);
    expect(marks).toEqual(["ai", "AI"]);
  });

  it("marks a query whose own lowercase form is longer", () => {
    render(<NoteRows files={[note("a", "In İstanbul", "")]} now={NOW} query="İst" />);
    const marks = screen.getAllByText((_, el) => el?.tagName === "MARK").map((m) => m.textContent);
    expect(marks).toEqual(["İst"]);
  });
});
