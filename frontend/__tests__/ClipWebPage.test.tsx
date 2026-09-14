import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState, useSyncExternalStore } from "react";

import type { WebSocketEvent } from "@/types";

// `t` is kept per namespace, as the real hook memoises it.
vi.mock("next-intl", async () => {
  const messages = (await import("@/messages/en.json")).default as unknown as Record<string, unknown>;
  const lookup = (path: string): unknown =>
    path.split(".").reduce<unknown>(
      (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
      messages,
    );
  const cache = new Map<string, (key: string, values?: Record<string, unknown>) => string>();
  const useTranslations = (namespace?: string) => {
    const cacheKey = namespace ?? "";
    let t = cache.get(cacheKey);
    if (!t) {
      t = (key, values) => {
        const path = namespace === undefined ? key : `${namespace}.${key}`;
        const raw = lookup(path);
        let text = typeof raw === "string" ? raw : path;
        for (const [k, v] of Object.entries(values ?? {})) text = text.replace(`{${k}}`, String(v));
        return text;
      };
      cache.set(cacheKey, t);
    }
    return t;
  };
  return {
    useTranslations,
    useLocale: () => "en",
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

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

const mockCreateClip = vi.fn();
const mockFindClipsByUrl = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    createClip: (...a: unknown[]) => mockCreateClip(...a),
    findClipsByUrl: (...a: unknown[]) => mockFindClipsByUrl(...a),
  };
});

const ClipWebPageMenuItem = (await import("../ClipWebPageMenuItem")).default;
const ClipNotifier = (await import("../ClipNotifier")).default;
const KnowledgeDashboard = (await import("../KnowledgeDashboard")).default;
const { _resetPendingClipsForTests } = await import("../pendingClips");
const { AddonSlot } = await import("@/components/AddonSlot");
const { AddonSlotsProvider } = await import("@/components/AddonSlotsProvider");
const { AddButton } = await import("@/components/AddButton");
const { ShortcutsProvider } = await import("@/components/ShortcutsProvider");
const { ToastProvider } = await import("@/components/ToastProvider");
const { _resetPolicyCache } = await import("@/hooks/usePolicy");
const { invalidateAddonsCache } = await import("@/lib/addons");

const CLIP = "Clip web page";
const PAGE = "https://example.com/article";
const URL_FIELD = "URL to clip";

let catalogue: { addons: Record<string, unknown>; slots: Record<string, unknown> };

const KNOWLEDGE_CATALOGUE = {
  addons: { knowledge: { label: "Knowledge", icon: "notebook-pen", scope: "drive" } },
  slots: {
    "folder-actions-menu": [
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
    return json({ addons: { knowledge: { default: true, features: { editor: false } } } });
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
  _resetPendingClipsForTests();
  window.localStorage.clear();
  wsEvent = null;
  catalogue = KNOWLEDGE_CATALOGUE;
  mockFindClipsByUrl.mockResolvedValue([]);
  mockCreateClip.mockResolvedValue({ job_id: 7, file_id: "clip7", status: "fetching" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  _resetPolicyCache();
  invalidateAddonsCache();
  _resetPendingClipsForTests();
});

let setNotifierMounted: (mounted: boolean) => void = () => {};

function Harness({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(true);
  setNotifierMounted = (m) => act(() => setMounted(m));
  return (
    <ToastProvider>
      <ShortcutsProvider>
        {mounted && <ClipNotifier />}
        {children}
      </ShortcutsProvider>
    </ToastProvider>
  );
}

function renderRow(props: Record<string, unknown> = {}) {
  const onRequestClose = vi.fn();
  const onDialogOpenChange = vi.fn();
  render(
    <Harness>
      <ClipWebPageMenuItem
        drive="d"
        path=""
        onRequestClose={onRequestClose}
        onDialogOpenChange={onDialogOpenChange}
        {...props}
      />
    </Harness>,
  );
  return { onRequestClose, onDialogOpenChange };
}

function openClip() {
  fireEvent.click(screen.getByRole("menuitem", { name: CLIP }));
  return screen.getByRole("dialog", { name: CLIP });
}

function submitClip(url = PAGE) {
  fireEvent.change(screen.getByRole("textbox", { name: URL_FIELD }), { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: "Clip" }));
}

function toasts() {
  const region = screen.queryByRole("region", { name: "Notifications" });
  if (!region) return { success: [] as string[], error: [] as string[] };
  return {
    success: within(region).queryAllByRole("status").map((el) => el.textContent ?? ""),
    error: within(region).queryAllByRole("alert").map((el) => el.textContent ?? ""),
  };
}

async function sendClip(path = "web") {
  const handles = renderRow({ path });
  openClip();
  submitClip();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  return handles;
}

function settle() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("Clip web page row", () => {
  it("is drawn whatever the editor policy says", async () => {
    renderRow();
    await settle();
    expect(screen.getByRole("menuitem", { name: CLIP })).toBeInTheDocument();
  });

  function renderSlot() {
    render(
      <Harness>
        <AddonSlotsProvider>
          <div role="menu">
            <AddonSlot id="folder-actions-menu" layout="stack" props={{ drive: "d", path: "" }} />
          </div>
        </AddonSlotsProvider>
      </Harness>,
    );
  }

  it("is drawn through the slot when the catalogue carries knowledge", async () => {
    renderSlot();
    expect(await screen.findByRole("menuitem", { name: CLIP })).toBeInTheDocument();
  });

  it("is not drawn when the catalogue drops knowledge for the drive", async () => {
    catalogue = { addons: {}, slots: {} };
    renderSlot();
    await waitFor(() =>
      expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toContain("/api/addons/status?drive=d"),
    );
    await settle();
    expect(screen.queryByRole("menuitem", { name: CLIP })).not.toBeInTheDocument();
  });
});

describe("Clip web page dialog", () => {
  it("starts at path '' despite a remembered subfolder and sends one clip there", async () => {
    window.localStorage.setItem("knowledge:lastSubfolder:d", "remembered");
    const before = storageSnapshot();
    renderRow({ path: "" });
    openClip();
    expect(screen.getByLabelText("folder")).toHaveValue("");
    submitClip();

    await waitFor(() => expect(mockCreateClip).toHaveBeenCalledTimes(1));
    expect(mockCreateClip).toHaveBeenCalledWith("d", { url: PAGE, subfolder: null, title: null });
    expect(storageSnapshot()).toEqual(before);
  });

  it("closes the dialog and the menu once the clip is accepted, without navigating", async () => {
    window.localStorage.setItem("knowledge:lastSubfolder:d", "remembered");
    const before = storageSnapshot();
    const { onRequestClose, onDialogOpenChange } = renderRow({ path: "web" });
    openClip();
    expect(screen.getByLabelText("folder")).toHaveValue("web");
    fireEvent.change(screen.getByLabelText("folder"), { target: { value: "web/news" } });
    submitClip();

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockCreateClip.mock.calls).toEqual([["d", { url: PAGE, subfolder: "web/news", title: null }]]);
    expect(onDialogOpenChange.mock.calls).toEqual([[true], [false]]);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(onDialogOpenChange.mock.invocationCallOrder[1]).toBeLessThan(
      onRequestClose.mock.invocationCallOrder[0],
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(storageSnapshot()).toEqual(before);
  });

  it("closes the dialog and the menu once the clip is accepted under StrictMode", async () => {
    const onRequestClose = vi.fn();
    const onDialogOpenChange = vi.fn();
    render(
      <StrictMode>
        <Harness>
          <ClipWebPageMenuItem
            drive="d"
            path="web"
            onRequestClose={onRequestClose}
            onDialogOpenChange={onDialogOpenChange}
          />
        </Harness>
      </StrictMode>,
    );
    openClip();
    submitClip();

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog, the URL and the folder when the clip is refused, and can send again", async () => {
    mockCreateClip.mockRejectedValueOnce(new Error("URL rejected: private address"));
    window.localStorage.setItem("knowledge:lastSubfolder:d", "remembered");
    const before = storageSnapshot();
    const { onRequestClose, onDialogOpenChange } = renderRow({ path: "web" });
    openClip();
    fireEvent.change(screen.getByLabelText("folder"), { target: { value: "web/news" } });
    submitClip();

    expect(await screen.findByText("URL rejected: private address")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: CLIP })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: URL_FIELD })).toHaveValue(PAGE);
    expect(screen.getByLabelText("folder")).toHaveValue("web/news");
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(onDialogOpenChange.mock.calls).toEqual([[true]]);
    expect(storageSnapshot()).toEqual(before);

    const clip = screen.getByRole("button", { name: "Clip" });
    expect(clip).toBeEnabled();
    fireEvent.click(clip);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockCreateClip).toHaveBeenCalledTimes(2);
  });

  it("keeps an open dialog and its input when the row stops being drawn", () => {
    const onDialogOpenChange = vi.fn();
    const onRequestClose = vi.fn();
    const view = (drive: string) => (
      <Harness>
        <ClipWebPageMenuItem
          drive={drive}
          path="web"
          onRequestClose={onRequestClose}
          onDialogOpenChange={onDialogOpenChange}
        />
      </Harness>
    );
    const { rerender } = render(view("d"));
    openClip();
    fireEvent.change(screen.getByRole("textbox", { name: URL_FIELD }), { target: { value: PAGE } });

    rerender(view(""));

    expect(screen.queryByRole("menuitem", { name: CLIP })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: CLIP })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: URL_FIELD })).toHaveValue(PAGE);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onDialogOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it("returns to the menu on cancel", () => {
    const { onRequestClose, onDialogOpenChange } = renderRow();
    openClip();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockCreateClip).not.toHaveBeenCalled();
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(onDialogOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it("sends the same request whatever surface or fileIds the host adds", async () => {
    for (const extra of [{ surface: "home", fileIds: ["a"] }, {}]) {
      renderRow({ path: "web", ...extra });
      openClip();
      submitClip();
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      cleanup();
    }
    expect(mockCreateClip.mock.calls).toEqual([
      ["d", { url: PAGE, subfolder: "web", title: null }],
      ["d", { url: PAGE, subfolder: "web", title: null }],
    ]);
  });
});

