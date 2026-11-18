/** SPEC-ADDON-140 item 15 and SPEC-ADDON-138 step 9: what a card and a row draw from a clip. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { FileItem } from "@/types";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

const { default: ClipCard, clipTitle, coverSrc, readingMinutes } = await import("../ClipCard");
const { default: ClipRow } = await import("../ClipRow");

afterEach(cleanup);

const file = (extra: Partial<FileItem> = {}) =>
  ({
    id: "f1",
    filename: "salmon-bowl.md",
    title: "Salmon bowl",
    drive: "d",
    folder_path: "web",
    file_size: 3000,
    created_at: "2026-09-01T09:00:00Z",
    ...extra,
  }) as FileItem;
const NOW = new Date("2026-11-18T09:00:00Z");

describe("SPEC-ADDON-140 the reading time", () => {
  it.each([
    [0, 1],
    [100, 1],
    [1500, 1],
    [2249, 1],
    [2250, 2],
    [4500, 3],
    [15000, 10],
  ])("reads %s bytes as %s min: max(1, round(size / 1500))", (size, minutes) => {
    expect(readingMinutes(size)).toBe(minutes);
  });
});

describe("SPEC-ADDON-138 the card's title", () => {
  it("is the title, else the filename without its extension", () => {
    expect(clipTitle(file())).toBe("Salmon bowl");
    expect(clipTitle(file({ title: "" }))).toBe("salmon-bowl");
  });
});

describe("SPEC-ADDON-140 the cover source", () => {
  it("prefers the core thumbnail of a loft image, else the external URL, else none", () => {
    expect(coverSrc({ image_id: "i1", image_url: "https://x/y.jpg", site: null })).toEqual({ src: "/api/files/i1/thumbnail", external: false });
    expect(coverSrc({ image_id: null, image_url: "https://x/y.jpg", site: null })).toEqual({ src: "https://x/y.jpg", external: true });
    expect(coverSrc({ image_id: null, image_url: null, site: "a.com" })).toBeNull();
    expect(coverSrc(undefined)).toBeNull();
  });
});

describe("SPEC-ADDON-138 the card", () => {
  it("draws site, minutes and age on Home and site and minutes in the Library, with no site until it is known", () => {
    const { rerender } = render(<ClipCard file={file()} cover={{ image_id: null, image_url: null, site: "a.com" }} dot={false} now={NOW} showAge />);
    expect(screen.getByText(/^a\.com · 2 min · /)).toBeInTheDocument();

    rerender(<ClipCard file={file()} cover={{ image_id: null, image_url: null, site: "a.com" }} dot={false} now={NOW} showAge={false} />);
    expect(screen.getByText("a.com · 2 min")).toBeInTheDocument();

    rerender(<ClipCard file={file()} cover={undefined} dot={false} now={NOW} showAge={false} />);
    expect(screen.getByText("2 min")).toBeInTheDocument();
  });

  it("SPEC-ADDON-138 draws the age as a relative age of created_at, on a card and on an Unverified row", () => {
    const created_at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { unmount } = render(<ClipCard file={file({ created_at })} cover={undefined} dot={false} now={NOW} showAge />);
    expect(screen.getByText("2 min · 3 days ago")).toBeInTheDocument();
    unmount();
    render(<ClipRow file={file({ created_at })} cover={undefined} now={NOW} status="idle" onVerify={() => {}} />);
    expect(screen.getByText("3 days ago")).toBeInTheDocument();
  });

  it("puts the Unread label inside the card link", () => {
    render(<ClipCard file={file()} cover={undefined} dot now={NOW} showAge />);
    const link = screen.getByRole("link");
    expect(link).toContainElement(screen.getByText("Unread"));
  });

  it("draws the dot only when told to", () => {
    const { rerender } = render(<ClipCard file={file()} cover={undefined} dot now={NOW} showAge />);
    expect(screen.getByTestId("unread-dot")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("link").textContent).toContain("Unread");
    expect(screen.getByRole("link", { name: /Unread/ })).toBeInTheDocument();
    rerender(<ClipCard file={file()} cover={undefined} dot={false} now={NOW} showAge />);
    expect(screen.queryByTestId("unread-dot")).toBeNull();
    expect(screen.getByRole("link").textContent).not.toContain("Unread");
  });

  it("puts the picture back when a new cover arrives after the old one failed", () => {
    const { rerender } = render(
      <ClipCard file={file()} cover={{ image_id: null, image_url: "https://x/a.jpg", site: null }} dot={false} now={NOW} showAge />,
    );
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("img")).toBeNull();

    rerender(<ClipCard file={file()} cover={{ image_id: null, image_url: "https://x/b.jpg", site: null }} dot={false} now={NOW} showAge />);
    expect(document.querySelector("img")).toHaveAttribute("src", "https://x/b.jpg");
  });
});

describe("SPEC-ADDON-138 the Unverified row", () => {
  it.each([
    ["idle", true, false],
    ["saving", false, false],
    ["failed", true, true],
  ] as const)("draws the %s state: button enabled %s, Couldn't save shown %s", (status, enabled, failed) => {
    const onVerify = vi.fn();
    render(<ClipRow file={file()} cover={undefined} now={NOW} status={status} onVerify={onVerify} />);

    const button = screen.getByRole("button", { name: "Mark as verified" });
    expect(button.hasAttribute("disabled")).toBe(!enabled);
    expect(screen.queryByText("Couldn't save") !== null).toBe(failed);
    fireEvent.click(button);
    expect(onVerify).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });

  it("draws the title on one line with site and age under it and no minutes", () => {
    render(<ClipRow file={file()} cover={{ image_id: null, image_url: null, site: "a.com" }} now={NOW} status="idle" onVerify={() => {}} />);

    expect(screen.getByText("Salmon bowl").className).toContain("truncate");
    expect(screen.getByText(/^a\.com · /).textContent).not.toMatch(/min/);
  });
});
