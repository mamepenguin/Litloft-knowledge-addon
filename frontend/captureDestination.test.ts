import { beforeEach, describe, expect, it } from "vitest";

import {
  FALLBACK_CAPTURE_DESTINATION,
  captureDestinationForDate,
  readCaptureDestination,
  writeCaptureDestination,
} from "./captureDestination";

describe("captureDestination", () => {
  beforeEach(() => localStorage.clear());

  it("falls back when stored JSON is corrupt", () => {
    localStorage.setItem("knowledge:captureDestination:family", "{");

    expect(readCaptureDestination("family")).toEqual(
      FALLBACK_CAPTURE_DESTINATION,
    );
  });

  it("falls back when the stored folder is unsafe", () => {
    localStorage.setItem(
      "knowledge:captureDestination:family",
      JSON.stringify({ folder: "../private", mode: "daily" }),
    );

    expect(readCaptureDestination("family")).toEqual(
      FALLBACK_CAPTURE_DESTINATION,
    );
  });

  it("falls back when a folder component is reserved by Core", () => {
    localStorage.setItem(
      "knowledge:captureDestination:family",
      JSON.stringify({ folder: "NUL/notes", mode: "daily" }),
    );

    expect(readCaptureDestination("family")).toEqual(
      FALLBACK_CAPTURE_DESTINATION,
    );
  });

  it("stores settings per drive", () => {
    writeCaptureDestination("family", { folder: "/Journal/", mode: "daily" });

    expect(readCaptureDestination("family")).toEqual({
      folder: "Journal",
      mode: "daily",
    });
    expect(readCaptureDestination("work")).toEqual(
      FALLBACK_CAPTURE_DESTINATION,
    );
  });

  it("builds daily filenames from browser-local date", () => {
    expect(
      captureDestinationForDate(
        { folder: "Journal", mode: "daily" },
        new Date(2026, 7, 10, 23, 59, 59),
      ),
    ).toEqual({ folder: "Journal", filename: "2026-08-10.md" });
  });
});
