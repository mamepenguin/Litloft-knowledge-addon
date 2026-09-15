"use client";

import { useEffect, useState } from "react";

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function msUntilNextDay(from: Date): number {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1).getTime() - from.getTime();
}

/** The time the page was opened, moved forward only when the local day changes. */
export function useNoteClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const catchUp = () => {
      const current = new Date();
      setNow((prev) => (sameDay(prev, current) ? prev : current));
    };
    const schedule = () => {
      timer = setTimeout(() => {
        catchUp();
        schedule();
      }, msUntilNextDay(new Date()));
    };
    // A timer does not run while the machine sleeps, so the day is also
    // checked when the page is shown again.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      catchUp();
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return now;
}
