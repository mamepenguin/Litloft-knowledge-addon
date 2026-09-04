import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import MediaCaptureAction from "@/addons/knowledge/MediaCaptureAction";
import type { MediaController } from "@/lib/mediaController";
import { DocumentCaptureStore } from "@/lib/documentCapture";
import {
  clearSourceCaptures,
  getSourceCaptures,
} from "@/lib/sourceCapture";

describe("MediaCaptureAction", () => {
  beforeEach(() => clearSourceCaptures("family"));

  it("captures the current media position", () => {
    const mediaController = {
      getCurrentTime: () => 65.8,
    } as MediaController;

    render(
      <MediaCaptureAction
        fileId="video123"
        drive="family"
        filename="lecture.mp4"
        fileType="video"
        mediaController={mediaController}
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    expect(getSourceCaptures("family")).toEqual([
      expect.objectContaining({
        sourceFileId: "video123",
        filename: "lecture.mp4",
        kind: "media_timestamp",
        locator: { seconds: 65 },
      }),
    ]);
  });

  it("does not render before the player controller is ready", () => {
    const { container } = render(
      <MediaCaptureAction
        fileId="video123"
        drive="family"
        filename="lecture.mp4"
        fileType="video"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("captures selected document text with its heading", () => {
    const documentCaptureController = new DocumentCaptureStore();
    documentCaptureController.setCapture({
      kind: "selection",
      quote: "A selected paragraph",
      locator: { label: "Introduction" },
      anchor: { left: 120, top: 160, width: 80, height: 20 },
    });

    render(
      <MediaCaptureAction
        fileId="markdown1234"
        drive="family"
        filename="guide.md"
        fileType="document"
        documentCaptureController={documentCaptureController}
      />,
    );
    const captureButton = screen.getByRole("button");
    expect(captureButton).toHaveClass("bg-bg-card");
    fireEvent.click(captureButton);

    expect(getSourceCaptures("family")).toEqual([
      expect.objectContaining({
        kind: "document_selection",
        quote: "A selected paragraph",
        locator: { label: "Introduction" },
      }),
    ]);
  });

  it("captures the current PDF page when no text can be selected", () => {
    const documentCaptureController = new DocumentCaptureStore();
    documentCaptureController.setCapture({
      kind: "page",
      locator: { page: 6 },
    });

    render(
      <MediaCaptureAction
        fileId="pdf123456789"
        drive="family"
        filename="scan.pdf"
        fileType="document"
        documentCaptureController={documentCaptureController}
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    expect(getSourceCaptures("family")).toEqual([
      expect.objectContaining({
        kind: "pdf_page",
        locator: { page: 6 },
        quote: undefined,
      }),
    ]);
  });
});

describe("MediaCaptureAction — an icon on its own", () => {
  beforeEach(() => clearSourceCaptures("family"));

  it("says what it does, in a row where nothing else will", () => {
    // The only content is a lucide glyph, so the name is entirely in
    // `aria-label`. It used to sit under the player, where the thing it
    // acts on was on screen beside it; it now sits in the file's action
    // row between the favourite toggle and `[...]`, where a reader has
    // only the name to go on (hako Prwd_iaXmCjWfY24KjFz2).
    render(
      <MediaCaptureAction
        fileId="video123"
        drive="family"
        filename="lecture.mp4"
        fileType="video"
        mediaController={{ getCurrentTime: () => 1 } as MediaController}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Capture current position" }),
    ).toBeInTheDocument();
  });

  it("changes its name with what it would capture", () => {
    const documentCaptureController = new DocumentCaptureStore();
    documentCaptureController.setCapture({
      kind: "page",
      quote: "",
      locator: { page: 12 },
    });

    render(
      <MediaCaptureAction
        fileId="doc1"
        drive="family"
        filename="paper.pdf"
        fileType="document"
        documentCaptureController={documentCaptureController}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Add current page to capture basket" }),
    ).toBeInTheDocument();
  });

  it("keeps a 44px target where the pointer is coarse", () => {
    // The host row grows its children to 44px, but only its compact
    // variant does and "compact" is a viewport-width test — so a
    // coarse-pointer tablet at 768px or wider gets the full row, which
    // has no such rule. `classList`, not `toContain`: "h-11" is a
    // substring of "pointer-coarse:h-11".
    render(
      <MediaCaptureAction
        fileId="video123"
        drive="family"
        filename="lecture.mp4"
        fileType="video"
        mediaController={{ getCurrentTime: () => 1 } as MediaController}
      />,
    );

    const button = screen.getByRole("button");
    expect(button.classList.contains("pointer-coarse:h-11")).toBe(true);
    expect(button.classList.contains("pointer-coarse:w-11")).toBe(true);
    // And still the drawn size on a fine pointer, which clears the
    // 24×24 minimum for a repeated icon-only control.
    expect(button.classList.contains("h-9")).toBe(true);
    expect(button.classList.contains("w-9")).toBe(true);
  });
});

