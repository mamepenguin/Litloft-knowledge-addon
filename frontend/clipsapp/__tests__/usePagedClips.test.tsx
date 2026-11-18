/** SPEC-ADDON-138 steps 5 and 8: how a shelf's pages merge, and what leaves them. */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { usePagedClips, type PagedPage } from "../usePagedClips";

interface Item {
  id: string;
  title?: string;
}
const ids = (items: Item[]) => items.map((item) => item.id);
const page = (list: string[], count = list.length): PagedPage<Item> => ({ items: list.map((id) => ({ id })), count });

function setup(initial: { scope: string | null; refresh: number }, answer: (n: number) => Promise<PagedPage<Item>>, extra = {}) {
  const fetchPage = vi.fn((n: number) => answer(n));
  const hook = renderHook(
    ({ scope, refresh }) => usePagedClips<Item>({ scope, refresh, pageSize: 2, fetchPage, ...extra }),
    { initialProps: initial },
  );
  return { ...hook, fetchPage };
}

describe("SPEC-ADDON-138 refresh merges the first page", () => {
  it("puts the fresh page first, updates a drawn card, and keeps the drawn cards the page does not name", async () => {
    let first = page(["a", "b"], 4);
    const { result, rerender } = setup({ scope: "s", refresh: 0 }, async (n) => (n === 1 ? first : page(["c", "d"], 4)));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.loadMore());
    await waitFor(() => expect(ids(result.current.items)).toEqual(["a", "b", "c", "d"]));

    first = { items: [{ id: "n" }, { id: "a", title: "A2" }], count: 5 };
    rerender({ scope: "s", refresh: 1 });
    await waitFor(() => expect(ids(result.current.items)).toEqual(["n", "a", "b", "c", "d"]));
    expect(result.current.items[1].title).toBe("A2");
    expect(result.current.count).toBe(5);
  });

  it("keeps what is drawn, and stays ready, when a refresh fails", async () => {
    let fail = false;
    const { result, rerender } = setup({ scope: "s", refresh: 0 }, async () => {
      if (fail) throw new Error("down");
      return page(["a"]);
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    fail = true;
    rerender({ scope: "s", refresh: 1 });
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(result.current.phase).toBe("ready");
    expect(ids(result.current.items)).toEqual(["a"]);
  });

  it("starts over, loading and empty, for a new scope, and drops an answer that belongs to the old one", async () => {
    let release!: (p: PagedPage<Item>) => void;
    let hold = false;
    const { result, rerender } = setup({ scope: "one", refresh: 0 }, () =>
      hold ? new Promise((res) => (release = res)) : Promise.resolve(page(["a"])),
    );
    await waitFor(() => expect(ids(result.current.items)).toEqual(["a"]));

    hold = true;
    rerender({ scope: "two", refresh: 0 });
    expect(result.current.phase).toBe("loading");
    expect(result.current.items).toEqual([]);
    const stale = release;
    hold = false;
    rerender({ scope: "three", refresh: 0 });
    await waitFor(() => expect(ids(result.current.items)).toEqual(["a"]));
    await act(async () => stale(page(["stale"])));
    expect(ids(result.current.items)).toEqual(["a"]);
  });

  it("caps a Home shelf after the merge and replaces it when asked to", async () => {
    let answer = page(["a", "b"]);
    const { result, rerender } = setup({ scope: "s", refresh: 0 }, async () => answer, { cap: 2 });
    await waitFor(() => expect(ids(result.current.items)).toEqual(["a", "b"]));

    answer = page(["n", "a"]);
    rerender({ scope: "s", refresh: 1 });
    await waitFor(() => expect(ids(result.current.items)).toEqual(["n", "a"]));

    const replaced = setup({ scope: "s", refresh: 0 }, async () => answer, { replaceOnRefresh: true });
    await waitFor(() => expect(ids(replaced.result.current.items)).toEqual(["n", "a"]));
    answer = page(["z"]);
    replaced.rerender({ scope: "s", refresh: 1 });
    await waitFor(() => expect(ids(replaced.result.current.items)).toEqual(["z"]));
  });
});

describe("SPEC-ADDON-138 paging and removal", () => {
  it("asks page floor(shown / size) + 1 after a removal, skips drawn cards, and stops when a page adds nothing", async () => {
    const asked: number[] = [];
    const { result } = setup({ scope: "s", refresh: 0 }, async (n) => {
      asked.push(n);
      return n === 1 ? page(["a", "b"], 3) : page(["a", "b"], 3);
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    act(() => result.current.remove("a"));
    expect(ids(result.current.items)).toEqual(["b"]);
    expect(result.current.count).toBe(2);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.more).toBe("idle"));
    expect(asked).toEqual([1, 1]);
    expect(ids(result.current.items)).toEqual(["b"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("does not bring back a removed card from a refresh that was already on its way", async () => {
    let release!: (p: PagedPage<Item>) => void;
    let hold = false;
    const { result, rerender } = setup({ scope: "s", refresh: 0 }, (n) =>
      hold && n === 1 ? new Promise((res) => (release = res)) : Promise.resolve(page(["a", "b"])),
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    hold = true;
    rerender({ scope: "s", refresh: 1 });
    act(() => result.current.remove("a"));
    await act(async () => release(page(["a", "b", "c"])));
    expect(ids(result.current.items)).toEqual(["b", "c"]);
  });

  it("keeps a card that is being saved in place when a refresh would push it past the cap", async () => {
    let answer = page(["a", "b"]);
    const { result, rerender } = setup({ scope: "s", refresh: 0 }, async () => answer, { cap: 2 });
    await waitFor(() => expect(ids(result.current.items)).toEqual(["a", "b"]));

    act(() => result.current.setSaving("b", true));
    answer = page(["n", "a"]);
    rerender({ scope: "s", refresh: 1 });
    await waitFor(() => expect(ids(result.current.items)).toEqual(["n", "a", "b"]));

    act(() => result.current.setSaving("b", false));
    rerender({ scope: "s", refresh: 2 });
    await waitFor(() => expect(ids(result.current.items)).toEqual(["n", "a"]));
  });

  it("asks nothing for a null scope", () => {
    const { result, fetchPage } = setup({ scope: null, refresh: 0 }, async () => page([]));
    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("loading");
  });
});
