import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";

import {
  GlobalSearchProvider,
  useActiveSearchScope,
  useRegisterGlobalSearch,
  type SearchScope,
} from "@/components/search/GlobalSearchProvider";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ""}.${key}`,
}));

const GoToNoteAction = (await import("../GoToNoteAction")).default;

const opened: (SearchScope | null)[] = [];

/** Stands in for the header's modal: records the scope each opening shows. */
function SearchHost() {
  const scope = useActiveSearchScope();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useRegisterGlobalSearch(() => opened.push(scopeRef.current));
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

describe("Go to note in the file action row", () => {
  afterEach(() => {
    cleanup();
    opened.length = 0;
  });

  it.each([
    ["a Markdown note", "note.md", "text/markdown"],
    ["a plain text file", "todo.txt", "text/plain"],
  ])("opens search scoped to this drive's notes from %s", (_, filename, mimeType) => {
    renderInShell(<GoToNoteAction drive="動画 d" filename={filename} mimeType={mimeType} />);

    fireEvent.click(screen.getByRole("button", { name: /knowledge\.goToNote\.button/ }));

    expect(opened).toHaveLength(1);
    const scope = opened[0]!;
    expect(scope.label).toBe("knowledge.goToNote.scope");
    expect(scope.type).toBe("text");
    expect(scope.seeAllHref!("a&b 旅行")).toBe(
      `/drive/${encodeURIComponent("動画 d")}/addons/knowledge?view=all&q=${encodeURIComponent("a&b 旅行")}`,
    );
  });

  it("shows the search chord as core writes it", () => {
    const platform = Object.getOwnPropertyDescriptor(window.navigator, "platform");
    Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });
    try {
      renderInShell(<GoToNoteAction drive="d" filename="note.md" mimeType="text/markdown" />);
      expect(screen.getByText("⌘K").tagName).toBe("KBD");
    } finally {
      if (platform) Object.defineProperty(window.navigator, "platform", platform);
      else delete (window.navigator as unknown as Record<string, unknown>).platform;
    }
  });

  it("makes the header's search open scoped while it is mounted, and not after", () => {
    function Page() {
      const [mounted, setMounted] = useState(true);
      return (
        <>
          {mounted && <GoToNoteAction drive="d" filename="note.md" mimeType="text/markdown" />}
          <button type="button" onClick={() => setMounted(false)}>
            leave
          </button>
        </>
      );
    }
    renderInShell(<Page />);
    const header = screen.getByRole("button", { name: "header-search" });

    fireEvent.click(header);
    expect(opened.at(-1)?.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "leave" }));
    fireEvent.click(header);
    expect(opened.at(-1)).toBeNull();
  });

  it.each([
    ["a video", "clip.mp4", "video/mp4"],
    ["a PDF", "paper.pdf", "application/pdf"],
    ["source code with a text mime", "main.c", "text/plain"],
  ])("renders nothing and scopes nothing for %s", (_, filename, mimeType) => {
    const { container } = render(
      <GlobalSearchProvider>
        <GoToNoteAction drive="d" filename={filename} mimeType={mimeType} />
      </GlobalSearchProvider>,
    );
    expect(container).toBeEmptyDOMElement();

    cleanup();
    renderInShell(<GoToNoteAction drive="d" filename={filename} mimeType={mimeType} />);
    fireEvent.click(screen.getByRole("button", { name: "header-search" }));
    expect(opened.at(-1)).toBeNull();
  });
});
