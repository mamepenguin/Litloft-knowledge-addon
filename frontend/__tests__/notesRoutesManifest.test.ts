/**
 * SPEC-ADDON-131 touch points: the two new Knowledge routes go through the
 * drive-scoped addon proxy, so `X-Lit-Drive` is required and checked.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ADDON_ROOT = resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), "..", "..");

const manifest = JSON.parse(readFileSync(resolve(ADDON_ROOT, "manifest.json"), "utf-8")) as {
  scope: string;
  proxy: { routes: { path: string; methods: string[]; drive_optional?: boolean }[] };
};

describe("SPEC-ADDON-131 the proxy routes for notes with sources", () => {
  it.each([
    ["/notes/with-sources", ["GET"]],
    ["/notes/sources", ["POST"]],
  ])("SPEC-ADDON-131 %s is proxied for %j and is not drive_optional", (path, methods) => {
    const route = manifest.proxy.routes.find((r) => r.path === path);

    expect(manifest.scope).toBe("drive");
    expect(route?.methods).toEqual(methods);
    expect(route?.drive_optional ?? false).toBe(false);
  });
});
