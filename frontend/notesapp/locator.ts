import type { NoteLocator } from "./sourcesApi";

/** `m:ss` under an hour, `h:mm:ss` from an hour. */
export function formatSeconds(total: number): string {
  const whole = Math.max(0, Math.floor(total));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * The position a source is cited at, or `null` when it has none. `page` is
 * written by the caller's translation ("p. N").
 */
export function formatLocator(
  locator: NoteLocator,
  page: (n: number) => string,
): string | null {
  if (locator === null) return null;
  return "t" in locator ? formatSeconds(locator.t) : page(locator.page);
}
