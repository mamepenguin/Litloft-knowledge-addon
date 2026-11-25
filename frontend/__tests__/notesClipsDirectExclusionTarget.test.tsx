/**
 * SPEC-ADDON-185: Notes and Clips take a Smart Collection whose query holds an
 * exclusion or `has:` and no free text as a direct target. No member evaluation
 * runs, and their listings, shelves, counts and folder counts carry the keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { fileIdsOf, installWireFetch, json, pagedListing, paramsOf, type WireCall } from "@/__tests__/helpers/wireFetch";
import type { SmartFolder } from "@/types/smartFolder";
import { CLIPS_APP } from "../clipsapp/clipsApp";
import { loadClipCount, loadShelfPage } from "../clipsapp/requests";
import { getNoteFolderCounts, listNotes, listNoteTagShelves } from "../notesapp/listing";
import { NOTES_APP, useNotesTarget, type ReadyNotesTarget } from "../notesapp/useNotesTarget";

vi.mock("next/navigation", () => ({
  usePathname: () => "/drive/main/addons/knowledge",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const DRIVE = "main";
const API = `/api/drives/${DRIVE}`;

function smartFolder(id: string, query: string): SmartFolder {
  return {
    id,
    drive: DRIVE,
    name: id,
    query,
    file_type: null,
    sort_by: null,
    sort_order: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
  };
}

const EVERY_KEY = "tag:Trip -tag:draft -type:image -path:Work -in:Old -is:favorite -is:liked has:tag -has:collection";
const FOLDERS = [
  smartFolder("sf-not-work", "-path:Work"),
  smartFolder("sf-every", EVERY_KEY),
  smartFolder("sf-long", "-path:Work duration:>1h"),
  smartFolder("sf-no-text", "-type:document"),
  smartFolder("sf-impossible", "tag:a -tag:a"),
];

const APPS = [
  { label: "Notes", app: NOTES_APP, key: "litloft.addon.knowledge.target.main" },
  { label: "Clips", app: CLIPS_APP, key: "litloft.addon.knowledge-clips.target.main" },
];

let wire: { calls: WireCall[] };
let total = 2;

const isListing = (c: WireCall) => c.url.pathname === `${API}/files`;
const isMemberRoute = (c: WireCall) => c.url.pathname.endsWith("/query") || fileIdsOf(c) !== null;

function item(id: string) {
  return { id, filename: `${id}.md`, title: id, drive: DRIVE, folder_path: "", file_type: "text", mime_type: "text/markdown" };
}

beforeEach(() => {
  window.localStorage.clear();
  total = 2;
  wire = installWireFetch((call) => {
    const path = call.url.pathname;
    if (path === `${API}/smart-folders`) return json(FOLDERS);
    if (path === `${API}/collections`) return json([]);
    if (isListing(call) || path === `${API}/files/query`) {
      return pagedListing(Array.from({ length: total }, (_, i) => item(`n${i}`)), call);
    }
    if (path.startsWith(`${API}/shelves`)) {
      return json({ by: call.url.searchParams.get("by") ?? "all", base: "", total_shelves: 0, shelves: [] });
    }
    if (path.startsWith(`${API}/folder-counts`)) return json({ folders: [], total: 0 });
    return json([]);
  });
});

afterEach(() => vi.unstubAllGlobals());

async function resolve(app: (typeof APPS)[number], id: string) {
  window.localStorage.setItem(app.key, id);
  const hook = renderHook(() => useNotesTarget(DRIVE, app.app));
  await waitFor(() => expect(hook.result.current.target.status, "the target resolves").not.toBe("lookingUp"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return hook;
}

describe.each(APPS)("SPEC-ADDON-185 $label: a direct target with an exclusion", (app) => {
  it("SPEC-ADDON-185 resolves -path:Work to ready params carrying exclude_folder, with no member evaluation", async () => {
    const hook = await resolve(app, "sf-not-work");
    const target = hook.result.current.target;

    expect(target.status).toBe("ready");
    const ready = target as ReadyNotesTarget;
    expect(ready.fileIds).toBeNull();
    expect([ready.params?.exclude_folder].flat()).toEqual(["Work"]);
    expect(wire.calls.filter(isListing)).toEqual([]);
    expect(wire.calls.filter(isMemberRoute)).toEqual([]);
  });

  it("SPEC-ADDON-185 above 10,000 matching notes is still usable and ready", async () => {
    total = 10_001;
    const hook = await resolve(app, "sf-not-work");

    expect(hook.result.current.isUsable(FOLDERS[0])).toBe(true);
    expect(hook.result.current.target.status).toBe("ready");
    expect((hook.result.current.target as ReadyNotesTarget).fileIds).toBeNull();
  });

  it("SPEC-ADDON-185 I7 a new token with duration: stays a member target", async () => {
    const hook = await resolve(app, "sf-long");

    await waitFor(() => expect(wire.calls.some(isListing), "a member evaluation").toBe(true));
    for (const call of wire.calls.filter(isListing)) expect(paramsOf(call, "exclude_folder")).toEqual(["Work"]);
    await waitFor(() => expect(hook.result.current.target.status).toBe("ready"));
    expect((hook.result.current.target as ReadyNotesTarget).fileIds).not.toBeNull();
  });

  it.each(["sf-no-text", "sf-impossible"])(
    "SPEC-ADDON-185 I5 %s leaves nothing to request: an empty target and no listing request",
    async (id) => {
      const hook = await resolve(app, id);

      expect(hook.result.current.target.status).toBe("empty");
      expect(wire.calls.filter((c) => isListing(c) || c.url.pathname.startsWith(`${API}/shelves`))).toEqual([]);
    },
  );
});

function expectAllKeys(calls: WireCall[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(isMemberRoute(call), `${call.url}`).toBe(false);
    expect(paramsOf(call, "exclude_tag")).toEqual(["draft"]);
    expect(paramsOf(call, "exclude_type")).toEqual(["image"]);
    expect(paramsOf(call, "exclude_folder")).toEqual(["Work"]);
    expect(paramsOf(call, "exclude_collection")).toEqual(["Old"]);
    expect(paramsOf(call, "favorite")).toEqual(["false"]);
    expect(paramsOf(call, "liked")).toEqual(["false"]);
    expect(paramsOf(call, "has_tag")).toEqual(["true"]);
    expect(paramsOf(call, "has_collection")).toEqual(["false"]);
    expect(paramsOf(call, "type")).toEqual(["text"]);
  }
}

describe("SPEC-ADDON-185 I3 every request under the target carries all eight keys", () => {
  it("SPEC-ADDON-185 Notes' listing, tag shelves and folder counts", async () => {
    const hook = await resolve(APPS[0], "sf-every");
    expect(hook.result.current.target.status).toBe("ready");
    const target = hook.result.current.target as ReadyNotesTarget;
    const before = wire.calls.length;

    await listNotes(DRIVE, target, {});
    await listNoteTagShelves(DRIVE, target, { offset: 0, shelfLimit: 12 });
    await getNoteFolderCounts(DRIVE, target);

    const sent = wire.calls.slice(before);
    expect(sent.some((c) => c.url.pathname.startsWith(`${API}/folder-counts`))).toBe(true);
    expectAllKeys(sent);
  });

  it("SPEC-ADDON-185 Clips' count and shelf page, with origin fixed", async () => {
    const hook = await resolve(APPS[1], "sf-every");
    expect(hook.result.current.target.status).toBe("ready");
    const target = hook.result.current.target as ReadyNotesTarget;
    const before = wire.calls.length;

    await loadClipCount(DRIVE, target);
    await loadShelfPage(DRIVE, target, { kind: "new" }, { perShelf: 12, sort: "newest" });

    const sent = wire.calls.slice(before);
    expectAllKeys(sent);
    for (const call of sent) expect(paramsOf(call, "origin")).toEqual(["webclip"]);
  });
});