describe("Clip web page when the URL was clipped before", () => {
  beforeEach(() => {
    mockFindClipsByUrl.mockResolvedValue([
      { job_id: 3, file_id: "latest", status: "ready" },
      { job_id: 2, file_id: "older", status: "ready" },
    ]);
  });

  async function reachDuplicate() {
    window.localStorage.setItem("knowledge:lastSubfolder:d", "remembered");
    const handles = renderRow({ path: "web" });
    openClip();
    fireEvent.change(screen.getByLabelText("folder"), { target: { value: "web/news" } });
    submitClip();
    await screen.findByRole("button", { name: "Open existing" });
    return handles;
  }

  it("opens the latest existing clip without clipping again", async () => {
    const before = { "knowledge:lastSubfolder:d": "remembered" };
    const { onRequestClose } = await reachDuplicate();
    fireEvent.click(screen.getByRole("button", { name: "Open existing" }));
    expect(mockCreateClip).not.toHaveBeenCalled();
    expect(mockRouterPush.mock.calls).toEqual([["/files/latest"]]);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(storageSnapshot()).toEqual(before);
  });

  it("does nothing on cancel and returns to the menu", async () => {
    const { onRequestClose } = await reachDuplicate();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockCreateClip).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clips once into the folder chosen in the dialog on Create new, then closes", async () => {
    const { onRequestClose } = await reachDuplicate();
    fireEvent.click(screen.getByRole("button", { name: "Create new" }));
    await waitFor(() => expect(onRequestClose).toHaveBeenCalledTimes(1));
    expect(mockCreateClip.mock.calls).toEqual([["d", { url: PAGE, subfolder: "web/news" }]]);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("announces a clip created from the duplicate prompt", async () => {
    mockCreateClip.mockResolvedValue({ job_id: 11, file_id: "clip11", status: "fetching" });
    await reachDuplicate();
    fireEvent.click(screen.getByRole("button", { name: "Create new" }));
    await waitFor(() => expect(mockCreateClip).toHaveBeenCalledTimes(1));
    emit("knowledge.clip.ready", { job_id: 11, file_id: "clip11", title: "Article" });
    expect(toasts()).toEqual({ success: ["Clipped: Article"], error: [] });
  });
});

describe("Clip result toasts", () => {
  it("announces its own job's ready once, with the event's title", async () => {
    await sendClip();
    emit("knowledge.clip.ready", { job_id: 7, file_id: "clip7", title: "An article" });
    expect(toasts()).toEqual({ success: ["Clipped: An article"], error: [] });

    emit("files.updated", { id: "x" });
    emit("knowledge.clip.ready", { job_id: 7, file_id: "clip7", title: "An article" });
    expect(toasts()).toEqual({ success: ["Clipped: An article"], error: [] });
  });

  it("falls back to a title-less message", async () => {
    await sendClip();
    emit("knowledge.clip.ready", { job_id: 7, file_id: "clip7", title: null });
    expect(toasts()).toEqual({ success: ["Web page clipped"], error: [] });
  });

  it("announces its own job's failure once", async () => {
    await sendClip();
    emit("knowledge.clip.failed", { job_id: 7, file_id: "clip7", error: "timeout" });
    expect(toasts()).toEqual({ success: [], error: ["A web page could not be clipped"] });
  });

  it("stays silent for jobs it did not send", async () => {
    await sendClip();
    emit("knowledge.clip.ready", { job_id: 8, file_id: "other", title: "Other" });
    emit("knowledge.clip.failed", { job_id: 9, file_id: "other2", error: "x" });
    expect(toasts()).toEqual({ success: [], error: [] });
  });

  it("announces a result that arrived while it was unmounted, and only once across remounts", async () => {
    await sendClip();
    setNotifierMounted(false);
    emit("knowledge.clip.ready", { job_id: 7, file_id: "clip7", title: "Late" });
    expect(toasts()).toEqual({ success: [], error: [] });

    setNotifierMounted(true);
    expect(toasts()).toEqual({ success: ["Clipped: Late"], error: [] });

    setNotifierMounted(false);
    setNotifierMounted(true);
    expect(toasts()).toEqual({ success: ["Clipped: Late"], error: [] });
  });

  it("stays silent for clips sent from the Knowledge page", async () => {
    render(
      <Harness>
        <KnowledgeDashboard />
      </Harness>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: URL_FIELD }), { target: { value: PAGE } });
    fireEvent.click(screen.getByRole("button", { name: "Clip" }));
    await waitFor(() => expect(mockCreateClip).toHaveBeenCalledTimes(1));

    emit("knowledge.clip.ready", { job_id: 7, file_id: "clip7", title: "From the page" });
    expect(toasts()).toEqual({ success: [], error: [] });
  });

  it("does not write Add menu clips to the Knowledge page's recent clips", async () => {
    const before = storageSnapshot();
    await sendClip();
    expect(storageSnapshot()).toEqual(before);
  });
});

