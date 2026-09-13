import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";

import type { WebSocketEvent } from "@/types";

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

vi.mock("../ConnectionsGraph", () => ({ default: () => null }));

let wsEvent: WebSocketEvent | null = null;
const wsListeners = new Set<() => void>();
function emit(event: string, data: Record<string, unknown>) {
  act(() => {
    wsEvent = { event, data } as WebSocketEvent;
    wsListeners.forEach((l) => l());
  });
}
vi.mock("@/hooks/useWebSocket", () => ({
  useWebSocket: (filter?: string) => {
    const current = useSyncExternalStore(
      (l) => {
        wsListeners.add(l);
        return () => wsListeners.delete(l);
      },
      () => wsEvent,
    );
    if (!current || (filter && current.event !== filter)) return null;
    return current;
  },
}));

const mockCreateTextFile = vi.fn();
const mockCreateClip = vi.fn();
const mockFindClipsByUrl = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    createTextFile: (...a: unknown[]) => mockCreateTextFile(...a),
    createClip: (...a: unknown[]) => mockCreateClip(...a),
    findClipsByUrl: (...a: unknown[]) => mockFindClipsByUrl(...a),
  };
});

const NewNoteMenuItem = (await import("../NewNoteMenuItem")).default;
const ClipWebPageMenuItem = (await import("../ClipWebPageMenuItem")).default;
const KnowledgeDashboard = (await import("../KnowledgeDashboard")).default;
const { AddonSlot } = await import("@/components/AddonSlot");
const { AddonSlotsProvider } = await import("@/components/AddonSlotsProvider");
const { ShortcutsProvider } = await import("@/components/ShortcutsProvider");
const { AddButton } = await import("@/components/AddButton");
const { _resetPolicyCache } = await import("@/hooks/usePolicy");
const { invalidateAddonsCache } = await import("@/lib/addons");

const NEW_NOTE = "New note";
const CLIP = "Clip web page";
const PAGE = "https://example.com/article";

type PolicyAnswer = "enabled" | "disabled" | "error";
let editorPolicy: PolicyAnswer;
let catalogue: { addons: Record<string, unknown>; slots: Record<string, unknown> };

const KNOWLEDGE_CATALOGUE = {
  addons: { knowledge: { label: "Knowledge", icon: "notebook-pen", scope: "drive" } },
  slots: {
    "folder-actions-menu": [
      { id: "knowledge-new-note", label: "New note", priority: 30, addonName: "knowledge" },
      { id: "knowledge-clip-web-page", label: "Clip web page", priority: 40, addonName: "knowledge" },
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
    if (editorPolicy === "error") return json({}, 500);
    return json({
      addons: { knowledge: { default: true, features: { editor: editorPolicy === "enabled" } } },
    });
  }
  if (url === "/api/addons/status?drive=d") return json(catalogue);
  return json({}, 404);
});

function storageSnapshot(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)!;
    out[key] = window.localStorage.getItem(key);
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchSpy);
  _resetPolicyCache();
  invalidateAddonsCache();
  window.localStorage.clear();
  wsEvent = null;
  editorPolicy = "enabled";
  catalogue = KNOWLEDGE_CATALOGUE;
  mockCreateTextFile.mockResolvedValue({ id: "note1" });
  mockFindClipsByUrl.mockResolvedValue([]);
  mockCreateClip.mockResolvedValue({ job_id: 7, file_id: "clip7", status: "fetching" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  _resetPolicyCache();
  invalidateAddonsCache();
});

function renderRow(
  Row: typeof NewNoteMenuItem,
  props: Record<string, unknown> = {},
) {
  const onRequestClose = vi.fn();
  const onDialogOpenChange = vi.fn();
  render(
    <ShortcutsProvider>
      <Row
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

function settle() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("Add menu rows and policy", () => {
  it("draws New note while the editor policy is loading", () => {
    renderRow(NewNoteMenuItem);
    expect(screen.getByRole("menuitem", { name: NEW_NOTE })).toBeInTheDocument();
  });

  it("removes New note once the editor policy is off", async () => {
    editorPolicy = "disabled";
    renderRow(NewNoteMenuItem);
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: NEW_NOTE })).not.toBeInTheDocument(),
    );
  });

  it.each<PolicyAnswer>(["enabled", "error"])("keeps New note after the policy answers %s", async (answer) => {
    editorPolicy = answer;
    renderRow(NewNoteMenuItem);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await settle();
    expect(screen.getByRole("menuitem", { name: NEW_NOTE })).toBeInTheDocument();
  });

  it("does not gate Clip web page on the editor policy", async () => {
    editorPolicy = "disabled";
    renderRow(ClipWebPageMenuItem);
    await settle();
    expect(screen.getByRole("menuitem", { name: CLIP })).toBeInTheDocument();
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

  it("draws both rows through the slot when the catalogue carries knowledge", async () => {
    renderSlot();
    expect(await screen.findByRole("menuitem", { name: NEW_NOTE })).toBeInTheDocument();
    expect(await screen.findByRole("menuitem", { name: CLIP })).toBeInTheDocument();
  });

  it("draws neither row when the catalogue drops knowledge for the drive", async () => {
    catalogue = { addons: {}, slots: {} };
    renderSlot();
    await waitFor(() =>
      expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toContain("/api/addons/status?drive=d"),
    );
    await settle();
    expect(screen.queryByRole("menuitem", { name: NEW_NOTE })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: CLIP })).not.toBeInTheDocument();
  });
});

