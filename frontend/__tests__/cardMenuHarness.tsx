/**
 * The file menu on the Notes and Clips cards, driven as a viewer drives it:
 * right-click or a held touch on a card, a row chosen, the dialog submitted.
 * Each dialog is a button that submits it, so the request's answer is what a
 * case varies. Writes and the re-read are answered on the wire through
 * `writeRoutes`, layered over a harness server's own `override`.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { vi } from "vitest";

import { json } from "@/__tests__/helpers/wireFetch";

export const NEW_TAB = "Open in new tab";
export const FILE_ROWS = [NEW_TAB, "Download", "Add to collection", "Copy", "Cut", "Copy ID", "Rename", "Move", "Move to Trash"];
export const HISTORY_ROWS = [...FILE_ROWS.slice(0, 8), "Remove from history", "Move to Trash"];

// ------------------------------------------------------------------- dialogs

export const dialogs = { renameTo: "Renamed.md", moveTo: "Elsewhere" };

export const renameDialogModule = {
  RenameDialog: ({ open, onRename }: { open: boolean; onRename: (name: string) => unknown }) =>
    open ? <button onClick={() => void onRename(dialogs.renameTo)}>submit-rename</button> : null,
};

export const moveDialogModule = {
  MoveDialog: ({ open, onMove }: { open: boolean; onMove: (path: string) => unknown }) =>
    open ? <button onClick={() => void onMove(dialogs.moveTo)}>submit-move</button> : null,
};

export const confirmDialogModule = {
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => unknown }) =>
    open ? createPortal(<button onClick={() => void onConfirm()}>submit-trash</button>, document.body) : null,
};

export const collectionPickerModule = { CollectionPicker: () => null };

export const clipboardModule = {
  useClipboard: () => ({ clipboard: null, copy: vi.fn(), cut: vi.fn(), paste: vi.fn(), clear: vi.fn(), isCut: () => false }),
};

export const toast = { error: vi.fn(), success: vi.fn(), info: vi.fn() };

export async function toastModule() {
  const actual = await vi.importActual<Record<string, unknown>>("@/components/ToastProvider");
  return { ...actual, useToast: () => toast };
}

export function resetToast() {
  toast.error.mockReset();
  toast.success.mockReset();
  toast.info.mockReset();
}

export const toasted = () => toast.error.mock.calls.length + toast.success.mock.calls.length + toast.info.mock.calls.length;

// ---------------------------------------------------------------------- menu

export const rows = () => screen.queryAllByRole("menuitem").map((el) => el.textContent?.trim() ?? "");

/** Fires a right-click; true when nothing prevented the browser's own menu. */
export async function rightClick(target: Element): Promise<boolean> {
  let notPrevented = true;
  await act(async () => {
    notPrevented = fireEvent.contextMenu(target, { clientX: 40, clientY: 40 });
  });
  return notPrevented;
}

export async function choose(label: string) {
  const row = screen.getByRole("menuitem", { name: label });
  await act(async () => {
    fireEvent.pointerDown(row);
    fireEvent.click(row);
  });
}

export async function submit(label: "submit-rename" | "submit-move" | "submit-trash") {
  const button = await screen.findByText(label);
  await act(async () => {
    fireEvent.click(button);
  });
}

/** Clicks the dialog's submit button when one is shown. */
export async function submitIfShown() {
  for (const label of ["submit-rename", "submit-move", "submit-trash"]) {
    const button = screen.queryByText(label);
    if (button) {
      await act(async () => {
        fireEvent.click(button);
      });
    }
  }
}

/** A press outside the menu, and the click it produces, as the scrim sees them. */
export async function closeMenu() {
  await act(async () => {
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
  });
}

/**
 * A touch held `ms` on `target`, moving `move` px first when given, then
 * released and followed by the click the browser sends. Timers are faked only
 * for the press, so the page loads with real ones.
 */
export async function press(target: Element, ms: number, move = 0) {
  vi.useFakeTimers();
  try {
    fireEvent.touchStart(target, { touches: [{ clientX: 50, clientY: 50 }] });
    if (move) fireEvent.touchMove(target, { touches: [{ clientX: 50 + move, clientY: 50 }] });
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  } finally {
    vi.useRealTimers();
  }
}

export async function release(target: Element) {
  await act(async () => {
    fireEvent.touchEnd(target, { changedTouches: [{ clientX: 50, clientY: 50 }] });
    fireEvent.click(target);
  });
}

