export type CaptureDestinationMode = "fixed" | "daily";

export interface CaptureDestinationSettings {
  folder: string;
  mode: CaptureDestinationMode;
}

export interface CaptureDestination {
  folder: string;
  filename: string;
}

export const FALLBACK_CAPTURE_DESTINATION: CaptureDestinationSettings = {
  folder: "Captures",
  mode: "fixed",
};

const WINDOWS_RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

function storageKey(drive: string): string {
  return `knowledge:captureDestination:${drive}`;
}

function normalizeSettings(value: unknown): CaptureDestinationSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.mode !== "fixed" && candidate.mode !== "daily") return null;
  if (typeof candidate.folder !== "string") return null;

  const rawFolder = candidate.folder.trim().replace(/^\/+|\/+$/g, "");
  if (rawFolder.length > 512 || /[\\\u0000-\u001f]/.test(rawFolder)) return null;
  const parts = rawFolder.split("/").filter(Boolean);
  if (parts.some((part) => {
    const stem = part.split(".", 1)[0].toUpperCase();
    return part === "." || part === ".." || part.length > 255
      || WINDOWS_RESERVED_NAMES.has(stem);
  })) return null;
  return { folder: parts.join("/"), mode: candidate.mode };
}

export function readCaptureDestination(drive: string): CaptureDestinationSettings {
  if (typeof window === "undefined") return { ...FALLBACK_CAPTURE_DESTINATION };
  try {
    const raw = window.localStorage.getItem(storageKey(drive));
    if (!raw) return { ...FALLBACK_CAPTURE_DESTINATION };
    return normalizeSettings(JSON.parse(raw)) ?? { ...FALLBACK_CAPTURE_DESTINATION };
  } catch {
    return { ...FALLBACK_CAPTURE_DESTINATION };
  }
}

export function writeCaptureDestination(
  drive: string,
  settings: CaptureDestinationSettings,
): CaptureDestinationSettings {
  const normalized = normalizeSettings(settings) ?? { ...FALLBACK_CAPTURE_DESTINATION };
  try {
    window.localStorage.setItem(storageKey(drive), JSON.stringify(normalized));
  } catch {
    // The in-memory settings remain usable when storage is unavailable/full.
  }
  return normalized;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function captureDestinationForDate(
  settings: CaptureDestinationSettings,
  now: Date,
): CaptureDestination {
  const filename = settings.mode === "fixed"
    ? "Inbox.md"
    : `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.md`;
  return { folder: settings.folder, filename };
}
