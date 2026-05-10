import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string) =>
      key,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(globalThis.__editParam__ ?? ""),
}));

// Editor pulls in MarkdownPreview / useShortcuts / useDirty etc. The
// inline-mode branch only needs proof that the editor mounted with
// the right props, so stub the component out and assert via a
// data-testid.
vi.mock("../Editor", () => ({
  default: (props: {
    fileId: string;
    filename?: string;
    drive: string;
    inlineMode?: boolean;
    autoFocus?: boolean;
  }) => (
    <div
      data-testid="editor-stub"
      data-file-id={props.fileId}
      data-filename={props.filename ?? ""}
      data-drive={props.drive}
      data-inline-mode={props.inlineMode ? "1" : "0"}
      data-auto-focus={props.autoFocus ? "1" : "0"}
    />
  ),
}));

declare global {
  // eslint-disable-next-line no-var
  var __editParam__: string | undefined;
}

const KnowledgeEditSection = (await import("../KnowledgeEditSection")).default;

const mdFile = {
  id: "f1",
  mime_type: "text/markdown",
  filename: "note.md",
};

function stubFileFetch(file: typeof mdFile | null) {
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
      throw new Error(`stubFileFetch: unexpected url ${url}`);
    }),
  );
}

beforeEach(() => {
  globalThis.__editParam__ = "";
  vi.unstubAllEnvs();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  globalThis.__editParam__ = "";
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

  it("renders nothing for non-editable mimes", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "false");
    stubFileFetch({
      id: "f1",
      mime_type: "video/mp4",
      filename: "v.mp4",
    });

    render(<KnowledgeEditSection fileId="f1" drive="d" />);
    // Wait for the fetch promise to settle then assert nothing rendered.
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
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

  it("still suppresses rendering for non-editable mimes when the flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "true");
    stubFileFetch({
      id: "f1",
      mime_type: "image/png",
      filename: "pic.png",
    });

    render(<KnowledgeEditSection fileId="f1" drive="d" />);
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("editor-stub")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
