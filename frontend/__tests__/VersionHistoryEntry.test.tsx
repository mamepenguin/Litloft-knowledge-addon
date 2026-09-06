import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiMocks = vi.hoisted(() => ({
  listFileVersions: vi.fn(),
  getFileVersion: vi.fn(),
  getFileVersionDiff: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  listFileVersions: apiMocks.listFileVersions,
  getFileVersion: apiMocks.getFileVersion,
  getFileVersionDiff: apiMocks.getFileVersionDiff,
}));

const VersionHistoryPanel = (await import("../VersionHistoryPanel")).default;
const VersionHistoryMenuItem = (await import("../VersionHistoryMenuItem")).default;

const MENU_LABEL = "knowledge.editor.versions.heading";

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
    ],
    total: 1,
    limit: 50,
    offset: 0,
  });
  apiMocks.getFileVersion.mockResolvedValue({ id: 2, content: "body", etag: "e" });
  apiMocks.getFileVersionDiff.mockResolvedValue({
    id: 2,
    lines: [{ kind: "add", text: "new" }],
    lines_added: 1,
    lines_removed: 0,
  });
});

afterEach(() => cleanup());

describe("the version history entry in the [...] menu", () => {
  it("draws nothing when no editor is mounted to open", () => {
    // Every file detail page renders the slot, but only a Markdown note
    // on a drive with the editor switched on has a panel behind it. An
    // entry that cannot reach one would be a row that does nothing.
    render(<VersionHistoryMenuItem fileId="f1" />);

    expect(screen.queryByRole("menuitem", { name: MENU_LABEL })).toBeNull();
  });

  it("draws nothing when the mounted panel belongs to another file", () => {
    render(
      <>
        <VersionHistoryPanel
          fileId="other"
          refreshKey={0}
          onRestore={vi.fn(async () => true)}
        />
        <VersionHistoryMenuItem fileId="f1" />
      </>,
    );

    expect(screen.queryByRole("menuitem", { name: MENU_LABEL })).toBeNull();
  });

  it("opens the panel, and closes the menu, when pressed", async () => {
    const onRequestClose = vi.fn();
    render(
      <>
        <VersionHistoryPanel
          fileId="f1"
          refreshKey={0}
          onRestore={vi.fn(async () => true)}
        />
        <VersionHistoryMenuItem fileId="f1" onRequestClose={onRequestClose} />
      </>,
    );

    const entry = await screen.findByRole("menuitem", { name: MENU_LABEL });
    // Closed to start with: the entry reveals the history, it does not
    // report that it is already showing.
    expect(screen.queryByTestId("version-row-2")).toBeNull();

    fireEvent.click(entry);

    await waitFor(() =>
      expect(screen.getByTestId("version-row-2")).toBeInTheDocument(),
    );
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("stops offering the entry once the panel unmounts", async () => {
    const { rerender } = render(
      <>
        <VersionHistoryPanel
          fileId="f1"
          refreshKey={0}
          onRestore={vi.fn(async () => true)}
        />
        <VersionHistoryMenuItem fileId="f1" />
      </>,
    );
    await screen.findByRole("menuitem", { name: MENU_LABEL });

    rerender(<VersionHistoryMenuItem fileId="f1" />);

    expect(screen.queryByRole("menuitem", { name: MENU_LABEL })).toBeNull();
  });
});
