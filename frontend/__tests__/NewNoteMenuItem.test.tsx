import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/components/CurrentDriveProvider", () => ({
  useCurrentDrive: () => "d",
}));

vi.mock("@/components/FolderPicker", () => ({
  FolderPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="folder" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const mockCreateTextFile = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    createTextFile: (...a: unknown[]) => mockCreateTextFile(...a),
  };
});

const NewNoteMenuItem = (await import("../NewNoteMenuItem")).default;
const { AddonSlot } = await import("@/components/AddonSlot");
const { AddonSlotsProvider } = await import("@/components/AddonSlotsProvider");
const { AddButton } = await import("@/components/AddButton");
const { ShortcutsProvider } = await import("@/components/ShortcutsProvider");
const { _resetPolicyCache } = await import("@/hooks/usePolicy");
const { invalidateAddonsCache } = await import("@/lib/addons");

const NEW_NOTE = "New note";

type PolicyAnswer = "enabled" | "disabled" | "error";
let editorPolicy: PolicyAnswer;
let policyGate: Promise<void> | null = null;
let catalogue: { addons: Record<string, unknown>; slots: Record<string, unknown> };

const KNOWLEDGE_CATALOGUE = {
  addons: { knowledge: { label: "Knowledge", icon: "notebook-pen", scope: "drive" } },
  slots: {
    "folder-actions-menu": [
      { id: "knowledge-new-note", label: "New note", priority: 30, addonName: "knowledge" },
    ],
  },
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === "/api/drives/d/addon-policies") {
    if (policyGate) await policyGate;
    if (editorPolicy === "error") return json({}, 500);
    return json({
      addons: { knowledge: { default: true, features: { editor: editorPolicy === "enabled" } } },
    });
  }
  if (url === "/api/addons/status?drive=d") return json(catalogue);
  return json({}, 404);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchSpy);
  _resetPolicyCache();
  invalidateAddonsCache();
  window.localStorage.clear();
  editorPolicy = "enabled";
  policyGate = null;
  catalogue = KNOWLEDGE_CATALOGUE;
  mockCreateTextFile.mockResolvedValue({ id: "note1" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  _resetPolicyCache();
  invalidateAddonsCache();
});

function renderRow(props: Record<string, unknown> = {}) {
  const onRequestClose = vi.fn();
  const onDialogOpenChange = vi.fn();
  render(
    <ShortcutsProvider>
      <NewNoteMenuItem
        drive="d"
        path=""
        onRequestClose={onRequestClose}
        onDialogOpenChange={onDialogOpenChange}
        {...props}
      />
    </ShortcutsProvider>,
  );
  return { onRequestClose, onDialogOpenChange };
}

function openNewNote() {
  fireEvent.click(screen.getByRole("menuitem", { name: NEW_NOTE }));
  return screen.getByRole("dialog", { name: NEW_NOTE });
}

function settle() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("New note row and policy", () => {
  it("is drawn while the editor policy is loading", () => {
    renderRow();
    expect(screen.getByRole("menuitem", { name: NEW_NOTE })).toBeInTheDocument();
  });

  it("disappears once the editor policy is off", async () => {
    editorPolicy = "disabled";
    renderRow();
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: NEW_NOTE })).not.toBeInTheDocument(),
    );
  });

  it.each<PolicyAnswer>(["enabled", "error"])("stays after the policy answers %s", async (answer) => {
    editorPolicy = answer;
    renderRow();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await settle();
    expect(screen.getByRole("menuitem", { name: NEW_NOTE })).toBeInTheDocument();
  });

  function renderSlot() {
    render(
      <ShortcutsProvider>
        <AddonSlotsProvider>
          <div role="menu">
            <AddonSlot id="folder-actions-menu" layout="stack" props={{ drive: "d", path: "" }} />
          </div>
        </AddonSlotsProvider>
      </ShortcutsProvider>,
    );
  }

  it("is drawn through the slot when the catalogue carries knowledge", async () => {
    renderSlot();
    expect(await screen.findByRole("menuitem", { name: NEW_NOTE })).toBeInTheDocument();
  });

  it("is not drawn when the catalogue drops knowledge for the drive", async () => {
    catalogue = { addons: {}, slots: {} };
    renderSlot();
    await waitFor(() =>
      expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toContain("/api/addons/status?drive=d"),
    );
    await settle();
    expect(screen.queryByRole("menuitem", { name: NEW_NOTE })).not.toBeInTheDocument();
  });
});

