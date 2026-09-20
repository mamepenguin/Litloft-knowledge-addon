import { stripPreviewText } from "@/components/TextThumbnail";

/** The body's opening text, with a leading line that only repeats the title removed. */
export function excerptFromText(raw: string, title: string): string {
  const lines = stripPreviewText(raw).split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first >= 0 && lines[first].trim() === title.trim()) lines.splice(first, 1);
  return lines.join("\n").trim();
}
