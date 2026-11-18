import { Archive, BookOpen, File, FileAudio, FileImage, FileText, FileVideo, type LucideIcon } from "lucide-react";

/** The icon of a source's kind, from its mime type. */
export function sourceIcon(mimeType: string): LucideIcon {
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("audio/")) return FileAudio;
  if (mimeType === "application/epub+zip") return BookOpen;
  if (mimeType === "application/pdf" || mimeType.startsWith("text/")) return FileText;
  if (mimeType === "application/zip" || mimeType.includes("compressed")) return Archive;
  return File;
}
