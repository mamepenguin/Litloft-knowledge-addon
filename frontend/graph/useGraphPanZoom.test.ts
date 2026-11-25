import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useGraphPanZoom } from "./useGraphPanZoom";

const realMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function reduceMotion(reduced: boolean | "absent") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value:
      reduced === "absent"
        ? undefined
        : (query: string) => ({
            matches: reduced && query.includes("prefers-reduced-motion: reduce"),
            media: query,
          }),
  });
}

function pointer(type: string, x: number, y: number): Event {
  const ev = new Event(type, { bubbles: true });
  return Object.assign(ev, { pointerId: 1, clientX: x, clientY: y });
}

/** Drags the graph and returns the animation frames requested after release. */
function dragAndRelease(): number {
  const { result } = renderHook(() => useGraphPanZoom());
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  // jsdom's zero-sized rect would make the fit ratio 0 and the pan NaN.
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1100, height: 620 }) as DOMRect;
  svg.setPointerCapture = () => {};
  svg.releasePointerCapture = () => {};
  act(() => result.current.attachRef(svg));

  act(() => {
    svg.dispatchEvent(pointer("pointerdown", 100, 100));
    svg.dispatchEvent(pointer("pointermove", 120, 110));
    svg.dispatchEvent(pointer("pointermove", 160, 130));
  });
  const raf = vi.mocked(window.requestAnimationFrame);
  raf.mockClear();
  act(() => {
    svg.dispatchEvent(pointer("pointerup", 160, 130));
  });
  return raf.mock.calls.length;
}

describe("useGraphPanZoom inertia", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (realMatchMedia) Object.defineProperty(window, "matchMedia", realMatchMedia);
    else delete (window as Partial<Window>).matchMedia;
  });

  it("SPEC-ADDON-186 I6 I12 releasing a drag schedules no inertia frame under reduced motion, and does otherwise", () => {
    reduceMotion(true);
    expect(dragAndRelease()).toBe(0);

    reduceMotion(false);
    expect(dragAndRelease()).toBe(1);

    reduceMotion("absent");
    expect(dragAndRelease()).toBe(1);
  });
});
