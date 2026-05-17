import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string) =>
      key,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/components/CurrentDriveProvider", () => ({
  useCurrentDrive: () => "test-drive",
}));

vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: () => null,
}));

const _createFile = vi.fn();
let _isCreating = false;
vi.mock("@/hooks/useCreateFile", () => ({
  useCreateFile: (...args: unknown[]) => {
    _useCreateFileArgs = args;
    return { createFile: _createFile, isCreating: _isCreating };
  },
}));
let _useCreateFileArgs: unknown[] = [];

vi.mock("@/components/FolderPicker", () => ({
  FolderPicker: () => <div data-testid="folder-picker" />,
}));

vi.mock("../ConnectionsGraph", () => ({
  default: () => <div data-testid="connections-graph" />,
}));

vi.mock("../api", () => ({
  createClip: vi.fn(),
  findClipsByUrl: vi.fn(),
}));

const KnowledgeDashboard = (await import("../KnowledgeDashboard")).default;

describe("KnowledgeDashboard quick-memo button", () => {
  beforeEach(() => {
    _createFile.mockReset();
    _isCreating = false;
    _useCreateFileArgs = [];
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("constructs useCreateFile with the current drive and drive-root path", () => {
    render(<KnowledgeDashboard />);
    expect(_useCreateFileArgs).toEqual(["test-drive", ""]);
  });

  it("invokes createFile when the quick-memo button is clicked", () => {
    render(<KnowledgeDashboard />);
    const btn = screen.getByRole("button", { name: /quickMemo/ });
    fireEvent.click(btn);
    expect(_createFile).toHaveBeenCalledTimes(1);
  });

  it("disables the quick-memo button while a note is being created", () => {
    _isCreating = true;
    render(<KnowledgeDashboard />);
    const btn = screen.getByRole("button", {
      name: /quickMemo/,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
