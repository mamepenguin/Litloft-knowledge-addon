/**
 * Lets an entry point outside the editor open the version history.
 *
 * The panel is drawn by `Editor`, which the host mounts in the
 * `file-detail-sections` slot. The `[...]` menu entry is drawn by
 * `FileActions`, in `file-actions-menu`. They are sibling subtrees under
 * the file detail page with no common component to hold the state, so the
 * panel publishes its opener here and the entry calls it.
 *
 * Registration is what makes the entry visible, rather than the entry
 * guessing from the mime type whether an editor is mounted: an entry that
 * cannot reach a panel would do nothing when pressed.
 */

type Opener = () => void;

const openers = new Map<string, Opener>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Publishes `open` as the way to reveal `fileId`'s history. Returns the undo. */
export function registerVersionHistory(fileId: string, open: Opener): () => void {
  openers.set(fileId, open);
  notify();
  return () => {
    // Only if it is still ours: under StrictMode, and when the file id
    // changes, the next registration lands before this cleanup runs.
    if (openers.get(fileId) === open) {
      openers.delete(fileId);
      notify();
    }
  };
}

export function subscribeVersionHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasVersionHistory(fileId: string): boolean {
  return openers.has(fileId);
}

/** Reveals `fileId`'s history. Answers whether anything was listening. */
export function requestVersionHistory(fileId: string): boolean {
  const open = openers.get(fileId);
  if (!open) return false;
  open();
  return true;
}
