import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { dirtyRegistry } from "@/lib/dirtyRegistry";
import {
  MarkdownChromeProvider,
  type MarkdownViewMode,
} from "@/lib/markdownChromeContext";
import { setEditorContent } from "./editorTestDriver";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/useShortcuts", () => ({
  useShortcuts: () => undefined,
}));

// jsdom lays nothing out and has no Range.getClientRects, which CodeMirror's
// measure calls when the editor scrolls its selection into view.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

const Editor = (await import("../Editor")).default;

const NOTE = "# Title\n\nalpha beta gamma delta.\n";

interface Pending {
  resolve: (text: string) => void;
}

function stubStream(bodies: Record<string, string | Pending>) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, method: init?.method ?? "GET" });
      const id = /\/api\/files\/([^/]+)\/stream/.exec(url)?.[1];
      if (!id || !(id in bodies)) throw new Error(`unmatched ${url}`);
      const entry = bodies[id];
      const text =
        typeof entry === "string"
          ? entry
          : await new Promise<string>((resolve) => {
              entry.resolve = resolve;
            });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ etag: '"v1"' }),
        json: async () => ({}),
        text: async () => text,
      } as Response;
    }),
  );
  return calls;
}

function Harness({
  fileId = "f1",
  highlight,
  initial = "edit",
}: {
  fileId?: string;
  highlight?: string;
  initial?: MarkdownViewMode;
}) {
  const [viewMode, setViewMode] = useState<MarkdownViewMode>(initial);
  return (
    <MarkdownChromeProvider
      value={{
        viewMode,
        setViewMode,
        publishSaveState: () => undefined,
        isMobile: false,
      }}
    >
      {(["edit", "split", "preview"] as const).map((m) => (
        <button key={m} type="button" onClick={() => setViewMode(m)}>
          to-{m}
        </button>
      ))}
      <Editor
        fileId={fileId}
        filename="note.md"
        drive="d"
        inlineMode
        highlight={highlight}
      />
    </MarkdownChromeProvider>
  );
}

const marks = () =>
  Array.from(document.querySelectorAll("mark.ask-citation-highlight"));
const markedText = () => marks().map((m) => m.textContent).join("");
const go = (m: string) => fireEvent.click(screen.getByText(`to-${m}`));

beforeEach(() => {
  dirtyRegistry.reset();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  dirtyRegistry.reset();
  vi.unstubAllGlobals();
});

describe("a note opened with ?highlight=", () => {
  it.each(["preview", "split"] as const)(
    "marks the passage and scrolls to it in %s",
    async (mode) => {
      stubStream({ f1: NOTE });
      render(<Harness highlight="beta gamma" initial={mode} />);
      await waitFor(() => expect(markedText()).toBe("beta gamma"));
      await waitFor(() =>
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled(),
      );
    },
  );

  it("marks nothing while only the editor is shown, and marks once Read opens", async () => {
    stubStream({ f1: NOTE });
    render(<Harness highlight="beta gamma" />);
    await screen.findByLabelText("editArea");
    expect(marks()).toHaveLength(0);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    go("preview");
    await waitFor(() => expect(markedText()).toBe("beta gamma"));
    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled(),
    );
  });

  it("marks the passage that is present before the content has arrived", async () => {
    const pending: Pending = { resolve: () => undefined };
    stubStream({ f1: pending });
    render(<Harness highlight="beta gamma" initial="preview" />);
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(marks()).toHaveLength(0);

    await waitFor(() => expect(pending.resolve).not.toBe(undefined));
    await act(async () => pending.resolve(NOTE));
    await waitFor(() => expect(markedText()).toBe("beta gamma"));
  });

  it("marks the passage again in the note opened next", async () => {
    stubStream({ f1: NOTE, f2: "# Other\n\nzeta beta gamma eta.\n" });
    const { rerender } = render(
      <Harness fileId="f1" highlight="beta gamma" initial="preview" />,
    );
    await waitFor(() => expect(markedText()).toBe("beta gamma"));

    rerender(<Harness fileId="f2" highlight="beta gamma" initial="preview" />);
    await waitFor(() => {
      expect(document.body.textContent).toContain("zeta");
      expect(markedText()).toBe("beta gamma");
    });
  });

  it("keeps the mark, and scrolls once, when Read becomes Split", async () => {
    stubStream({ f1: NOTE });
    render(<Harness highlight="beta gamma" initial="preview" />);
    await waitFor(() => expect(markedText()).toBe("beta gamma"));
    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1),
    );

    go("split");
    await screen.findByLabelText("editArea");
    expect(markedText()).toBe("beta gamma");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("is not marked again once Read has been left and the text has changed", async () => {
    stubStream({ f1: NOTE });
    render(<Harness highlight="beta gamma" initial="preview" />);
    await waitFor(() => expect(markedText()).toBe("beta gamma"));

    go("edit");
    setEditorContent(
      await screen.findByLabelText("editArea"),
      "# Title\n\nalpha beta gamma delta, edited.\n",
    );
    go("preview");
    await waitFor(() =>
      expect(document.body.textContent).toContain("edited"),
    );
    expect(marks()).toHaveLength(0);
  });

  it("neither dirties the note nor writes it", async () => {
    const calls = stubStream({ f1: NOTE });
    render(<Harness highlight="beta gamma" initial="preview" />);
    await waitFor(() => expect(markedText()).toBe("beta gamma"));
    go("edit");
    await screen.findByLabelText("editArea");

    expect(dirtyRegistry.isDirty("f1")).toBe(false);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(
      (document.querySelector('[aria-label="editArea"]') as HTMLElement)
        .textContent,
    ).not.toContain("<mark");
  });
});
