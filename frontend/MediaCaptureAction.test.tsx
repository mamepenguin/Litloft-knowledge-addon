import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import MediaCaptureAction from "@/addons/knowledge/MediaCaptureAction";
import type { MediaController } from "@/lib/mediaController";
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
});
