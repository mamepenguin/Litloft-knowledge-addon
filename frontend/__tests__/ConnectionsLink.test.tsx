import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ""}.${key}`,
}));

const ConnectionsLink = (await import("../ConnectionsLink")).default;

describe("the connections link in the Related tab", () => {
  afterEach(cleanup);

  it.each([
    ["a Markdown note", "note.md", "text/markdown"],
    ["a Markdown file with no recorded mime", "note.markdown", null],
    ["a plain text file", "todo.txt", "text/plain"],
  ])("links %s to this drive's connections graph, centred on the file", (_, filename, mimeType) => {
    render(
      <ConnectionsLink drive="動画 d" fileId="ab/c d" filename={filename} mimeType={mimeType} />,
    );

    const link = screen.getByRole("link", { name: "knowledge.related.seeConnections" });
    expect(link).toHaveAttribute(
      "href",
      `/drive/${encodeURIComponent("動画 d")}/addons/knowledge/connections?focus=${encodeURIComponent("ab/c d")}`,
    );
  });

  it.each([
    ["a video", "clip.mp4", "video/mp4"],
    ["a PDF", "paper.pdf", "application/pdf"],
    ["source code with a text mime", "main.c", "text/plain"],
    ["an HTML file", "page.html", "text/html"],
  ])("renders nothing for %s", (_, filename, mimeType) => {
    const { container } = render(
      <ConnectionsLink drive="d" fileId="f1" filename={filename} mimeType={mimeType} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
