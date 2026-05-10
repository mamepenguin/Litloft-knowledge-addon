import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// Stub useTranslations before importing components that use it.
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
    const map: Record<string, string> = {
      "knowledge.sidebar.activePrefix": `Active: ${vars?.label ?? ""}`,
      "knowledge.editSection.title": "Knowledge",
      "knowledge.editSection.description": "Open this note in the Markdown editor.",
      "knowledge.editSection.openEditor": "Open editor",
    };
    return map[`${ns}.${key}`] ?? `${ns}.${key}`;
  },
}));

// Drive context: KnowledgeVaultSummary is drive-scoped and pulls the
// current drive from ``CurrentDriveProvider``. The test shell doesn't
// mount a <Provider/>, so we stub the hook to return a fixed value.
let _mockDrive: string | null = "test-drive";
vi.mock("@/components/CurrentDriveProvider", () => ({
  useCurrentDrive: () => _mockDrive,
}));

const KnowledgeEditSection = (await import("../KnowledgeEditSection")).default;
const KnowledgeVaultSummary = (await import("../KnowledgeVaultSummary")).default;

function wrap(ui: React.ReactElement) {
  return ui;
}

function stubFetch(mapping: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
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
    // Legacy "open editor" link is only rendered when the inline-
    // editor flag is off. PR-7 flipped the default to true, so these
    // legacy-link tests opt out explicitly. The flag-true rendering
    // (Editor inline) is covered in KnowledgeEditSection.test.tsx.
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
    render(wrap(<KnowledgeEditSection fileId="f1" drive="d" />));
    const link = await screen.findByRole("link", { name: /open editor/i });
    expect(link.getAttribute("href")).toBe("/drive/d/addons/knowledge?edit=f1");
  });

  it("renders nothing for non-text files", async () => {
    stubFetch({
      "/api/files/f2": { id: "f2", mime_type: "video/mp4", filename: "x.mp4" },
    });
    const { container } = render(wrap(<KnowledgeEditSection fileId="f2" drive="d" />));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when fetch fails", async () => {
    stubFetch({});
    const { container } = render(wrap(<KnowledgeEditSection fileId="missing" drive="d" />));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
  });

  // C2 採用 (spec 2026-05-10 §3): Markdown のみ編集対象。
  it("does not render for text/plain (C2: markdown-only)", async () => {
    stubFetch({
      "/api/files/f3": { id: "f3", mime_type: "text/plain", filename: "n.txt" },
    });
    const { container } = render(
      wrap(<KnowledgeEditSection fileId="f3" drive="d" />),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
  });
});

describe("KnowledgeVaultSummary", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    _mockDrive = "test-drive";
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing when no current drive", async () => {
    _mockDrive = null;
    stubFetch({});
    const { container } = render(wrap(<KnowledgeVaultSummary />));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
  });

  it("renders active vault label", async () => {
    stubFetch({
      "/api/addons/knowledge/vaults": {
        vaults: [
          {
            id: 1,
            label: "Work",
            drive: "d",
            path: "N",
            is_active: true,
            created_at: "",
          },
        ],
        active_vault_id: 1,
      },
    });
    render(wrap(<KnowledgeVaultSummary />));
    await waitFor(() => {
      expect(screen.getByText(/Active:\s*Work/)).toBeTruthy();
    });
  });

  it("renders nothing when no active vault", async () => {
    stubFetch({
      "/api/addons/knowledge/vaults": { vaults: [], active_vault_id: null },
    });
    const { container } = render(wrap(<KnowledgeVaultSummary />));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
  });
});
