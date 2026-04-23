import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchVault } from "../api";

function mockFetch(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async (..._args: unknown[]) => ({
    ok,
    status,
    json: async () => body,
  } as Response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn> & {
    mock: { calls: string[][] };
  };
}

describe("searchVault", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.restoreAllMocks());

  it("encodes vault_id and query into the URL", async () => {
    const fetchMock = mockFetch({
      query: "x",
      vault_id: 1,
      results: [],
      truncated: false,
    });
    await searchVault("d", 1, "hello world");
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    expect(url.startsWith("/api/addons/knowledge/search?")).toBe(true);
    expect(url).toContain("vault_id=1");
    expect(url).toContain("q=hello+world");
    expect(
      ((call[1] as unknown as { headers: Record<string, string> }).headers)[
        "X-Lit-Drive"
      ],
    ).toBe("d");
  });

  it("returns the body on success", async () => {
    mockFetch({
      query: "q",
      vault_id: 2,
      results: [
        { file_id: "f1", filename: "a.md", title: "A", snippet: "..." },
      ],
      truncated: true,
    });
    const res = await searchVault("d", 2, "q");
    expect(res.truncated).toBe(true);
    expect(res.results[0].file_id).toBe("f1");
  });

  it("throws with server detail on error", async () => {
    mockFetch({ detail: "bad" }, false, 400);
    await expect(searchVault("d", 1, "x")).rejects.toThrow("bad");
  });
});
