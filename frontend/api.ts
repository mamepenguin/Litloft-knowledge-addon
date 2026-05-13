const KNOWLEDGE_BASE = "/api/addons/knowledge";

function driveHeaders(drive: string): Record<string, string> {
  // HTTP header values must be ISO-8859-1. Drive names may contain
  // non-ASCII characters (Japanese, etc.), so percent-encode the value
  // and decode on the server side.
  return { "X-Lit-Drive": encodeURIComponent(drive) };
}

async function request<T>(
  drive: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const baseHeaders: Record<string, string> = { ...driveHeaders(drive) };
  if (init?.body !== undefined) baseHeaders["Content-Type"] = "application/json";
  const res = await fetch(`${KNOWLEDGE_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: { ...baseHeaders, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---- Core API (for file list in drive) ----

export interface CoreDrive {
  name: string;
  protected: boolean;
}

export interface CoreFileItem {
  id: string;
  filename: string;
  title: string;
  drive: string;
  folder_path: string;
  file_type: string;
  mime_type: string;
  thumbnail_url: string;
  file_size: number;
  created_at: string;
  updated_at: string;
}

export interface CorePaginatedFiles {
  data: CoreFileItem[];
  meta: { total: number; page: number; limit: number };
}

export async function listDrives(): Promise<CoreDrive[]> {
  const res = await fetch("/api/drives", { credentials: "include" });
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return res.json();
}

// ---- Webclip ingestion ----

export interface ClipJob {
  job_id: number;
  file_id: string;
  status: "fetching" | "ready" | "failed";
}

export interface ClipCreateBody {
  url: string;
  subfolder?: string | null;
  title?: string | null;
}

export function createClip(
  drive: string,
  body: ClipCreateBody,
): Promise<ClipJob> {
  return request<ClipJob>(drive, "/clips", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface ClipPastedBody extends ClipCreateBody {
  html: string;
}

export function createClipFromHtml(
  drive: string,
  body: ClipPastedBody,
): Promise<ClipJob> {
  return request<ClipJob>(drive, "/clips/pasted", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function findClipsByUrl(
  drive: string,
  url: string,
): Promise<ClipJob[]> {
  const qs = new URLSearchParams({ url });
  return request<ClipJob[]>(drive, `/clips?${qs}`);
}

// ---- Drive-scoped search ----

export interface SearchHit {
  file_id: string;
  filename: string;
  title: string;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  drive: string;
  results: SearchHit[];
  truncated: boolean;
}

export async function searchKnowledge(
  drive: string,
  query: string,
): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q: query });
  const res = await fetch(`${KNOWLEDGE_BASE}/search?${qs}`, {
    credentials: "include",
    headers: driveHeaders(drive),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
  return res.json();
}

// ---- Text file editing (core API) ----

function parseEtagHeader(res: Response): string {
  const headerEtag = res.headers.get("etag");
  if (!headerEtag) {
    throw new Error(
      "サーバーから ETag が返されませんでした。テキストファイルの編集ができません。",
    );
  }
  return headerEtag.replace(/^W\//, "").replace(/^"|"$/g, "");
}

export interface LoadedTextFile {
  content: string;
  etag: string;
}

export async function getFileContent(fileId: string): Promise<LoadedTextFile> {
  const res = await fetch(`/api/files/${encodeURIComponent(fileId)}/stream`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  const content = await res.text();
  const etag = parseEtagHeader(res);
  return { content, etag };
}

export class ConflictError extends Error {
  constructor() {
    super("ETag mismatch");
    this.name = "ConflictError";
  }
}

export async function putFileContent(
  fileId: string,
  content: string,
  ifMatch: string,
): Promise<string> {
  const res = await fetch(`/api/files/${encodeURIComponent(fileId)}/content`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "If-Match": `"${ifMatch}"`,
    },
    body: content,
  });
  if (res.status === 412) throw new ConflictError();
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
  return parseEtagHeader(res);
}

export interface CreateTextFileBody {
  path: string;
  content?: string;
}

export async function createTextFile(
  drive: string,
  body: CreateTextFileBody,
): Promise<CoreFileItem> {
  const res = await fetch(
    `/api/drives/${encodeURIComponent(drive)}/files`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "", ...body }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
  return res.json();
}

export async function trashFile(fileId: string): Promise<void> {
  const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
}

export async function restoreFile(fileId: string): Promise<void> {
  const res = await fetch(
    `/api/files/${encodeURIComponent(fileId)}/restore`,
    { method: "POST", credentials: "include" },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
}

export async function renameFile(
  fileId: string,
  newFilename: string,
): Promise<CoreFileItem> {
  const res = await fetch(
    `/api/files/${encodeURIComponent(fileId)}/rename`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_filename: newFilename }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
  return res.json();
}

export interface CoreFolderItem {
  name: string;
  path: string;
  file_count: number;
  thumbnail_file_id: string | null;
}

export async function listKnowledgeFolders(
  drive: string,
  path: string,
): Promise<CoreFolderItem[]> {
  const qs = new URLSearchParams({ path });
  const res = await fetch(
    `/api/drives/${encodeURIComponent(drive)}/folders?${qs}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return res.json();
}

export async function createFolder(
  drive: string,
  path: string,
  name: string,
): Promise<CoreFolderItem> {
  const res = await fetch(
    `/api/drives/${encodeURIComponent(drive)}/folders`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, name }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
  return res.json();
}

export async function listKnowledgeFiles(
  drive: string,
  path: string,
  page = 1,
  limit = 100,
): Promise<CorePaginatedFiles> {
  const qs = new URLSearchParams({
    path,
    page: String(page),
    limit: String(limit),
    sort: "title",
    order: "asc",
  });
  const res = await fetch(
    `/api/drives/${encodeURIComponent(drive)}/files?${qs}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return res.json();
}

// ---- File move ----

export async function moveFile(
  fileId: string,
  drive: string,
  targetFolderPath: string,
): Promise<CoreFileItem> {
  const res = await fetch(
    `/api/files/${encodeURIComponent(fileId)}/move`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_drive: drive, target_folder_path: targetFolderPath }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
  return res.json();
}

// ---- Folder operations ----

export async function moveFolder(
  drive: string,
  path: string,
  targetPath: string,
): Promise<CoreFolderItem> {
  const res = await fetch(
    `/api/drives/${encodeURIComponent(drive)}/folders/move`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, target_path: targetPath }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
  return res.json();
}

export async function renameFolderApi(
  drive: string,
  path: string,
  newName: string,
): Promise<CoreFolderItem> {
  const res = await fetch(
    `/api/drives/${encodeURIComponent(drive)}/folders`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, new_name: newName }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
  return res.json();
}

export async function deleteFolderApi(drive: string, path: string): Promise<void> {
  const qs = new URLSearchParams({ path });
  const res = await fetch(
    `/api/drives/${encodeURIComponent(drive)}/folders?${qs}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
}

// ---- Tags ----

export async function getFileTags(fileId: string): Promise<string[]> {
  const res = await fetch(
    `/api/files/${encodeURIComponent(fileId)}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  const data = await res.json();
  return (data.tags as string[] | null) ?? [];
}

export async function updateFileTags(fileId: string, tags: string[]): Promise<void> {
  const res = await fetch(
    `/api/files/${encodeURIComponent(fileId)}/tags`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Error: ${res.status}`);
  }
}

export interface DriveTagItem {
  name: string;
  count: number;
}

export async function listDriveTags(drive: string): Promise<DriveTagItem[]> {
  const res = await fetch(
    `/api/drives/${encodeURIComponent(drive)}/tags`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Error: ${res.status}`);
  return res.json();
}
