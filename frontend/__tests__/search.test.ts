import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchKnowledge } from "../api";

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

describe("searchKnowledge", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.restoreAllMocks());

  it("encodes the query into the URL with drive header", async () => {
    const fetchMock = mockFetch({
      query: "x",
      drive: "d",
      results: [],
      truncated: false,
    });
    await searchKnowledge("d", "hello world");
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    expect(url.startsWith("/api/addons/knowledge/search?")).toBe(true);
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
      drive: "d",
      results: [
        { file_id: "f1", filename: "a.md", title: "A", snippet: "..." },
      ],
      truncated: true,
    });
    const res = await searchKnowledge("d", "q");
    expect(res.truncated).toBe(true);
    expect(res.drive).toBe("d");
    expect(res.results[0].file_id).toBe("f1");
  });

  it("throws with server detail on error", async () => {
    mockFetch({ detail: "bad" }, false, 400);
    await expect(searchKnowledge("d", "x")).rejects.toThrow("bad");
  });
});
