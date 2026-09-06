import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openPanel() {
  render(
    <VersionHistoryPanel fileId="f1" refreshKey={0} onRestore={vi.fn(async () => true)} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "knowledge.editor.versions.toggleOpen" }),
  );
  await screen.findByTestId("version-row-2");
}

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

    expect(await screen.findByText(/Aki/)).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    expect(
      screen.getByText("knowledge.editor.versions.explicit · Aki"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("knowledge.editor.versions.auto"),
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
    await screen.findByText(/Aki/);
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

describe("VersionHistoryPanel diff states", () => {
  it("shows three skeleton lines while the diff loads, not a pane-wide spinner", async () => {
    const pending = deferred<never>();
    apiMocks.getFileVersionDiff.mockReturnValue(pending.promise);

    await openPanel();

    const skeleton = await screen.findByTestId("version-diff-skeleton");
    expect(skeleton.children).toHaveLength(3);
    // The body arrived on its own request, so it is not held back by the
    // diff still being in flight.
    await waitFor(() =>
      expect(screen.getByTestId("version-preview")).toHaveTextContent(
        "# selected version",
      ),
    );
    expect(screen.queryByTestId("version-diff")).not.toBeInTheDocument();
  });

  it("says the version is unchanged rather than drawing an empty diff", async () => {
    apiMocks.getFileVersionDiff.mockResolvedValue({
      id: 2,
      lines: [],
      lines_added: 0,
      lines_removed: 0,
    });

    await openPanel();

    expect(await screen.findByTestId("version-diff-unchanged")).toHaveTextContent(
      "knowledge.editor.versions.diffUnchanged",
    );
    // An empty `<pre>` said this before, and said the same thing when the
    // request had failed.
    expect(screen.queryByTestId("version-diff")).not.toBeInTheDocument();
  });

  it("keeps the body on screen when only the diff fails", async () => {
    apiMocks.getFileVersionDiff.mockRejectedValue(new Error("diff exploded"));

    await openPanel();

    expect(await screen.findByTestId("version-diff-error")).toHaveTextContent(
      "knowledge.editor.versions.diffFailed",
    );
    expect(screen.getByTestId("version-preview")).toHaveTextContent(
      "# selected version",
    );
    // The shared band at the top of the panel is for the list and the
    // body. A diff failure there took the body down with it.
    expect(screen.queryByText("diff exploded")).not.toBeInTheDocument();
  });

  it("retries the diff without re-fetching the body", async () => {
    apiMocks.getFileVersionDiff.mockRejectedValueOnce(new Error("diff exploded"));

    await openPanel();
    await screen.findByTestId("version-diff-error");
    expect(apiMocks.getFileVersion).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "knowledge.editor.versions.diffRetry" }),
    );

    await waitFor(() => expect(screen.getByTestId("version-diff")).toHaveTextContent("+new"));
    expect(apiMocks.getFileVersionDiff).toHaveBeenCalledTimes(2);
    expect(apiMocks.getFileVersion).toHaveBeenCalledTimes(1);
  });
});

describe("VersionHistoryPanel body preview", () => {
  it("keeps the full body collapsed until it is asked for", async () => {
    await openPanel();
    await screen.findByTestId("version-preview");

    expect(screen.getByTestId("version-preview-disclosure")).not.toHaveAttribute(
      "open",
    );
  });

  it("swaps the disclosure glyph instead of turning it", async () => {
    // A `rotate` utility has no effect on these icons — measured in the
    // browser, where the same class on a sibling `<div>` did turn — so the
    // open state has to reach the glyph itself.
    await openPanel();
    const details = await screen.findByTestId("version-preview-disclosure");
    const glyph = () => details.querySelector("summary svg")?.getAttribute("class");

    expect(glyph()).toContain("lucide-chevron-right");

    // jsdom does not implement a `<summary>` click opening its `<details>`,
    // so the platform's half is driven by hand and measured in the browser
    // instead. What is asserted here is this component's half: that the
    // reported open state reaches the glyph.
    (details as HTMLDetailsElement).open = true;
    fireEvent(details, new Event("toggle"));
    await act(async () => {});

    expect(glyph()).toContain("lucide-chevron-down");
  });

  it("decodes percent-encoded link targets and leaves a malformed one alone", async () => {
    apiMocks.getFileVersion.mockResolvedValue({
      id: 2,
      content:
        "- [はじめに](#1-%E3%81%AF%E3%81%98%E3%82%81%E3%81%AB)\n- [up](#up-100%-year)\n",
      etag: "e",
    });

    await openPanel();

    const preview = await screen.findByTestId("version-preview");
    expect(preview).toHaveTextContent("[はじめに](#1-はじめに)");
    expect(preview).toHaveTextContent("[up](#up-100%-year)");
  });
});

describe("VersionHistoryPanel row hierarchy", () => {
  it("leads with the absolute time and follows with the relative one", async () => {
    await openPanel();

    const stamp = document.querySelector(
      'time[datetime="2026-08-20T12:00:00Z"]',
    ) as HTMLElement;
    const [primary, secondary] = [...stamp.children] as HTMLElement[];

    // Two versions saved the same afternoon are both "18 days ago"; the
    // absolute stamp is the half that tells them apart, so it leads.
    expect(primary.textContent).toMatch(/2026/);
    expect(primary.className).toContain("font-medium");
    expect(secondary.textContent).not.toMatch(/2026/);
    expect(secondary.className).toContain("text-text-muted");
  });
});
