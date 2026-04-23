import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string) =>
      key,
}));

const Sidebar = (await import("../Sidebar")).default;
const vault = {
  id: 1,
  label: "Vault",
  drive: "v",
  path: "",
  is_active: true,
  created_at: "",
};

type FolderRow = {
  name: string;
  path: string;
  file_count: number;
  thumbnail_file_id: null;
};
type FileRow = {
  id: string;
  filename: string;
  title: string;
  drive: string;
  folder_path: string;
  file_type: string;
  mime_type: string;
  thumbnail_url: string;
  file_size: number;
  created_at: string;
  updated_at: string;
};

function stubTree(tree: Record<string, { folders: FolderRow[]; files: FileRow[] }>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url, "http://test");
    const path = u.searchParams.get("path") ?? "";
    const entry = tree[path] ?? { folders: [], files: [] };
    if (u.pathname.endsWith("/folders")) {
      return {
        ok: true,
        status: 200,
        json: async () => entry.folders,
      } as Response;
    }
    if (u.pathname.endsWith("/files")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: entry.files,
          meta: { total: entry.files.length, page: 1, limit: 100 },
        }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => null } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

const noop = () => undefined;

function makeFile(id: string, filename: string, folder = ""): FileRow {
  return {
    id,
    filename,
    title: "",
    drive: "v",
    folder_path: folder,
    file_type: "document",
    mime_type: "text/markdown",
    thumbnail_url: "",
    file_size: 0,
    created_at: "",
    updated_at: "",
  };
}

function installFakeLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  });
  return store;
}

describe("Sidebar tree", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.unstubAllGlobals();
    storage = installFakeLocalStorage();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads and shows root files + folders", async () => {
    stubTree({
      "": {
        folders: [{ name: "sub", path: "sub", file_count: 0, thumbnail_file_id: null }],
        files: [makeFile("f1", "note-a.md")],
      },
    });
    render(
      <Sidebar
        drive="v"
        vaults={[vault]}
        active={vault}
        selectedFileId={null}
        onSwitchVault={noop}
        onAddVault={noop}
        onSelectFile={noop}
        onOpenClip={noop}
        onOpenClipHelp={noop}
      />,
    );
    expect(await screen.findByText("sub")).toBeTruthy();
    expect(screen.getByText("note-a")).toBeTruthy();
  });

  it("loads children lazily on folder expand and collapses on second click", async () => {
    const { calls } = stubTree({
      "": {
        folders: [{ name: "sub", path: "sub", file_count: 1, thumbnail_file_id: null }],
        files: [],
      },
      sub: {
        folders: [],
        files: [makeFile("f2", "child.md", "sub")],
      },
    });
    render(
      <Sidebar
        drive="v"
        vaults={[vault]}
        active={vault}
        selectedFileId={null}
        onSwitchVault={noop}
        onAddVault={noop}
        onSelectFile={noop}
        onOpenClip={noop}
        onOpenClipHelp={noop}
      />,
    );
    // Wait for folder to appear, then find the chevron toggle button
    await screen.findByText("sub");
    const chevronBtn = screen.getByLabelText("展開する");
    // Before expand: child not visible, and sub path not fetched.
    expect(screen.queryByText("child")).toBeNull();
    expect(calls.some((u) => u.includes("path=sub"))).toBe(false);

    fireEvent.click(chevronBtn);

    expect(await screen.findByText("child")).toBeTruthy();
    expect(calls.some((u) => u.includes("path=sub"))).toBe(true);

    // Collapse: child hidden again.
    const collapseBtn = screen.getByLabelText("折りたたむ");
    fireEvent.click(collapseBtn);
    await waitFor(() => {
      expect(screen.queryByText("child")).toBeNull();
    });
  });

  it("restores expanded folders from localStorage and prefetches their contents", async () => {
    storage.set("knowledge:tree:1:expanded", JSON.stringify(["sub"]));
    stubTree({
      "": {
        folders: [{ name: "sub", path: "sub", file_count: 1, thumbnail_file_id: null }],
        files: [],
      },
      sub: {
        folders: [],
        files: [makeFile("f3", "persisted-child.md", "sub")],
      },
    });
    render(
      <Sidebar
        drive="v"
        vaults={[vault]}
        active={vault}
        selectedFileId={null}
        onSwitchVault={noop}
        onAddVault={noop}
        onSelectFile={noop}
        onOpenClip={noop}
        onOpenClipHelp={noop}
      />,
    );
    // Child renders without any user interaction — proving prefetch on restore.
    expect(await screen.findByText("persisted-child")).toBeTruthy();
  });
});
