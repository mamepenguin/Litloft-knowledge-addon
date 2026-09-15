import type { FileItem } from "@/types";

export function appendUnseen(shown: FileItem[], next: FileItem[]): FileItem[] {
  const seen = new Set(shown.map((file) => file.id));
  return [...shown, ...next.filter((file) => !seen.has(file.id))];
}
