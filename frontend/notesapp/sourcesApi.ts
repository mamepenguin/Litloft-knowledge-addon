const KNOWLEDGE_BASE = "/api/addons/knowledge";

export type NoteLocator = { t: number } | { page: number } | null;

export interface NoteSource {
  source_file_id: string;
  title: string;
  filename: string;
  folder_path: string;
  mime_type: string;
  has_thumbnail: boolean;
  locator: NoteLocator;
}

async function call<T>(drive: string, path: string, init?: RequestInit): Promise<T> {
  // Header values are ISO-8859-1; the server decodes the percent-encoding.
  const headers: Record<string, string> = { "X-Lit-Drive": encodeURIComponent(drive) };
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${KNOWLEDGE_BASE}${path}`, { credentials: "include", ...init, headers });
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return (await res.json()) as T;
}

/** The ids of the drive's notes that have at least one source. */
export async function getNotesWithSources(drive: string): Promise<string[]> {
  const res = await call<{ ids: string[] }>(drive, "/notes/with-sources");
  return res.ids;
}

/** The sources of up to 60 notes; a note with none maps to `[]`. */
export async function getNoteSources(
  drive: string,
  fileIds: readonly string[],
): Promise<Record<string, NoteSource[]>> {
  const res = await call<{ notes: Record<string, NoteSource[]> }>(drive, "/notes/sources", {
    method: "POST",
    body: JSON.stringify({ file_ids: fileIds }),
  });
  return res.notes;
}
