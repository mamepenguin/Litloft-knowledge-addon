import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useMemo } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DocumentCaptureStore, type DocumentCaptureCandidate } from "@/lib/documentCapture";
import { clearSourceCaptures, getSourceCaptures } from "@/lib/sourceCapture";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string) =>
      key,
}));

const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(globalThis.__editParam__ ?? ""),
  useRouter: () => ({ push: mockRouterPush }),
}));

// Editor pulls in MarkdownPreview / useShortcuts / useDirty etc. The
// inline-mode branch only needs proof that the editor mounted with
// the right props, so stub the component out and assert via a
// data-testid.
// `editorSelection`, when set, is what the stub publishes through
// `onDocumentCaptureController` — the editor's real one reports the
// reader's selection the same way. Without it the capture control beside
// the editor renders nothing, which is why the mount went untested.
let editorSelection: DocumentCaptureCandidate | null = null;

vi.mock("../Editor", () => ({
  default: (props: {
    fileId: string;
    filename?: string;
    drive: string;
    inlineMode?: boolean;
    autoFocus?: boolean;
    onDocumentCaptureController?: (c: DocumentCaptureStore | null) => void;
  }) => {
    const store = useMemo(() => {
      const created = new DocumentCaptureStore();
      if (editorSelection) created.setCapture(editorSelection);
      return created;
    }, []);
    useEffect(() => {
      props.onDocumentCaptureController?.(store);
      return () => props.onDocumentCaptureController?.(null);
    }, [props, store]);
    return (
      <div
        data-testid="editor-stub"
        data-file-id={props.fileId}
        data-filename={props.filename ?? ""}
        data-drive={props.drive}
        data-inline-mode={props.inlineMode ? "1" : "0"}
        data-auto-focus={props.autoFocus ? "1" : "0"}
      />
    );
  },
}));

declare global {
  // eslint-disable-next-line no-var
  var __editParam__: string | undefined;
}

const KnowledgeEditSection = (await import("../KnowledgeEditSection")).default;
const { _resetPolicyCache } = await import("@/hooks/usePolicy");

const mdFile = {
  id: "f1",
  mime_type: "text/markdown",
  filename: "note.md",
};
const videoFile = { id: "f1", mime_type: "video/mp4", filename: "v.mp4" };
const imageFile = { id: "f1", mime_type: "image/png", filename: "pic.png" };
const textFile = { id: "f1", mime_type: "text/plain", filename: "note.txt" };

function stubFileFetch(
  file: typeof mdFile | null,
  options: { editorEnabled?: boolean; noteFromFileOk?: boolean } = {},
) {
  const { editorEnabled = true, noteFromFileOk = true } = options;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/files/")) {
        return {
          ok: file !== null,
          status: file !== null ? 200 : 404,
          json: async () => file,
        } as Response;
      }
      if (url.includes("/addon-policies")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            addons: {
              knowledge: {
                default: true,
                features: { editor: editorEnabled },
              },
            },
          }),
        } as Response;
      }
      if (url.includes("/note-from-file")) {
        if (!noteFromFileOk) {
          return { ok: false, status: 502, json: async () => ({ detail: "server error" }) } as Response;
        }
        return {
          ok: true,
          status: 201,
          json: async () => ({ note_file_id: "new-note-id", note_path: "Untitled.md" }),
        } as Response;
      }
      if (url.includes("/folder-tree")) {
        return { ok: true, status: 200, json: async () => [] } as Response;
      }
      throw new Error(`stubFileFetch: unexpected url ${url}`);
    }),
  );
}

beforeEach(() => {
  editorSelection = null;
  clearSourceCaptures("d");
  globalThis.__editParam__ = "";
  vi.unstubAllEnvs();
  mockRouterPush.mockClear();
  _resetPolicyCache();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  globalThis.__editParam__ = "";
  _resetPolicyCache();
});