describe("the Knowledge page's own clip form", () => {
  it("starts at the remembered subfolder, remembers the one used, and lists the clip", async () => {
    window.localStorage.setItem("knowledge:lastSubfolder:d", "remembered");
    render(
      <Harness>
        <KnowledgeDashboard />
      </Harness>,
    );
    expect(screen.getByLabelText("folder")).toHaveValue("remembered");
    fireEvent.change(screen.getByLabelText("folder"), { target: { value: "elsewhere" } });
    fireEvent.change(screen.getByRole("textbox", { name: URL_FIELD }), { target: { value: PAGE } });
    fireEvent.click(screen.getByRole("button", { name: "Clip" }));

    await waitFor(() => expect(mockCreateClip).toHaveBeenCalledTimes(1));
    expect(mockCreateClip).toHaveBeenCalledWith("d", { url: PAGE, subfolder: "elsewhere", title: null });
    await waitFor(() =>
      expect(window.localStorage.getItem("knowledge:lastSubfolder:d")).toBe("elsewhere"),
    );
    expect(await screen.findByTitle(PAGE)).toBeInTheDocument();
    const saved = JSON.parse(window.localStorage.getItem("knowledge:recentJobs:d") ?? "[]") as [
      string,
      { url: string; status: string; subfolder: string },
    ][];
    expect(saved.map(([id, job]) => [id, job.url, job.status, job.subfolder])).toEqual([
      ["clip7", PAGE, "fetching", "elsewhere"],
    ]);

    emit("knowledge.clip.ready", { job_id: 7, file_id: "clip7", title: "Updated" });
    expect(await screen.findByTitle("Updated")).toBeInTheDocument();
  });
});