describe("New note dialog", () => {
  it("creates nothing when cancelled", () => {
    const { onRequestClose, onDialogOpenChange } = renderRow();
    openNewNote();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockCreateTextFile).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(onDialogOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it("creates nothing when Escape closes it", () => {
    renderRow();
    openNewNote();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockCreateTextFile).not.toHaveBeenCalled();
  });

  it.each([
    ["", "untitled.md"],
    ["notes/2026", "notes/2026/untitled.md"],
  ])("starts at path %j and creates once, then opens the editor", async (path, created) => {
    window.localStorage.setItem("knowledge:lastSubfolder:d", "remembered");
    const { onRequestClose } = renderRow({ path });
    openNewNote();
    expect(screen.getByLabelText("folder")).toHaveValue(path);
    const filename = screen.getByRole("textbox", { name: "Filename" }) as HTMLInputElement;
    expect(filename.value).toMatch(/^untitled-\d{8}-\d{6}\.md$/);
    fireEvent.change(filename, { target: { value: "untitled.md" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(1));
    expect(mockCreateTextFile).toHaveBeenCalledTimes(1);
    expect(mockCreateTextFile).toHaveBeenCalledWith("d", { path: created });
    expect(mockRouterPush).toHaveBeenCalledWith("/files/note1?edit=1");
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("creates once in the folder chosen in the dialog, not the Add menu's", async () => {
    renderRow({ path: "notes" });
    openNewNote();
    fireEvent.change(screen.getByLabelText("folder"), { target: { value: "journal/2026" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Filename" }), {
      target: { value: "n.md" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(1));
    expect(mockCreateTextFile.mock.calls).toEqual([["d", { path: "journal/2026/n.md" }]]);
  });

  it("keeps the dialog and does not navigate when creation fails", async () => {
    mockCreateTextFile.mockRejectedValue(new Error("already exists"));
    const { onRequestClose } = renderRow({ path: "notes" });
    openNewNote();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("already exists")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: NEW_NOTE })).toBeInTheDocument();
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("can create the note after a failed attempt", async () => {
    mockCreateTextFile.mockRejectedValueOnce(new Error("already exists"));
    renderRow({ path: "notes" });
    openNewNote();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("already exists");

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(1));
    expect(mockCreateTextFile).toHaveBeenCalledTimes(2);
  });

  it("creates one note however many times Enter is pressed while it is pending", async () => {
    let release!: (v: unknown) => void;
    mockCreateTextFile.mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    renderRow({ path: "notes" });
    openNewNote();
    const field = screen.getByRole("textbox", { name: "Filename" });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "Enter" });
    await act(async () => {
      release({ id: "note1" });
    });
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(1));
    expect(mockCreateTextFile).toHaveBeenCalledTimes(1);
  });

  it("sends the same request whatever surface or fileIds the host adds", async () => {
    for (const extra of [{ surface: "home", fileIds: ["a"] }, {}]) {
      renderRow({ path: "notes", ...extra });
      openNewNote();
      fireEvent.change(screen.getByRole("textbox", { name: "Filename" }), {
        target: { value: "n.md" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
      cleanup();
    }
    expect(mockCreateTextFile.mock.calls).toEqual([
      ["d", { path: "notes/n.md" }],
      ["d", { path: "notes/n.md" }],
    ]);
  });
});

describe("New note when the editor policy settles after its dialog opened", () => {
  it("keeps the dialog and its input, and still reports its close", async () => {
    let release!: () => void;
    policyGate = new Promise<void>((r) => {
      release = r;
    });
    editorPolicy = "disabled";
    const { onDialogOpenChange } = renderRow({ path: "notes" });
    openNewNote();
    fireEvent.change(screen.getByRole("textbox", { name: "Filename" }), {
      target: { value: "kept.md" },
    });

    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: NEW_NOTE })).not.toBeInTheDocument(),
    );

    expect(screen.getByRole("dialog", { name: NEW_NOTE })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filename" })).toHaveValue("kept.md");
    expect(screen.getByLabelText("folder")).toHaveValue("notes");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDialogOpenChange.mock.calls).toEqual([[true], [false]]);
  });
});

describe("New note created after its row was hidden", () => {
  it("closes the menu and reports the dialog closed", async () => {
    let release!: () => void;
    policyGate = new Promise<void>((r) => {
      release = r;
    });
    editorPolicy = "disabled";
    const { onRequestClose, onDialogOpenChange } = renderRow({ path: "notes" });
    openNewNote();
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: NEW_NOTE })).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(1));
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(onDialogOpenChange.mock.calls).toEqual([[true], [false]]);
  });
});

describe("New note inside the Add menu", () => {
  async function openFromAdd() {
    render(
      <ShortcutsProvider>
        <AddonSlotsProvider>
          <AddButton addonProps={{ drive: "d", path: "notes" }} />
        </AddonSlotsProvider>
      </ShortcutsProvider>,
    );
    const trigger = screen.getByRole("button", { name: /Add/ });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: NEW_NOTE }));
    expect(screen.getByRole("dialog", { name: NEW_NOTE })).toBeInTheDocument();
    return trigger;
  }

  it("keeps the dialog and what was typed when it is pressed and typed into", async () => {
    await openFromAdd();
    const input = screen.getByRole("textbox", { name: "Filename" });
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: "typed.md" } });
    fireEvent.click(input);
    fireEvent.pointerDown(screen.getByLabelText("folder"));
    fireEvent.change(screen.getByLabelText("folder"), { target: { value: "notes/sub" } });

    expect(screen.getByRole("dialog", { name: NEW_NOTE })).toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filename" })).toHaveValue("typed.md");
    expect(screen.getByLabelText("folder")).toHaveValue("notes/sub");
  });

  it("keeps the dialog through a press after a failed create, and creates on retry", async () => {
    mockCreateTextFile.mockRejectedValueOnce(new Error("already exists"));
    await openFromAdd();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("already exists");

    const input = screen.getByRole("textbox", { name: "Filename" });
    fireEvent.pointerDown(input);
    fireEvent.click(input);
    expect(screen.getByRole("dialog", { name: NEW_NOTE })).toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(1));
    expect(mockCreateTextFile).toHaveBeenCalledTimes(2);
  });

  it("closes only the dialog on the first Escape after a failed create", async () => {
    mockCreateTextFile.mockRejectedValueOnce(new Error("already exists"));
    await openFromAdd();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("already exists");

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Filename" }), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes only the dialog on the first Escape and the menu on the second", async () => {
    const trigger = await openFromAdd();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Filename" }), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
