import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import CaptureBasket from "@/addons/knowledge/CaptureBasket";
import { defaultCaptureFilename } from "@/addons/knowledge/CaptureBasket";
import {
  addSourceCapture,
  clearSourceCaptures,
} from "@/lib/sourceCapture";

const TITLE = /Capture basket|knowledge\.captureBasket\.title/;
const NOTE_PLACEHOLDER = /Add a note|knowledge\.captureBasket\.notePlaceholder/;
const OTHER_METHODS = /Other save methods|knowledge\.captureBasket\.otherSaveMethods/;
const SAVE_NEW = /Save \d+ captures|knowledge\.captureBasket\.saveNew/;
const SAVE_NEW_TITLE = /Save capture note|knowledge\.captureBasket\.saveNewTitle/;
const QUICK_APPEND = /Append to Inbox\.md|knowledge\.captureBasket\.quickAppend/;

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
    fireEvent.click(screen.getByRole("button", { name: TITLE }));

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.change(
      screen.getByPlaceholderText(NOTE_PLACEHOLDER),
      { target: { value: "Follow up" } },
    );

    expect(checkbox).not.toBeChecked();
  });

  it("animates the backdrop and responsive basket sheet when opened", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: TITLE }));

    const dialog = screen.getByRole("dialog", {
      name: TITLE,
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
        name: TITLE,
      }),
    );

    const basket = screen.getByRole("dialog", {
      name: TITLE,
    });
    expect(header).not.toContainElement(basket);
    expect(basket.parentElement).toBe(document.body);

    fireEvent.click(
      within(basket).getByRole("button", {
        name: OTHER_METHODS,
      }),
    );
    fireEvent.click(
      within(basket).getByRole("button", {
        name: SAVE_NEW,
      }),
    );
    const filenameDialog = screen.getByRole("dialog", {
      name: SAVE_NEW_TITLE,
    });
    expect(header).not.toContainElement(filenameDialog);
    expect(filenameDialog.parentElement).toBe(document.body);
  });

  it("opens the filename dialog above the basket", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(screen.getByRole("button", { name: TITLE }));
    fireEvent.click(
      screen.getByRole("button", {
        name: OTHER_METHODS,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: SAVE_NEW }),
    );

    expect(
      screen.getByRole("dialog", { name: SAVE_NEW_TITLE }),
    ).toHaveClass("z-[100]");
  });

  it("uses a collision-resistant timestamp in the default filename", () => {
    expect(defaultCaptureFilename(new Date(2026, 7, 10, 9, 5, 7, 42))).toBe(
      "captures-2026-08-10-090507-042.md",
    );
  });

  it("shows the fixed default destination as the primary action", () => {
    render(<CaptureBasket drive="family" />);
    fireEvent.click(
      screen.getByRole("button", { name: TITLE }),
    );

    expect(
      screen.getByRole("button", {
        name: QUICK_APPEND,
      }),
    ).toBeVisible();
    expect(screen.getByText("Captures/Inbox.md")).toBeVisible();
  });
});
