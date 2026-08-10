import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import SearchCaptureActions from "./SearchCaptureActions";
import {
  addSourceCapture,
  clearSourceCaptures,
  getSourceCaptures,
  SOURCE_CAPTURE_LIMIT,
} from "@/lib/sourceCapture";

const transcriptCapture = {
  drive: "family",
  sourceFileId: "video123",
  filename: "lecture.mp4",
  fileType: "video",
  kind: "transcript" as const,
  locator: { seconds: 12, endSeconds: 18 },
  quote: "A long original transcript excerpt",
};

describe("SearchCaptureActions", () => {
  beforeEach(() => clearSourceCaptures("family"));

  it("adds the core-supplied capture verbatim", () => {
    render(<SearchCaptureActions capture={transcriptCapture} />);

    fireEvent.click(screen.getByRole("button"));

    expect(getSourceCaptures("family")).toEqual([
      expect.objectContaining({
        kind: "transcript",
        quote: "A long original transcript excerpt",
        locator: { seconds: 12, endSeconds: 18 },
      }),
    ]);
  });

  it("renders no excerpt of its own — the core owns the snippet", () => {
    render(<SearchCaptureActions capture={transcriptCapture} />);

    expect(
      screen.queryByText("A long original transcript excerpt"),
    ).not.toBeInTheDocument();
  });

  it("renders nothing when the core supplies no quotable evidence", () => {
    const { container } = render(<SearchCaptureActions />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not exceed the existing basket limit", () => {
    for (let index = 0; index < SOURCE_CAPTURE_LIMIT; index += 1) {
      addSourceCapture({
        drive: "family",
        sourceFileId: `source-${index}`,
        filename: `${index}.txt`,
        fileType: "document",
        kind: "document_selection",
        quote: `quote ${index}`,
      });
    }
    render(<SearchCaptureActions capture={{
      drive: "family",
      sourceFileId: "overflow",
      filename: "overflow.txt",
      fileType: "document",
      kind: "document_selection",
      quote: "overflow",
    }} />);

    fireEvent.click(screen.getByRole("button"));
    expect(getSourceCaptures("family")).toHaveLength(SOURCE_CAPTURE_LIMIT);
  });
});
