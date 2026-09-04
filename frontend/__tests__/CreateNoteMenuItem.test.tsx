/**
 * "Create note", after it left the file detail page for the `[...]` menu.
 *
 * The behaviour did not change — a dialog, an API call, a redirect into
 * the editor — so the test that held it did not go with the card. It
 * moved here, which is where the behaviour now lives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string) =>
      key,
}));

const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: mockRouterPush }),
}));

const CreateNoteMenuItem = (await import("../CreateNoteMenuItem")).default;
const { _resetPolicyCache } = await import("@/hooks/usePolicy");

function stubFetch({ editorEnabled = true } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/addon-policies")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            addons: {
              knowledge: { default: true, features: { editor: editorEnabled } },
            },
          }),
        } as Response;
      }
      if (url.includes("/note-from-file")) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            note_file_id: "new-note-id",
            note_path: "Untitled.md",
          }),
        } as Response;
      }
      if (url.includes("/folder-tree")) {
        return { ok: true, status: 200, json: async () => [] } as Response;
      }
      throw new Error(`stubFetch: unexpected url ${url}`);
    }),
  );
}

beforeEach(() => {
  mockRouterPush.mockClear();
  _resetPolicyCache();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  _resetPolicyCache();
});

describe("CreateNoteMenuItem", () => {
  it("makes the note and opens it, from the menu", async () => {
    stubFetch();

    render(
      <CreateNoteMenuItem fileId="f1" drive="d" filename="holiday.mkv" />,
    );

    fireEvent.click(await screen.findByRole("menuitem", { name: /button/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(mockRouterPush).toHaveBeenCalledWith(
        "/drive/d/addons/knowledge?edit=new-note-id",
      ),
    );
  });

  it("offers the source file's stem, not its whole name", async () => {
    // The note is a `.md` beside a file that may be an `.mkv`, so the
    // source extension has to go first — "holiday.mkv.md" is offering
    // the reader a mistake.
    stubFetch();

    render(
      <CreateNoteMenuItem fileId="f1" drive="d" filename="holiday.mkv" />,
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /button/i }));

    const field = await screen.findByDisplayValue("holiday.md");
    expect(field).toBeInTheDocument();
  });

  it("stays out of the menu on a drive with the editor switched off", async () => {
    // Same reading the section it replaced used: `usePolicy` is
    // fail-open, so this goes only on an explicit no.
    stubFetch({ editorEnabled: false });

    render(<CreateNoteMenuItem fileId="f1" drive="locked" />);

    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some(([url]) => String(url).includes("/addon-policies"))).toBe(
        true,
      );
    });
    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
  });

  it("asks the host to close only once the dialog is gone", async () => {
    // Closing the menu unmounts this component and would take the dialog
    // with it, so the close is deferred rather than fired on the click.
    stubFetch();
    const onRequestClose = vi.fn();
    const onDialogOpenChange = vi.fn();

    render(
      <CreateNoteMenuItem
        fileId="f1"
        drive="d"
        filename="holiday.mkv"
        onRequestClose={onRequestClose}
        onDialogOpenChange={onDialogOpenChange}
      />,
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /button/i }));

    expect(onDialogOpenChange).toHaveBeenCalledWith(true);
    expect(onRequestClose).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onRequestClose).toHaveBeenCalled());
    expect(onDialogOpenChange).toHaveBeenLastCalledWith(false);
  });
});
