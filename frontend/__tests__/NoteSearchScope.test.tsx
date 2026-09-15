import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import {
  GlobalSearchProvider,
  useActiveSearchScope,
  type SearchScope,
} from "@/components/search/GlobalSearchProvider";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ""}.${key}`,
}));

const NoteSearchScope = (await import("../NoteSearchScope")).default;

const opened: (SearchScope | null)[] = [];

/** Stands in for the header's search button: records the scope each opening shows. */
function SearchHost() {
  const scope = useActiveSearchScope();
  return (
    <button type="button" onClick={() => opened.push(scope)}>
      header-search
    </button>
  );
}

function renderInShell(ui: React.ReactNode) {
  return render(
    <GlobalSearchProvider>
      <SearchHost />
      {ui}
    </GlobalSearchProvider>,
  );
}

function openHeaderSearch() {
  fireEvent.click(screen.getByRole("button", { name: "header-search" }));
}

describe("note search scope on a file's screen", () => {
  afterEach(() => {
    cleanup();
    opened.length = 0;
  });

  it.each([
    ["a Markdown note", "note.md", "text/markdown"],
    ["a plain text file", "todo.txt", "text/plain"],
  ])("scopes the header's search to this drive's notes from %s", (_, filename, mimeType) => {
    const { container } = renderInShell(
      <NoteSearchScope drive="動画 d" filename={filename} mimeType={mimeType} />,
    );

    expect(container.querySelectorAll("button")).toHaveLength(1);

    openHeaderSearch();
    expect(opened).toHaveLength(1);
    const scope = opened[0]!;
    expect(scope.label).toBe("knowledge.noteScope.label");
    expect(scope.type).toBe("text");
    expect(scope.seeAllHref!("a&b 旅行")).toBe(
      `/drive/${encodeURIComponent("動画 d")}/addons/knowledge?view=all&q=${encodeURIComponent("a&b 旅行")}`,
    );
  });

  it("removes the scope when it unmounts", () => {
    function Page() {
      const [mounted, setMounted] = useState(true);
      return (
        <>
          {mounted && <NoteSearchScope drive="d" filename="note.md" mimeType="text/markdown" />}
          <button type="button" onClick={() => setMounted(false)}>
            leave
          </button>
        </>
      );
    }
    renderInShell(<Page />);

    openHeaderSearch();
    expect(opened.at(-1)?.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "leave" }));
    openHeaderSearch();
    expect(opened.at(-1)).toBeNull();
  });

  it.each([
    ["a video", "clip.mp4", "video/mp4"],
    ["a PDF", "paper.pdf", "application/pdf"],
    ["source code with a text mime", "main.c", "text/plain"],
  ])("scopes nothing for %s", (_, filename, mimeType) => {
    renderInShell(<NoteSearchScope drive="d" filename={filename} mimeType={mimeType} />);
    openHeaderSearch();
    expect(opened.at(-1)).toBeNull();
  });
});
