import { afterEach, describe, expect, it } from "vitest";
import {
  MIRRORED_PROPERTIES,
  __resetCaretMirrorForTests,
  getCaretCoordinates,
} from "../textareaCaret";

afterEach(() => {
  __resetCaretMirrorForTests();
  document.body.innerHTML = "";
});

describe("getCaretCoordinates", () => {
  it("mirrors all properties required to reproduce wrapping", () => {
    const required = [
      "boxSizing",
      "width",
      "borderTopWidth",
      "paddingLeft",
      "paddingTop",
      "fontFamily",
      "fontSize",
      "lineHeight",
      "letterSpacing",
      "tabSize",
      "whiteSpace",
      "wordWrap",
    ];
    for (const prop of required) {
      expect(MIRRORED_PROPERTIES).toContain(prop);
    }
  });

  it("returns numeric coordinates and height for offset 0", () => {
    const ta = document.createElement("textarea");
    ta.value = "hello world";
    document.body.appendChild(ta);

    const coords = getCaretCoordinates(ta, 0);
    expect(typeof coords.top).toBe("number");
    expect(typeof coords.left).toBe("number");
    expect(typeof coords.height).toBe("number");
    expect(Number.isFinite(coords.top)).toBe(true);
    expect(Number.isFinite(coords.left)).toBe(true);
    expect(Number.isFinite(coords.height)).toBe(true);
    expect(coords.height).toBeGreaterThanOrEqual(0);
  });

  it("clamps out-of-range offsets to the valid value range", () => {
    const ta = document.createElement("textarea");
    ta.value = "abc";
    document.body.appendChild(ta);

    // Negative and beyond-length offsets must not throw.
    expect(() => getCaretCoordinates(ta, -10)).not.toThrow();
    expect(() => getCaretCoordinates(ta, 999)).not.toThrow();
  });

  it("reuses the mirror element across calls", () => {
    const ta = document.createElement("textarea");
    ta.value = "x";
    document.body.appendChild(ta);

    getCaretCoordinates(ta, 0);
    const first = document.querySelectorAll(
      "[data-testid='textarea-caret-mirror']",
    ).length;
    getCaretCoordinates(ta, 1);
    const second = document.querySelectorAll(
      "[data-testid='textarea-caret-mirror']",
    ).length;
    expect(first).toBe(1);
    expect(second).toBe(1);
  });
});
