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
    expect([...result.current.answered]).toEqual([]);
    expect(api.fetchNoteOpenings).toHaveBeenCalledTimes(1);
    expect(api.fetchNoteOpenings).toHaveBeenCalledWith("d", ["a", "b"]);

    answer({ a: "Body." });
    await waitFor(() => expect(result.current.text).toEqual({ a: "Body." }));
    expect([...result.current.answered].sort()).toEqual(["a", "b"]);
  });

  it("asks only about the ids a further page brought", async () => {
    api.fetchNoteOpenings.mockResolvedValue({});
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useNoteOpenings("d", ids),
      { initialProps: { ids: ["a", "b"] } },
    );
    await waitFor(() => expect(result.current.answered.size).toBe(2));

    rerender({ ids: ["a", "b", "c"] });
    await waitFor(() => expect(result.current.answered.size).toBe(3));

    expect(api.fetchNoteOpenings.mock.calls.map(([, ids]) => ids)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("counts a failed request as answered, so the rows still appear", async () => {
    api.fetchNoteOpenings.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useNoteOpenings("d", ["a"]));
    await waitFor(() => expect([...result.current.answered]).toEqual(["a"]));
    expect(result.current.text).toEqual({});
  });

  it("asks nothing for a listing that has not arrived", () => {
    const { result } = renderHook(() => useNoteOpenings("d", []));
    expect([...result.current.answered]).toEqual([]);
    expect(api.fetchNoteOpenings).not.toHaveBeenCalled();
  });

  it("asks about a page once, even while its answer is on the way", async () => {
    let answer: (openings: Record<string, string>) => void = () => {};
    api.fetchNoteOpenings.mockReturnValue(
      new Promise<Record<string, string>>((resolve) => {
        answer = resolve;
      }),
    );
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useNoteOpenings("d", ids),
      { initialProps: { ids: ["a", "b"] } },
    );
    rerender({ ids: ["a", "b", "c"] });

    expect(api.fetchNoteOpenings.mock.calls.map(([, ids]) => ids)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
    answer({});
    await waitFor(() => expect(result.current.answered.size).toBeGreaterThan(0));
  });

  it("forgets another drive's answers", async () => {
    api.fetchNoteOpenings.mockResolvedValue({ a: "First drive." });
    const { result, rerender } = renderHook(
      ({ drive }: { drive: string }) => useNoteOpenings(drive, ["a"]),
      { initialProps: { drive: "one" } },
    );
    await waitFor(() => expect(result.current.text).toEqual({ a: "First drive." }));

    api.fetchNoteOpenings.mockResolvedValue({ a: "Second drive." });
    rerender({ drive: "two" });
    await waitFor(() => expect(result.current.text).toEqual({ a: "Second drive." }));
  });
});
