"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ScopedPhase = "loading" | "ready" | "failed";

interface Held<T> {
  scope: string;
  phase: ScopedPhase;
  data: T | null;
}

/**
 * One request whose answer belongs to `scope`. A new scope starts empty. A
 * `refresh` or a retry within the same scope keeps what is drawn until the
 * answer comes, and a failure keeps it too. `null` is "nothing to ask".
 */
export function useScopedLoad<T>(
  scope: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  refresh: number,
): { phase: ScopedPhase; data: T | null; retry: () => void } {
  const [held, setHeld] = useState<Held<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (scope === null) return;
    const controller = new AbortController();
    setHeld((prev) =>
      prev !== null && prev.scope === scope
        ? { ...prev, phase: "loading" }
        : { scope, phase: "loading", data: null },
    );
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setHeld({ scope, phase: "ready", data });
      },
      () => {
        if (!controller.signal.aborted) {
          setHeld((prev) =>
            prev !== null && prev.scope === scope
              ? { ...prev, phase: "failed" }
              : { scope, phase: "failed", data: null },
          );
        }
      },
    );
    return () => controller.abort();
  }, [scope, refresh, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const own = held !== null && held.scope === scope ? held : null;
  return { phase: own?.phase ?? "loading", data: own?.data ?? null, retry };
}