// ---------------------------------------------------------------------- wire

export interface WireLike {
  method: string;
  url: URL;
  body: unknown;
}

type Answer = Response | Promise<Response> | null;

export type WriteKind = "rename" | "move" | "trash" | "history" | "dismiss" | "reread";

export function kindOf(c: WireLike): { kind: WriteKind; id: string } | null {
  const p = c.url.pathname;
  let m = /^\/api\/files\/([^/]+)\/rename$/.exec(p);
  if (m && c.method === "PUT") return { kind: "rename", id: m[1] };
  m = /^\/api\/files\/([^/]+)\/move$/.exec(p);
  if (m && c.method === "PUT") return { kind: "move", id: m[1] };
  m = /^\/api\/files\/([^/]+)\/progress\/dismiss$/.exec(p);
  if (m && c.method === "POST") return { kind: "dismiss", id: m[1] };
  m = /^\/api\/files\/([^/]+)\/progress$/.exec(p);
  if (m && c.method === "DELETE") return { kind: "history", id: m[1] };
  m = /^\/api\/files\/([^/]+)$/.exec(p);
  if (m && c.method === "DELETE") return { kind: "trash", id: m[1] };
  if (isReread(c)) return { kind: "reread", id: c.url.searchParams.getAll("ids")[0] };
  return null;
}

/**
 * The re-read: a `by=all` shelves read for one id, with no `opened` or `watch`.
 * Kept loose so an extra parameter fails the one test that pins the exact call,
 * not every test that waits for the re-read.
 */
export function isReread(c: WireLike): boolean {
  if (c.method !== "GET" || !/^\/api\/drives\/[^/]+\/shelves$/.test(c.url.pathname)) return false;
  const p = c.url.searchParams;
  return p.get("by") === "all" && p.getAll("ids").length === 1 && !p.has("opened") && !p.has("watch");
}

export const writes = (calls: WireLike[], kind: WriteKind, id?: string) =>
  calls.filter((c) => {
    const k = kindOf(c);
    return k !== null && k.kind === kind && (id === undefined || k.id === id);
  });

/** The writes and re-reads a page sent, as `kind:id`, in order. */
export const writeLog = (calls: WireLike[]) =>
  calls.map(kindOf).filter((k): k is { kind: WriteKind; id: string } => k !== null).map((k) => `${k.kind}:${k.id}`);

export interface WriteStore<T> {
  find: (id: string) => T | undefined;
  rename: (id: string, filename: string) => void;
  move: (id: string, folder: string) => void;
  trash: (id: string) => void;
  forget: (id: string) => void;
  item: (t: T) => unknown;
}

export interface WriteControl {
  /** Replaces the answer for a kind; return null to fall through to the store. */
  hold: Partial<Record<WriteKind, (c: WireLike) => Answer>>;
}

export function failWith(status = 500): () => Response {
  return () => json({ detail: "boom" }, status);
}

export function writeRoutes<T>(store: WriteStore<T>, control: WriteControl): (c: WireLike) => Answer {
  return (c) => {
    const k = kindOf(c);
    if (!k) return null;
    const held = control.hold[k.kind]?.(c);
    if (held) return held;
    return answerWrite(store, k, c);
  };
}

export function answerWrite<T>(store: WriteStore<T>, k: { kind: WriteKind; id: string }, c: WireLike): Response {
  switch (k.kind) {
    case "rename": {
      store.rename(k.id, (c.body as { new_filename: string }).new_filename);
      const t = store.find(k.id);
      return t ? json(store.item(t)) : json({ detail: "Not found" }, 404);
    }
    case "move": {
      store.move(k.id, (c.body as { target_folder_path: string }).target_folder_path);
      const t = store.find(k.id);
      return t ? json(store.item(t)) : json({ detail: "Not found" }, 404);
    }
    case "trash":
      store.trash(k.id);
      return new Response(null, { status: 204 });
    case "history":
    case "dismiss":
      store.forget(k.id);
      return new Response(null, { status: 204 });
    case "reread": {
      const t = store.find(k.id);
      const items = t ? [store.item(t)] : [];
      return json({ by: "all", base: "", total_shelves: 1, shelves: [{ key: "all", label: "", count: items.length, items }] });
    }
  }
}

export function deferredResponse() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}
