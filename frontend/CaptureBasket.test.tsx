import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import CaptureBasket from "@/addons/knowledge/CaptureBasket";
import { defaultCaptureFilename } from "@/addons/knowledge/CaptureBasket";
import {
  addSourceCapture,
  clearSourceCaptures,
} from "@/lib/sourceCapture";

describe("CaptureBasket", () => {
  beforeEach(() => {
    clearSourceCaptures("family");
    addSourceCapture({
      drive: "family",
      sourceFileId: "video123",
      filename: "lecture.mp4",
      fileType: "video",
      kind: "media_timestamp",
      locator: { seconds: 65 },
    });
  });

  it("keeps a capture deselected while its note is edited", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: "knowledge.captureBasket.title" }));

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.change(
      screen.getByPlaceholderText("knowledge.captureBasket.notePlaceholder"),
      { target: { value: "Follow up" } },
    );

    expect(checkbox).not.toBeChecked();
  });

  it("animates the backdrop and responsive basket sheet when opened", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: "knowledge.captureBasket.title" }));

    const dialog = screen.getByRole("dialog", {
      name: "knowledge.captureBasket.title",
    });
    expect(dialog.firstElementChild).toHaveClass("animate-fade-in");
    expect(dialog.querySelector("section")).toHaveClass(
      "animate-slide-up-bar",
      "sm:animate-slide-in-right",
    );
  });

  it("portals the basket and filename dialog outside the header stacking context", () => {
    render(
      <div data-testid="header-stacking-context">
        <CaptureBasket drive="family" />
      </div>,
    );
    const header = screen.getByTestId("header-stacking-context");
    fireEvent.click(
      within(header).getByRole("button", {
        name: "knowledge.captureBasket.title",
      }),
    );

    const basket = screen.getByRole("dialog", {
      name: "knowledge.captureBasket.title",
    });
    expect(header).not.toContainElement(basket);
    expect(basket.parentElement).toBe(document.body);

    fireEvent.click(
      within(basket).getByRole("button", {
        name: "knowledge.captureBasket.saveNew",
      }),
    );
    const filenameDialog = screen.getByRole("dialog", {
      name: "knowledge.captureBasket.saveNewTitle",
    });
    expect(header).not.toContainElement(filenameDialog);
    expect(filenameDialog.parentElement).toBe(document.body);
  });

  it("opens the filename dialog above the basket", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: "knowledge.captureBasket.title" }));
    fireEvent.click(
      screen.getByRole("button", { name: "knowledge.captureBasket.saveNew" }),
    );

    expect(
      screen.getByRole("dialog", { name: "knowledge.captureBasket.saveNewTitle" }),
    ).toHaveClass("z-[100]");
  });

  it("uses a collision-resistant timestamp in the default filename", () => {
    expect(defaultCaptureFilename(new Date(2026, 7, 10, 9, 5, 7, 42))).toBe(
      "captures-2026-08-10-090507-042.md",
    );
  });
});
