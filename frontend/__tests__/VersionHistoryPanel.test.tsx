import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiMocks = vi.hoisted(() => ({
  listFileVersions: vi.fn(),
  getFileVersion: vi.fn(),
  getFileVersionDiff: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) =>
    (key: string, vars?: Record<string, string | number>) => {
      let value = `${namespace}.${key}`;
      if (vars) {
        value += `:${Object.values(vars).join(":")}`;
      }
      return value;
    },
}));

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFileVersions: apiMocks.listFileVersions,
  getFileVersion: apiMocks.getFileVersion,
  getFileVersionDiff: apiMocks.getFileVersionDiff,
}));

const VersionHistoryPanel = (await import("../VersionHistoryPanel")).default;

beforeEach(() => {
  apiMocks.listFileVersions.mockReset();
  apiMocks.getFileVersion.mockReset();
  apiMocks.getFileVersionDiff.mockReset();

  apiMocks.listFileVersions.mockResolvedValue({
    versions: [
      {
        id: 2,
        created_at: "2026-08-20T12:00:00Z",
        nickname: "Aki",
        kind: "explicit",
        size_bytes: 12,
        lines_added: 2,
        lines_removed: 1,
      },
      {
        id: 1,
        created_at: "2026-08-20T11:00:00Z",
        nickname: null,
        kind: "auto",
        size_bytes: 6,
        lines_added: 1,
        lines_removed: 0,
      },
    ],
    total: 51,
    limit: 50,
    offset: 0,
  });
  apiMocks.getFileVersion.mockResolvedValue({
    id: 2,
    content: "# selected version\n",
    etag: "version-etag-is-not-for-restore",
  });
  apiMocks.getFileVersionDiff.mockResolvedValue({
    id: 2,
    lines: [
      { kind: "del", text: "old\n" },
      { kind: "add", text: "new\n" },
      { kind: "add", text: "line" },
    ],
    lines_added: 2,
    lines_removed: 1,
  });
});

afterEach(() => cleanup());

describe("VersionHistoryPanel", () => {
  it("renders newest-first counts, the explicit mark, diff, selectable preview, and pagination", async () => {
    render(
      <VersionHistoryPanel
        fileId="f1"
        refreshKey={0}
        onRestore={vi.fn(async () => true)}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.toggleOpen",
      }),
    );

    expect(await screen.findByText("Aki")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    expect(
      screen.getByLabelText("knowledge.editor.versions.explicit"),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("version-diff")).toHaveTextContent("+new");
      expect(screen.getByTestId("version-diff")).not.toHaveTextContent("@@");
      expect(screen.getByTestId("version-diff")).not.toHaveTextContent("+++");
      expect(screen.getByTestId("version-preview")).toHaveTextContent(
        "# selected version",
      );
    });
    expect(document.querySelector('time[datetime="2026-08-20T12:00:00Z"]')).toHaveTextContent(
      "2026",
    );
    expect(screen.getByTestId("version-preview")).toHaveClass("select-text");
    const nextPage = screen.getByRole("button", {
      name: "knowledge.editor.versions.nextPage",
    });
    expect(nextPage).toBeEnabled();
    fireEvent.click(nextPage);
    await waitFor(() =>
      expect(apiMocks.listFileVersions).toHaveBeenLastCalledWith("f1", {
        limit: 50,
        offset: 50,
      }),
    );
  });

  it("restores the selected version through the editor callback", async () => {
    const onRestore = vi.fn(async () => true);
    render(
      <VersionHistoryPanel
        fileId="f1"
        refreshKey={0}
        onRestore={onRestore}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.toggleOpen",
      }),
    );
    await screen.findByText("Aki");
    fireEvent.click(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.restore",
      }),
    );

    expect(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.restoring",
      }),
    ).toHaveClass("bg-sand", "hover:bg-sand-hover");
    expect(
      screen.getByRole("button", {
        name: "knowledge.editor.versions.restoring",
      }),
    ).not.toHaveClass("bg-danger", "text-danger");

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(2));
  });
});
