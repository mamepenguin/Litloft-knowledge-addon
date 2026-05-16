/**
 * D&D / クリップボードペースト アップロード — spec 2026-05-16 Phase 2
 *
 * 確認内容:
 *  - ファイルをドロップ → placeholder が挿入される
 *  - アップロード完了 → placeholder が loft://actual_id に置換される
 *  - 画像ファイル → `![]()` 形式、その他 → `[]()` 形式
 *  - 複数ファイル同時ドロップ → 各 placeholder が独立して置換
 *  - アップロード失敗 → placeholder 削除 + toast.error
 *  - image/* を paste → アップロードが走る
 *  - テキストを paste → 通常ペーストのまま（preventDefault なし）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, vars?: Record<string, string | number>) => {
      if (vars) {
        return Object.entries(vars).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
          key,
        );
      }
      return key;
    },
}));

vi.mock("@/hooks/useShortcuts", () => ({
  useShortcuts: () => undefined,
}));

vi.mock("@/components/MarkdownPreview", () => ({
  MarkdownPreview: () => null,
}));

const toastErrorMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ error: toastErrorMock, success: vi.fn(), info: vi.fn() }),
}));

const initUploadMock = vi.hoisted(() => vi.fn());
const uploadChunkMock = vi.hoisted(() => vi.fn());
const completeUploadMock = vi.hoisted(() => vi.fn());
const getWikiResolutionsMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({}),
);

vi.mock("@/lib/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    initUpload: initUploadMock,
    uploadChunk: uploadChunkMock,
    completeUpload: completeUploadMock,
    getWikiResolutions: getWikiResolutionsMock,
  };
});

const Editor = (await import("../Editor")).default;

// Stubs fetch for getFileContent (/api/files/{id}/stream) and putFileContent.
// Returns a controller that lets tests override the content response.
function stubContentFetch(content = "body\n") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/stream") && !url.includes("PUT")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ etag: '"etag1"' }),
          text: async () => content,
          json: async () => null,
        } as unknown as Response;
      }
      // PUT /stream (autosave) — respond ok silently
      return {
        ok: true,
        status: 204,
        headers: new Headers({ etag: '"etag2"' }),
        text: async () => "",
        json: async () => null,
      } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  toastErrorMock.mockClear();
  initUploadMock.mockReset();
  uploadChunkMock.mockReset();
  completeUploadMock.mockReset();
  getWikiResolutionsMock.mockResolvedValue({});

  // Default upload API responses — override in specific tests.
  initUploadMock.mockResolvedValue({ upload_id: "uid1", total_chunks: 1 });
  uploadChunkMock.mockResolvedValue({});
  completeUploadMock.mockResolvedValue({ id: "fileABC000001" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function getTextarea() {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "editArea" });
}

describe("Editor D&D / ペースト アップロード", () => {
  describe("ドロップ", () => {
    it("画像ファイルをドロップすると placeholder が挿入される", async () => {
      stubContentFetch("body\n");
      render(
        <Editor
          fileId="f1"
          filename="note.md"
          folderPath="notes/"
          drive="d"
          inlineMode
        />,
      );
      const ta = await waitFor(() => getTextarea());

      const file = new File(["data"], "photo.png", { type: "image/png" });
      fireEvent.drop(ta, { dataTransfer: { files: [file] } });

      await waitFor(() => {
        expect(ta.value).toMatch(
          /!\[photo\.png uploading\.\.\.\]\(loft:\/\/pending-/,
        );
      });
    });

    it("画像アップロード完了 → placeholder が ![name](loft://id) に置換される", async () => {
      stubContentFetch("body\n");
      completeUploadMock.mockResolvedValue({ id: "abc123def456" });

      render(
        <Editor
          fileId="f1"
          filename="note.md"
          folderPath="notes/"
          drive="d"
          inlineMode
        />,
      );
      const ta = await waitFor(() => getTextarea());

      const file = new File(["data"], "photo.png", { type: "image/png" });
      fireEvent.drop(ta, { dataTransfer: { files: [file] } });

      await waitFor(() => {
        expect(ta.value).toContain("![photo.png](loft://abc123def456)");
      });
      // placeholder は残らない
      expect(ta.value).not.toContain("uploading...");
    });

    it("非画像ファイルをドロップ → [name](loft://id) 形式", async () => {
      stubContentFetch("body\n");
      completeUploadMock.mockResolvedValue({ id: "xyz789ghi012" });

      render(
        <Editor
          fileId="f1"
          filename="note.md"
          folderPath="notes/"
          drive="d"
          inlineMode
        />,
      );
      const ta = await waitFor(() => getTextarea());

      const file = new File(["data"], "document.pdf", {
        type: "application/pdf",
      });
      fireEvent.drop(ta, { dataTransfer: { files: [file] } });

      await waitFor(() => {
        expect(ta.value).toContain("[document.pdf](loft://xyz789ghi012)");
      });
      // 画像形式（![]()）ではない
      expect(ta.value).not.toMatch(/!\[document\.pdf\]/);
    });

    it("複数ファイル同時ドロップ → 各 placeholder が独立して置換される", async () => {
      stubContentFetch("body\n");
      completeUploadMock
        .mockResolvedValueOnce({ id: "aaa111bbb222" })
        .mockResolvedValueOnce({ id: "ccc333ddd444" });

      render(
        <Editor
          fileId="f1"
          filename="note.md"
          folderPath="notes/"
          drive="d"
          inlineMode
        />,
      );
      const ta = await waitFor(() => getTextarea());

      const files = [
        new File(["a"], "img_a.png", { type: "image/png" }),
        new File(["b"], "img_b.jpg", { type: "image/jpeg" }),
      ];
      fireEvent.drop(ta, { dataTransfer: { files } });

      await waitFor(() => {
        expect(ta.value).toContain("![img_a.png](loft://aaa111bbb222)");
        expect(ta.value).toContain("![img_b.jpg](loft://ccc333ddd444)");
      });
      expect(ta.value).not.toContain("uploading...");
    });

    it("アップロード失敗 → placeholder 削除 + toast.error 表示", async () => {
      stubContentFetch("body\n");
      initUploadMock.mockRejectedValue(new Error("network error"));

      render(
        <Editor
          fileId="f1"
          filename="note.md"
          folderPath="notes/"
          drive="d"
          inlineMode
        />,
      );
      const ta = await waitFor(() => getTextarea());

      const file = new File(["data"], "photo.png", { type: "image/png" });
      fireEvent.drop(ta, { dataTransfer: { files: [file] } });

      // The translation mock returns the key as-is (variables are not
      // applied to a key that has no matching placeholder).
      await waitFor(() => {
        expect(toastErrorMock).toHaveBeenCalled();
      });
      // placeholder は残らない
      expect(ta.value).not.toContain("uploading...");
    });

    it("drive と folderPath がアップロード API に渡される", async () => {
      stubContentFetch("body\n");

      render(
        <Editor
          fileId="f1"
          filename="note.md"
          folderPath="my-notes/"
          drive="drive-x"
          inlineMode
        />,
      );
      const ta = await waitFor(() => getTextarea());

      const file = new File(["data"], "photo.png", { type: "image/png" });
      fireEvent.drop(ta, { dataTransfer: { files: [file] } });

      await waitFor(() => {
        expect(initUploadMock).toHaveBeenCalledWith(
          "drive-x",
          expect.objectContaining({ folder_path: "my-notes/" }),
        );
      });
    });
  });

  describe("クリップボードペースト", () => {
    it("image/* をペーストするとアップロードが走る", async () => {
      stubContentFetch("body\n");
      completeUploadMock.mockResolvedValue({ id: "img000000001" });

      render(
        <Editor
          fileId="f1"
          filename="note.md"
          folderPath="notes/"
          drive="d"
          inlineMode
        />,
      );
      const ta = await waitFor(() => getTextarea());

      const file = new File(["data"], "pasted.png", { type: "image/png" });
      const clipboardEvent = {
        clipboardData: {
          items: [{ type: "image/png", getAsFile: () => file }],
        },
        preventDefault: vi.fn(),
      };
      fireEvent.paste(ta, clipboardEvent);

      await waitFor(() => {
        expect(ta.value).toContain("![pasted.png](loft://img000000001)");
      });
    });

    it("テキストをペーストしても preventDefault は呼ばれない（通常ペースト）", async () => {
      stubContentFetch("body\n");

      render(
        <Editor
          fileId="f1"
          filename="note.md"
          folderPath="notes/"
          drive="d"
          inlineMode
        />,
      );
      const ta = await waitFor(() => getTextarea());

      const preventDefault = vi.fn();
      fireEvent.paste(ta, {
        clipboardData: {
          items: [{ type: "text/plain", getAsFile: () => null }],
        },
        preventDefault,
      });

      expect(preventDefault).not.toHaveBeenCalled();
      expect(initUploadMock).not.toHaveBeenCalled();
    });
  });
});
