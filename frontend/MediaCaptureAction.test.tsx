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
    expect(captureButton).not.toHaveClass("bg-bg-surface");
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
