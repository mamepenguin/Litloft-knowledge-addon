import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchNoteOpenings: vi.fn() }));
vi.mock("../api", () => api);

const { useNoteOpenings } = await import("../useNoteOpenings");

afterEach(() => {
  api.fetchNoteOpenings.mockReset();
});

describe("useNoteOpenings", () => {
  it("asks once for the whole listing and answers only when it is in", async () => {
    let answer: (openings: Record<string, string>) => void = () => {};
    api.fetchNoteOpenings.mockReturnValue(
      new Promise<Record<string, string>>((resolve) => {
        answer = resolve;
      }),
    );

    const { result } = renderHook(() => useNoteOpenings("d", ["a", "b"]));
    expect(result.current).toBeNull();
    expect(api.fetchNoteOpenings).toHaveBeenCalledTimes(1);
    expect(api.fetchNoteOpenings).toHaveBeenCalledWith("d", ["a", "b"]);

    answer({ a: "Body." });
    await waitFor(() => expect(result.current).toEqual({ a: "Body." }));
  });

  it("asks only about the ids a further page brought", async () => {
    api.fetchNoteOpenings.mockResolvedValue({});
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useNoteOpenings("d", ids),
      { initialProps: { ids: ["a", "b"] } },
    );
    await waitFor(() => expect(result.current).not.toBeNull());

    rerender({ ids: ["a", "b", "c"] });
    await waitFor(() => expect(result.current).not.toBeNull());

    expect(api.fetchNoteOpenings.mock.calls.map(([, ids]) => ids)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("counts a failed request as answered, so the rows still appear", async () => {
    api.fetchNoteOpenings.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useNoteOpenings("d", ["a"]));
    await waitFor(() => expect(result.current).toEqual({}));
  });

  it("holds nothing back when the listing itself has not arrived", () => {
    const { result } = renderHook(() => useNoteOpenings("d", null));
    expect(result.current).toBeNull();
    expect(api.fetchNoteOpenings).not.toHaveBeenCalled();
  });

  it("forgets another drive's answers", async () => {
    api.fetchNoteOpenings.mockResolvedValue({ a: "First drive." });
    const { result, rerender } = renderHook(
      ({ drive }: { drive: string }) => useNoteOpenings(drive, ["a"]),
      { initialProps: { drive: "one" } },
    );
    await waitFor(() => expect(result.current).toEqual({ a: "First drive." }));

    api.fetchNoteOpenings.mockResolvedValue({ a: "Second drive." });
    rerender({ drive: "two" });
    await waitFor(() => expect(result.current).toEqual({ a: "Second drive." }));
  });
});