describe("Clip web page inside the Add menu", () => {
  async function openFromAdd() {
    render(
      <Harness>
        <AddonSlotsProvider>
          <AddButton addonProps={{ drive: "d", path: "web" }} />
        </AddonSlotsProvider>
      </Harness>,
    );
    const trigger = screen.getByRole("button", { name: /Add/ });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: CLIP }));
    expect(screen.getByRole("dialog", { name: CLIP })).toBeInTheDocument();
    return trigger;
  }

  it("keeps the dialog and what was typed when it is pressed and typed into", async () => {
    await openFromAdd();
    const input = screen.getByRole("textbox", { name: URL_FIELD });
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: PAGE } });
    fireEvent.click(input);
    fireEvent.pointerDown(screen.getByLabelText("folder"));
    fireEvent.change(screen.getByLabelText("folder"), { target: { value: "web/sub" } });

    expect(screen.getByRole("dialog", { name: CLIP })).toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: URL_FIELD })).toHaveValue(PAGE);
    expect(screen.getByLabelText("folder")).toHaveValue("web/sub");
  });

  it("keeps the dialog through a press after a refused clip", async () => {
    mockCreateClip.mockRejectedValueOnce(new Error("URL rejected"));
    await openFromAdd();
    submitClip();
    await screen.findByText("URL rejected");
    fireEvent.pointerDown(screen.getByRole("textbox", { name: URL_FIELD }));
    expect(screen.getByRole("dialog", { name: CLIP })).toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes only the dialog on the first Escape and the menu on the second", async () => {
    const trigger = await openFromAdd();
    fireEvent.keyDown(screen.getByRole("textbox", { name: URL_FIELD }), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes only the duplicate prompt on the first Escape", async () => {
    mockFindClipsByUrl.mockResolvedValue([{ job_id: 3, file_id: "latest", status: "ready" }]);
    await openFromAdd();
    submitClip();
    await screen.findByRole("button", { name: "Open existing" });

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});

describe("Clip web page when the user leaves before the clip is accepted", () => {
  function holdCreate() {
    let release!: (job: unknown) => void;
    mockCreateClip.mockReturnValueOnce(
      new Promise((r) => {
        release = r;
      }),
    );
    return (job: unknown) =>
      act(async () => {
        release(job);
      });
  }

  it("does not close a dialog reopened since, nor the menu, and still announces the clip", async () => {
    const accept = holdCreate();
    const { onRequestClose, onDialogOpenChange } = renderRow({ path: "web" });
    openClip();
    submitClip();
    await waitFor(() => expect(mockCreateClip).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    openClip();
    fireEvent.change(screen.getByRole("textbox", { name: URL_FIELD }), {
      target: { value: "https://example.com/second" },
    });

    await accept({ job_id: 7, file_id: "clip7", status: "fetching" });

    expect(screen.getByRole("dialog", { name: CLIP })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: URL_FIELD })).toHaveValue("https://example.com/second");
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(onDialogOpenChange.mock.calls).toEqual([[true], [false], [true]]);

    emit("knowledge.clip.ready", { job_id: 7, file_id: "clip7", title: "First" });
    expect(toasts()).toEqual({ success: ["Clipped: First"], error: [] });
  });

  it("does not close the menu when Create new is accepted after Escape", async () => {
    mockFindClipsByUrl.mockResolvedValue([{ job_id: 3, file_id: "latest", status: "ready" }]);
    const accept = holdCreate();
    const { onRequestClose, onDialogOpenChange } = renderRow({ path: "web" });
    openClip();
    submitClip();
    fireEvent.click(await screen.findByRole("button", { name: "Create new" }));
    await waitFor(() => expect(mockCreateClip).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await accept({ job_id: 12, file_id: "clip12", status: "fetching" });

    expect(onRequestClose).not.toHaveBeenCalled();
    expect(onDialogOpenChange.mock.calls).toEqual([[true], [false]]);
    emit("knowledge.clip.failed", { job_id: 12, file_id: "clip12", error: "x" });
    expect(toasts()).toEqual({ success: [], error: ["A web page could not be clipped"] });
  });
});

describe("Clip result that arrives before the clip is accepted", () => {
  it("announces a ready that came first once the clip is accepted", async () => {
    let release!: (job: unknown) => void;
    mockCreateClip.mockReturnValueOnce(
      new Promise((r) => {
        release = r;
      }),
    );
    renderRow({ path: "web" });
    openClip();
    submitClip();
    await waitFor(() => expect(mockCreateClip).toHaveBeenCalledTimes(1));

    emit("knowledge.clip.ready", { job_id: 7, file_id: "clip7", title: "Early" });
    expect(toasts()).toEqual({ success: [], error: [] });

    await act(async () => {
      release({ job_id: 7, file_id: "clip7", status: "fetching" });
    });
    await waitFor(() => expect(toasts()).toEqual({ success: ["Clipped: Early"], error: [] }));
  });

  it("is announced once when the clip is accepted, and not again on remount", async () => {
    let release!: (job: unknown) => void;
    mockCreateClip.mockReturnValueOnce(
      new Promise((r) => {
        release = r;
      }),
    );
    renderRow({ path: "web" });
    openClip();
    submitClip();
    await waitFor(() => expect(mockCreateClip).toHaveBeenCalledTimes(1));

    emit("knowledge.clip.failed", { job_id: 7, file_id: "clip7", error: "blocked" });
    expect(toasts()).toEqual({ success: [], error: [] });

    await act(async () => {
      release({ job_id: 7, file_id: "clip7", status: "fetching" });
    });
    await waitFor(() =>
      expect(toasts()).toEqual({ success: [], error: ["A web page could not be clipped"] }),
    );

    setNotifierMounted(false);
    setNotifierMounted(true);
    expect(toasts()).toEqual({ success: [], error: ["A web page could not be clipped"] });
  });
});
