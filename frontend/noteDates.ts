import type { FileItem } from "@/types";

export type NoteAgeGroup = "today" | "week" | "month" | "earlier";

const GROUP_ORDER: NoteAgeGroup[] = ["today", "week", "month", "earlier"];
const DAY_MS = 86_400_000;

// The local calendar date as a UTC timestamp: local midnights are not 24 hours
// apart across a daylight-saving change, UTC midnights always are.
function calendarDay(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

export function noteAgeGroup(iso: string, now: Date): NoteAgeGroup {
  const days = (calendarDay(now) - calendarDay(new Date(iso))) / DAY_MS;
  if (days <= 0) return "today";
  if (days < 7) return "week";
  if (days < 30) return "month";
  return "earlier";
}

/** Keeps the files' own order inside each group; empty groups are omitted. */
export function groupNotesByAge(
  files: FileItem[],
  now: Date,
): { group: NoteAgeGroup; files: FileItem[] }[] {
  const buckets = new Map<NoteAgeGroup, FileItem[]>();
  for (const file of files) {
    const group = noteAgeGroup(file.updated_at, now);
    buckets.set(group, [...(buckets.get(group) ?? []), file]);
  }
  return GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => ({
    group,
    files: buckets.get(group) ?? [],
  }));
}

export function formatNoteTime(iso: string, now: Date, locale: string): string {
  const date = new Date(iso);
  if (noteAgeGroup(iso, now) === "today") {
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(locale, {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "short",
    day: "numeric",
  });
}
