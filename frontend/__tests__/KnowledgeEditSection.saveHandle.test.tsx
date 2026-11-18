import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { EditorSaveHandle } from "../editorSaveHandle";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("../MediaCaptureAction", () => ({ default: () => null }));

let received: unknown = "unset";
vi.mock("../Editor", () => ({
  default: (props: { saveHandle?: unknown }) => {
    received = props.saveHandle;
    return <div data-testid="editor-stub" />;
  },
}));

const KnowledgeEditSection = (await import("../KnowledgeEditSection")).default;
const { _resetPolicyCache } = await import("@/hooks/usePolicy");

beforeEach(() => {
  received = "unset";
  _resetPolicyCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/addon-policies")) {
        return { ok: true, status: 200, json: async () => ({ addons: {} }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "f1",
          mime_type: "text/markdown",
          filename: "note.md",
          folder_path: "",
        }),
      } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// SPEC-ADDON-132 Library step 6: the section hands the ref on to the editor.
describe("KnowledgeEditSection saveHandle (SPEC-ADDON-132)", () => {
  it("passes the same ref object to the Editor", async () => {
    const ref = { current: null } as React.MutableRefObject<EditorSaveHandle | null>;
    render(<KnowledgeEditSection fileId="f1" drive="d" saveHandle={ref} />);
    await screen.findByTestId("editor-stub");
    expect(received).toBe(ref);
  });

  it("passes nothing when the host gave nothing", async () => {
    render(<KnowledgeEditSection fileId="f1" drive="d" />);
    await screen.findByTestId("editor-stub");
    expect(received).toBeUndefined();
  });
});