describe("KnowledgeEditSection (flag false, default)", () => {
  it("renders the legacy Edit Note CTA for editable mimes", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "false");
    stubFileFetch(mdFile);

    render(<KnowledgeEditSection fileId="f1" drive="d" />);

    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/drive/d/addons/knowledge?edit=f1",
    );
    expect(screen.queryByTestId("editor-stub")).toBeNull();
  });

  it("offers only the editor, with no second button beside it", async () => {
    // "Create note" was here too, in the same card. It is a
    // `file-actions-menu` entry now: a `.md` file's detail page has one
    // knowledge affordance, and it is the one about *this* note.
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "false");
    stubFileFetch(mdFile);

    render(<KnowledgeEditSection fileId="f1" drive="d" />);
    await screen.findByRole("link");

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing at all for a file it cannot edit", async () => {
    // This is where 130px of a 190-page comic's detail page used to go:
    // a card with a heading and a sentence saying a note could be made.
    // The affordance moved to the `[...]` menu, so this slot has nothing
    // to say about a video, an archive or an image.
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "false");
    stubFileFetch(videoFile);

    const { container } = render(<KnowledgeEditSection fileId="f1" drive="d" />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByTestId("editor-stub")).toBeNull();
  });

  it("renders nothing when the file metadata fetch fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "false");
    stubFileFetch(null);

    render(<KnowledgeEditSection fileId="missing" drive="d" />);
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByTestId("editor-stub")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("KnowledgeEditSection (flag true)", () => {
  it("renders the inline editor instead of the CTA for editable mimes", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    stubFileFetch(mdFile);

    render(<KnowledgeEditSection fileId="f1" drive="d" />);

    const stub = await screen.findByTestId("editor-stub");
    expect(stub.dataset.fileId).toBe("f1");
    expect(stub.dataset.drive).toBe("d");
    expect(stub.dataset.inlineMode).toBe("1");
    expect(stub.dataset.filename).toBe("note.md");
    // Default ?edit param absent -> autoFocus false.
    expect(stub.dataset.autoFocus).toBe("0");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("forwards autoFocus=true when ?edit=1 is present in the URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    globalThis.__editParam__ = "edit=1";
    stubFileFetch(mdFile);

    render(<KnowledgeEditSection fileId="f1" drive="d" />);

    const stub = await screen.findByTestId("editor-stub");
    expect(stub.dataset.autoFocus).toBe("1");
  });

  it("does not focus when ?edit has a different value (e.g. legacy ?edit={id})", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    globalThis.__editParam__ = "edit=f1";
    stubFileFetch(mdFile);

    render(<KnowledgeEditSection fileId="f1" drive="d" />);

    const stub = await screen.findByTestId("editor-stub");
    expect(stub.dataset.autoFocus).toBe("0");
  });

  it("renders nothing for a non-editable mime when the flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    stubFileFetch(imageFile);

    const { container } = render(<KnowledgeEditSection fileId="f1" drive="d" />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByTestId("editor-stub")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  // C2: spec 2026-05-10 §3 — editor は Markdown のみ。text/plain には出ない。
  it("renders nothing for text/plain (C2: editor markdown-only)", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    stubFileFetch(textFile);

    const { container } = render(<KnowledgeEditSection fileId="f1" drive="d" />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByTestId("editor-stub")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  // D4: drives.json.addons.knowledge.editor === false → nothing renders.
  it("does not render when per-drive policy disables the editor", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    stubFileFetch(mdFile, { editorEnabled: false });

    render(<KnowledgeEditSection fileId="f1" drive="locked-drive" />);
    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const policyCalled = calls.some(([url]) =>
        String(url).includes("/addon-policies"),
      );
      expect(policyCalled).toBe(true);
    });
    expect(screen.queryByTestId("editor-stub")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("KnowledgeEditSection > the editor's own capture control", () => {
  it("offers to quote what the reader has selected in the note", async () => {
    // This mount is half of the reason the `file-detail-actions` entry
    // is safe: it holds the *editor's* controller, and core's stays null
    // while the editor is the canvas. Neither half was asserted, so the
    // control could have vanished with nothing to say so.
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    editorSelection = {
      kind: "selection",
      quote: "A selected paragraph",
      locator: { label: "Introduction" },
    };
    stubFileFetch(mdFile);

    render(<KnowledgeEditSection fileId="f1" drive="d" />);
    await screen.findByTestId("editor-stub");

    const button = await screen.findByRole("button");
    fireEvent.click(button);

    expect(getSourceCaptures("d")).toEqual([
      expect.objectContaining({
        sourceFileId: "f1",
        filename: "note.md",
        // A note is a document whatever the addon that opened it: a
        // capture filed as a video would sort and render as one.
        fileType: "document",
        kind: "document_selection",
        quote: "A selected paragraph",
      }),
    ]);
  });

  it("offers nothing while the reader has selected nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    editorSelection = null;
    stubFileFetch(mdFile);

    render(<KnowledgeEditSection fileId="f1" drive="d" />);
    await screen.findByTestId("editor-stub");

    expect(screen.queryByRole("button")).toBeNull();
  });
});

