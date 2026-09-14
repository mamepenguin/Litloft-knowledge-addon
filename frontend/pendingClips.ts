/**
 * Clip jobs sent from the Add menu in this tab, waiting for their result.
 *
 * Module scope on purpose: the row that sends a clip unmounts with its
 * menu, and the header entry that announces the result unmounts on every
 * route without a drive. Both come and go; this list must not.
 */
const pending = new Set<number>();
const listeners = new Set<() => void>();
let version = 0;

export function addPendingClip(jobId: number): void {
  pending.add(jobId);
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Removes the job and reports whether it was pending. */
export function takePendingClip(jobId: number): boolean {
  return pending.delete(jobId);
}

export function subscribePendingClips(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pendingClipsVersion(): number {
  return version;
}

export function _resetPendingClipsForTests(): void {
  pending.clear();
  listeners.clear();
  version = 0;
}
