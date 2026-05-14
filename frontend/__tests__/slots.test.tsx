import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Stub useTranslations before importing components that use it.
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
    const map: Record<string, string> = {
      "knowledge.editSection.title": "Knowledge",
      "knowledge.editSection.description": "Open this note in the Markdown editor.",
      "knowledge.editSection.openEditor": "Open editor",
      "knowledge.createNote.button": "Create note",
      "knowledge.createNote.creating": "Creating…",
      "knowledge.createNote.description": "Create a new note linked to this file.",
      "knowledge.createNote.error": "Failed to create note",
    };
    void vars;
    return map[`${ns}.${key}`] ?? `${ns}.${key}`;
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../Editor", () => ({
  default: (props: { fileId: string; drive: string; inlineMode?: boolean }) => (
    <div data-testid="editor-stub" data-file-id={props.fileId} />
  ),
}));

const KnowledgeEditSection = (await import("../KnowledgeEditSection")).default;

function stubFetch(mapping: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/addon-policies")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          addons: { knowledge: { default: true, features: { editor: true } } },
        }),
      } as Response;
    }
    const body = mapping[url];
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("KnowledgeEditSection", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubEnv("NEXT_PUBLIC_INLINE_KNOWLEDGE_EDITOR", "false");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("renders editor link for text/markdown files", async () => {
    stubFetch({
      "/api/files/f1": { id: "f1", mime_type: "text/markdown", filename: "a.md" },
    });
    render(<KnowledgeEditSection fileId="f1" drive="d" />);
    const link = await screen.findByRole("link", { name: /open editor/i });
    expect(link.getAttribute("href")).toBe("/drive/d/addons/knowledge?edit=f1");
  });

  it("renders Create note button for non-text files (no editor link)", async () => {
    stubFetch({
      "/api/files/f2": { id: "f2", mime_type: "video/mp4", filename: "x.mp4" },
    });
    render(<KnowledgeEditSection fileId="f2" drive="d" />);
    await screen.findByRole("button", { name: /create note/i });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing when fetch fails", async () => {
    stubFetch({});
    const { container } = render(<KnowledgeEditSection fileId="missing" drive="d" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
  });

  // C2 採用 (spec 2026-05-10 §3): Markdown のみ編集対象。Create note ボタンは表示。
  it("shows Create note button but no editor for text/plain (C2: editor markdown-only)", async () => {
    stubFetch({
      "/api/files/f3": { id: "f3", mime_type: "text/plain", filename: "n.txt" },
    });
    render(<KnowledgeEditSection fileId="f3" drive="d" />);
    await screen.findByRole("button", { name: /create note/i });
    expect(screen.queryByRole("link")).toBeNull();
  });
});
