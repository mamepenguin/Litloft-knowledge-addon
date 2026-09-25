import { afterEach, describe, expect, it, vi } from "vitest";
import { useMemo, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";

import {
  MarkdownChromeProvider,
  type MarkdownViewMode,
} from "@/lib/markdownChromeContext";
import { editorSelection, setEditorSelection } from "./editorTestDriver";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => null,
}));

vi.mock("@/components/PropertiesPanel", () => ({
  PropertiesPanel: () => null,
}));

interface Binding {
  key: string;
  handler: () => void;
}
let latestBindings: Binding[] = [];
vi.mock("@/hooks/useShortcuts", () => ({
  useShortcuts: (_scope: string, _label: string, bindings: Binding[]) => {
    latestBindings = bindings;
  },
}));

const Editor = (await import("../Editor")).default;

function stubStream(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/stream")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ etag: '"e1"' }),
          text: async () => text,
          json: async () => ({}),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => "",
        json: async () => ({}),
      } as Response;
    }),
  );
}

function ChromeHost({ initial }: { initial: MarkdownViewMode }) {
  const [viewMode, setViewMode] = useState<MarkdownViewMode>(initial);
  const value = useMemo(
    () => ({
      viewMode,
      setViewMode,
      publishSaveState: () => undefined,
      isMobile: false,
    }),
    [viewMode],
  );
  return (
    <MarkdownChromeProvider value={value}>
      <button type="button" onClick={() => setViewMode("edit")}>
        host-edit
      </button>
      <button type="button" onClick={() => setViewMode("split")}>
        host-split
      </button>
      <button type="button" onClick={() => setViewMode("preview")}>
        host-preview
      </button>
      <Editor fileId="f1" filename="note.md" drive="d" inlineMode fillHeight />
    </MarkdownChromeProvider>
  );
}

async function renderChrome(initial: MarkdownViewMode) {
  stubStream("hello world");
  render(<ChromeHost initial={initial} />);
  return screen.findByLabelText("editArea");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  latestBindings = [];
});

describe("Editor focuses when leaving preview", () => {
  it("focuses the editor on preview -> edit", async () => {
    const editor = await renderChrome("preview");
    expect(document.activeElement).not.toBe(editor);

    fireEvent.click(screen.getByText("host-edit"));

    expect(document.activeElement).toBe(editor);
  });

  it("focuses the editor on preview -> split", async () => {
    const editor = await renderChrome("preview");

    fireEvent.click(screen.getByText("host-split"));

    expect(document.activeElement).toBe(editor);
  });

  it("leaves focus alone on split -> edit", async () => {
    const editor = await renderChrome("split");
    const other = screen.getByText("host-edit");
    act(() => other.focus());

    fireEvent.click(other);

    expect(document.activeElement).toBe(other);
    expect(document.activeElement).not.toBe(editor);
  });

  it("keeps the caret where it was", async () => {
    const editor = await renderChrome("edit");
    setEditorSelection(editor, 5);
    fireEvent.click(screen.getByText("host-preview"));

    fireEvent.click(screen.getByText("host-edit"));

    expect(document.activeElement).toBe(editor);
    expect(editorSelection(editor)).toEqual({ start: 5, end: 5 });
  });

  it("scrolls the caret into view", async () => {
    const editor = await renderChrome("edit");
    setEditorSelection(editor, 5);
    fireEvent.click(screen.getByText("host-preview"));
    const spy = vi.spyOn(EditorView, "scrollIntoView");

    fireEvent.click(screen.getByText("host-edit"));

    expect(spy).toHaveBeenCalledWith(5, { y: "nearest" });
  });

  it("does not scroll when the mode change does not focus", async () => {
    await renderChrome("split");
    const spy = vi.spyOn(EditorView, "scrollIntoView");

    fireEvent.click(screen.getByText("host-edit"));

    expect(spy).not.toHaveBeenCalled();
  });

  it("focuses when the standalone toggle leaves preview", async () => {
    stubStream("hello");
    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const editor = await screen.findByLabelText("editArea");
    fireEvent.click(screen.getByTestId("view-mode-preview"));
    expect(document.activeElement).not.toBe(editor);

    fireEvent.click(screen.getByTestId("view-mode-edit"));

    expect(document.activeElement).toBe(editor);
  });

  it("focuses when the cycle shortcut leaves preview", async () => {
    stubStream("hello");
    render(<Editor fileId="f1" filename="note.md" drive="d" inlineMode />);
    const editor = await screen.findByLabelText("editArea");
    fireEvent.click(screen.getByTestId("view-mode-preview"));

    const cycle = latestBindings.find((b) => b.key === "ctrl+shift+\\");
    expect(cycle).toBeDefined();
    act(() => cycle!.handler());

    expect(document.activeElement).toBe(editor);
  });
});
