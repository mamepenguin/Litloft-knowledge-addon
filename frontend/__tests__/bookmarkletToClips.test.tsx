/** SPEC-ADDON-100 I26: the bookmarklet handed out from now on opens Clips. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/drive/vault/addons/knowledge/clips",
}));
vi.mock("@/components/CurrentDriveProvider", () => ({ useCurrentDrive: () => "vault" }));
vi.mock("@/hooks/usePolicy", () => ({ usePolicy: () => ({ enabled: true, isLoading: false }) }));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocket: () => null }));
vi.mock("@/components/FolderPicker", () => ({ FolderPicker: () => null }));

// React replaces a `javascript:` href before it reaches the DOM, so the link the
// snippet hands the browser is read where the element is created.
const anchorHrefs = vi.hoisted(() => [] as string[]);
function recordAnchor(type: unknown, props: { href?: unknown } | null) {
  if (type === "a" && typeof props?.href === "string") anchorHrefs.push(props.href);
}
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: { href?: unknown } | null, ...rest: unknown[]) => {
      recordAnchor(type, props);
      return (actual.jsxDEV as (...a: unknown[]) => unknown)(type, props, ...rest);
    },
  };
});
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const wrap =
    (fn: (...a: unknown[]) => unknown) =>
    (type: unknown, props: { href?: unknown } | null, ...rest: unknown[]) => {
      recordAnchor(type, props);
      return fn(type, props, ...rest);
    };
  return {
    ...actual,
    jsx: wrap(actual.jsx as (...a: unknown[]) => unknown),
    jsxs: wrap(actual.jsxs as (...a: unknown[]) => unknown),
  };
});

const ClipSection = (await import("../ClipSection")).default;
const { ToastProvider } = await import("@/components/ToastProvider");
const { ShortcutsProvider } = await import("@/components/ShortcutsProvider");

afterEach(cleanup);

/** Runs each recorded bookmarklet on a page and returns the URLs it opens. */
function opened(): URL[] {
  const urls: URL[] = [];
  const page = { href: "https://example.com/a?b=1" };
  for (const href of anchorHrefs.filter((h) => h.startsWith("javascript:"))) {
    const code = decodeURIComponent(href.slice("javascript:".length));
    const win = { open: (u: string) => void urls.push(new URL(u, "http://litloft.local")), location: page };
    new Function("window", "location", "document", code)(win, page, { title: "A & B" });
  }
  return urls;
}

describe("SPEC-ADDON-100 I26 the bookmarklet snippet", () => {
  it("SPEC-ADDON-100 opens the Clips page with prefill, title and autosubmit", () => {
    render(
      <ToastProvider>
        <ShortcutsProvider>
          <ClipSection />
        </ShortcutsProvider>
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Bookmarklet" }));
    const urls = opened();

    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u.pathname).toBe("/drive/vault/addons/knowledge/clips");
      expect(Object.fromEntries(u.searchParams)).toEqual({
        prefill: "https://example.com/a?b=1",
        title: "A & B",
        autosubmit: "1",
      });
    }
  });
});