describe("New note from the Add menu", () => {
  function openNewNote() {
    fireEvent.click(screen.getByRole("menuitem", { name: NEW_NOTE }));
    return screen.getByRole("dialog", { name: NEW_NOTE });
  }

  it("creates nothing when cancelled", () => {
    const { onRequestClose, onDialogOpenChange } = renderRow(NewNoteMenuItem);
    openNewNote();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockCreateTextFile).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(onDialogOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it("creates nothing when Escape closes it", () => {
    renderRow(NewNoteMenuItem);
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
    const { onRequestClose } = renderRow(NewNoteMenuItem, { path });
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

  it("keeps the dialog and does not navigate when creation fails", async () => {
    mockCreateTextFile.mockRejectedValue(new Error("already exists"));
    const { onRequestClose } = renderRow(NewNoteMenuItem, { path: "notes" });
    openNewNote();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("already exists")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: NEW_NOTE })).toBeInTheDocument();
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("sends the same request whatever surface or fileIds the host adds", async () => {
    for (const extra of [{ surface: "home", fileIds: ["a"] }, {}]) {
      renderRow(NewNoteMenuItem, { path: "notes", ...extra });
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

describe("Clip web page from the Add menu", () => {
  function openClip() {
    fireEvent.click(screen.getByRole("menuitem", { name: CLIP }));
    return screen.getByRole("dialog", { name: CLIP });
  }

  function submitClip(url = PAGE) {
    fireEvent.change(screen.getByRole("textbox", { name: "URL to clip" }), { target: { value: url } });
    fireEvent.click(screen.getByRole("button", { name: "Clip" }));
  }

  it("starts at path '' despite a remembered subfolder, and writes nothing to storage", async () => {
    window.localStorage.setItem("knowledge:lastSubfolder:d", "remembered");
    const before = storageSnapshot();
    expect(before).not.toEqual({});
    renderRow(ClipWebPageMenuItem, { path: "" });
    openClip();
    expect(screen.getByLabelText("folder")).toHaveValue("");
    submitClip();

    await screen.findByText("Clipping the page...");
    expect(mockCreateClip).toHaveBeenCalledTimes(1);
    expect(mockCreateClip).toHaveBeenCalledWith("d", { url: PAGE, subfolder: null, title: null });
    emit("knowledge.clip.ready", { job_id: 7, file_id: "clip7" });
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(1));
    expect(storageSnapshot()).toEqual(before);
  });

  it("clips into the Add menu's folder and waits, saying that closing does not stop it", async () => {
    const { onRequestClose } = renderRow(ClipWebPageMenuItem, { path: "web" });
    openClip();
    expect(screen.getByLabelText("folder")).toHaveValue("web");
    submitClip();

    expect(await screen.findByText("Clipping the page...")).toBeInTheDocument();
    expect(
      screen.getByText("Closing keeps the clip running, but its result will not be shown here."),
    ).toBeInTheDocument();
    expect(mockFindClipsByUrl).toHaveBeenCalledWith("d", PAGE);
    expect(mockCreateClip).toHaveBeenCalledWith("d", { url: PAGE, subfolder: "web", title: null });
    expect(screen.getByRole("dialog", { name: CLIP })).toBeInTheDocument();
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("opens the clipped file once when its own job is ready, and ignores other jobs", async () => {
    const { onRequestClose } = renderRow(ClipWebPageMenuItem, { path: "web" });
    openClip();
    submitClip();
    await screen.findByText("Clipping the page...");

    emit("knowledge.clip.ready", { job_id: 8, file_id: "other" });
    emit("knowledge.clip.failed", { job_id: 8, file_id: "other", error: "boom" });
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(screen.getByText("Clipping the page...")).toBeInTheDocument();

    emit("knowledge.clip.ready", { job_id: 7, file_id: "clip7" });
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(1));
    expect(mockRouterPush).toHaveBeenCalledWith("/files/clip7");
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the failure of its own job and keeps the URL and folder", async () => {
    const { onRequestClose } = renderRow(ClipWebPageMenuItem, { path: "web" });
    openClip();
    fireEvent.change(screen.getByLabelText("folder"), { target: { value: "web/news" } });
    submitClip();
    await screen.findByText("Clipping the page...");

    emit("knowledge.clip.failed", { job_id: 7, file_id: "clip7", error: "fetch timed out" });

    expect(await screen.findByText("fetch timed out")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: CLIP })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "URL to clip" })).toHaveValue(PAGE);
    expect(screen.getByLabelText("folder")).toHaveValue("web/news");
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(mockCreateClip).toHaveBeenCalledTimes(1);
  });

  it("can be closed while fetching without an error or a second request", async () => {
    const { onRequestClose, onDialogOpenChange } = renderRow(ClipWebPageMenuItem, { path: "web" });
    openClip();
    submitClip();
    await screen.findByText("Clipping the page...");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockCreateClip).toHaveBeenCalledTimes(1);
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(onDialogOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  describe("when the URL was clipped before", () => {
    beforeEach(() => {
      mockFindClipsByUrl.mockResolvedValue([
        { job_id: 3, file_id: "latest", status: "ready" },
        { job_id: 2, file_id: "older", status: "ready" },
      ]);
    });

    async function reachDuplicate() {
      const handles = renderRow(ClipWebPageMenuItem, { path: "web" });
      openClip();
      submitClip();
      await screen.findByRole("button", { name: "Open existing" });
      return handles;
    }

    it("opens the latest existing clip without clipping again", async () => {
      const { onRequestClose } = await reachDuplicate();
      fireEvent.click(screen.getByRole("button", { name: "Open existing" }));
      expect(mockCreateClip).not.toHaveBeenCalled();
      expect(mockRouterPush.mock.calls).toEqual([["/files/latest"]]);
      expect(onRequestClose).toHaveBeenCalledTimes(1);
    });

    it("does nothing on cancel", async () => {
      const { onRequestClose } = await reachDuplicate();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(mockCreateClip).not.toHaveBeenCalled();
      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(onRequestClose).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("clips once into the chosen folder on Create new, then waits", async () => {
      await reachDuplicate();
      fireEvent.click(screen.getByRole("button", { name: "Create new" }));
      expect(await screen.findByText("Clipping the page...")).toBeInTheDocument();
      expect(mockCreateClip.mock.calls).toEqual([["d", { url: PAGE, subfolder: "web" }]]);
    });
  });
});

describe("the Knowledge page's own clip form", () => {
  it("still starts at the remembered subfolder and remembers the one used", async () => {
    window.localStorage.setItem("knowledge:lastSubfolder:d", "remembered");
    render(<KnowledgeDashboard />);
    expect(screen.getByLabelText("folder")).toHaveValue("remembered");
    fireEvent.change(screen.getByLabelText("folder"), { target: { value: "elsewhere" } });
    fireEvent.change(screen.getByRole("textbox", { name: "URL to clip" }), { target: { value: PAGE } });
    fireEvent.click(screen.getByRole("button", { name: "Clip" }));

    await waitFor(() => expect(mockCreateClip).toHaveBeenCalledTimes(1));
    expect(mockCreateClip).toHaveBeenCalledWith("d", {
      url: PAGE,
      subfolder: "elsewhere",
      title: null,
    });
    await waitFor(() =>
      expect(window.localStorage.getItem("knowledge:lastSubfolder:d")).toBe("elsewhere"),
    );
  });
});

describe.each([
  { row: NEW_NOTE, field: "Filename" },
  { row: CLIP, field: "URL to clip" },
])("$row inside the Add menu", ({ row, field }) => {
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
    fireEvent.click(await screen.findByRole("menuitem", { name: row }));
    expect(screen.getByRole("dialog", { name: row })).toBeInTheDocument();
    return trigger;
  }

  it("keeps the dialog and what was typed when it is pressed and typed into", async () => {
    await openFromAdd();
    const input = screen.getByRole("textbox", { name: field });
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: "typed.md" } });
    fireEvent.click(input);
    fireEvent.pointerDown(screen.getByLabelText("folder"));
    fireEvent.change(screen.getByLabelText("folder"), { target: { value: "notes/sub" } });

    expect(screen.getByRole("dialog", { name: row })).toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: field })).toHaveValue("typed.md");
    expect(screen.getByLabelText("folder")).toHaveValue("notes/sub");
  });

  it("closes only the dialog on the first Escape and the menu on the second", async () => {
    const trigger = await openFromAdd();
    fireEvent.keyDown(screen.getByRole("textbox", { name: field }), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
