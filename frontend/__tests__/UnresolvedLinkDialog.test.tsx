import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/**
 * Phase C, spec 2026-05-12-markdown-link-three-forms.md §3.8.
 *
 * Clicking an unresolved wiki-link (``<span class="wiki-unresolved">``)
 * pops up a dialog that lets the user create a new note named after the
 * unresolved target. The dialog is owned by the Knowledge addon because
 * only Knowledge knows how to mint a fresh ``.md`` file -- core only
 * exposes the CSS class so the slot can find the targets.
 *
 * Contract:
 *   - The dialog opens with the unresolved target text pre-filled as
 *     the filename (``<Target>.md``).
 *   - The default folder is the same folder as the current note.
 *   - Confirm calls ``createTextFile(drive, {path, content})`` then closes.
 *   - 409 Conflict from the backend surfaces an error and keeps the
 *     dialog open.
 *   - Cancel closes the dialog without any API call.
 *   - The parent is notified on success so it can refetch wiki
 *     resolutions and have the link turn from unresolved -> resolved.
 *
 * These tests run RED until ``UnresolvedLinkDialog`` is implemented.
 */

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

const createTextFileMock = vi.hoisted(() => vi.fn());
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    createTextFile: createTextFileMock,
  };
});

const UnresolvedLinkDialog = (
  await import("../UnresolvedLinkDialog")
).default;

beforeEach(() => {
  createTextFileMock.mockReset();
});
afterEach(() => {
  cleanup();
});

interface DialogProps {
  drive: string;
  target: string;
  defaultFolder: string;
  open: boolean;
  onClose: () => void;
  onCreated?: (file: { id: string; filename: string }) => void;
}

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const props: DialogProps = {
    drive: "vault",
    target: "Year-in-review",
    defaultFolder: "notes/2026",
    open: true,
    onClose: vi.fn(),
    onCreated: vi.fn(),
    ...overrides,
  };
  const utils = render(<UnresolvedLinkDialog {...props} />);
  return { ...utils, props };
}

describe("UnresolvedLinkDialog", () => {
  it("pre-fills the filename input from the unresolved target text", () => {
    renderDialog({ target: "Year-in-review" });
    const input = screen.getByLabelText(/filename/i) as HTMLInputElement;
    // Expected default: target + .md (so the user can immediately confirm).
    expect(input.value).toMatch(/^Year-in-review(\.md)?$/);
  });

  it("pre-fills the folder field with the current note's folder", () => {
    renderDialog({ defaultFolder: "notes/2026" });
    const folder = screen.getByLabelText(/folder/i) as HTMLInputElement;
    expect(folder.value).toBe("notes/2026");
  });

  it("calls createTextFile with default folder + filename on confirm", async () => {
    createTextFileMock.mockResolvedValue({
      id: "newfile00001",
      filename: "Year-in-review.md",
      title: "Year-in-review",
      drive: "vault",
      folder_path: "notes/2026",
      file_type: "text",
      mime_type: "text/markdown",
      thumbnail_url: "",
      file_size: 0,
      created_at: "",
      updated_at: "",
    });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onCreated, onClose });

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(createTextFileMock).toHaveBeenCalledTimes(1);
    });
    const [drive, body] = createTextFileMock.mock.calls[0];
    expect(drive).toBe("vault");
    expect(body.path).toBe("notes/2026/Year-in-review.md");
    // The initial body for a newly minted Knowledge note carries an
    // H1 with the target so the resolver picks it up immediately.
    expect(typeof body.content).toBe("string");
    expect(body.content).toMatch(/Year-in-review/);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: "newfile00001" }),
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("uses a custom folder when the user edits the folder field", async () => {
    createTextFileMock.mockResolvedValue({
      id: "newfile00001",
      filename: "Year-in-review.md",
      title: "Year-in-review",
      drive: "vault",
      folder_path: "archive",
      file_type: "text",
      mime_type: "text/markdown",
      thumbnail_url: "",
      file_size: 0,
      created_at: "",
      updated_at: "",
    });
    renderDialog();

    const folder = screen.getByLabelText(/folder/i) as HTMLInputElement;
    fireEvent.change(folder, { target: { value: "archive" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(createTextFileMock).toHaveBeenCalled();
    });
    const body = createTextFileMock.mock.calls[0][1];
    expect(body.path).toBe("archive/Year-in-review.md");
  });

  it("appends .md when the user-edited filename is missing the extension", async () => {
    createTextFileMock.mockResolvedValue({
      id: "newfile00001",
      filename: "Plan.md",
      title: "Plan",
      drive: "vault",
      folder_path: "notes/2026",
      file_type: "text",
      mime_type: "text/markdown",
      thumbnail_url: "",
      file_size: 0,
      created_at: "",
      updated_at: "",
    });
    renderDialog();

    const filenameInput = screen.getByLabelText(/filename/i) as HTMLInputElement;
    fireEvent.change(filenameInput, { target: { value: "Plan" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      const body = createTextFileMock.mock.calls[0][1];
      expect(body.path).toMatch(/Plan\.md$/);
    });
  });

  it("keeps the dialog open and surfaces an error on 409 conflict", async () => {
    createTextFileMock.mockRejectedValueOnce(
      new Error("Conflict: file already exists"),
    );
    const onClose = vi.fn();
    renderDialog({ onClose });

    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    // Error message visible to the user.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    // onClose was NOT called -- dialog stays open so the user can pick
    // a different filename.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes without calling createTextFile when the user clicks Cancel", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(createTextFileMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when open=false", () => {
    const { container } = renderDialog({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("disables the Create button when the filename is empty", () => {
    renderDialog({ target: "" });
    const filenameInput = screen.getByLabelText(/filename/i) as HTMLInputElement;
    fireEvent.change(filenameInput, { target: { value: "" } });
    const createBtn = screen.getByRole("button", { name: /create/i });
    expect((createBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects path-traversal segments in the filename", () => {
    renderDialog();
    const filenameInput = screen.getByLabelText(/filename/i) as HTMLInputElement;
    fireEvent.change(filenameInput, { target: { value: "../escape" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    // Either the create button is disabled or an inline error appears,
    // but createTextFile is never called.
    expect(createTextFileMock).not.toHaveBeenCalled();
  });
});
