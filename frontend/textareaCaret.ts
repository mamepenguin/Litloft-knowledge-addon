/**
 * Caret coordinate measurement for ``<textarea>``.
 *
 * Used by the wiki-link autocomplete to anchor its dropdown directly
 * below the ``[[`` trigger. ``<textarea>`` does not expose caret pixel
 * coordinates, so we render an off-screen mirror ``<div>`` with the same
 * text and computed styles, insert a marker ``<span>`` at the offset of
 * interest, and read its ``offsetTop`` / ``offsetLeft`` / ``offsetHeight``.
 *
 * Returned coordinates are in the textarea's own coordinate space (the
 * inside of its content box, with ``scrollTop`` / ``scrollLeft`` already
 * subtracted). Callers add ``getBoundingClientRect()`` of the textarea
 * to convert to viewport coordinates.
 */

export interface CaretCoords {
  top: number;
  left: number;
  height: number;
}

export const MIRRORED_PROPERTIES = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "whiteSpace",
  "wordWrap",
  "overflowWrap",
] as const;

let cachedMirror: HTMLDivElement | null = null;

function getMirror(): HTMLDivElement {
  if (cachedMirror && cachedMirror.isConnected) return cachedMirror;
  const div = document.createElement("div");
  div.setAttribute("data-testid", "textarea-caret-mirror");
  div.setAttribute("aria-hidden", "true");
  const style = div.style;
  style.position = "absolute";
  style.visibility = "hidden";
  style.top = "0";
  style.left = "0";
  style.pointerEvents = "none";
  document.body.appendChild(div);
  cachedMirror = div;
  return div;
}

export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  offset: number,
): CaretCoords {
  const mirror = getMirror();
  const computed = window.getComputedStyle(textarea);
  for (const prop of MIRRORED_PROPERTIES) {
    mirror.style[prop as never] = computed[prop as never];
  }
  // ``<textarea>`` always wraps the way ``white-space: pre-wrap`` does.
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";

  const value = textarea.value;
  const safeOffset = Math.max(0, Math.min(offset, value.length));
  const before = value.substring(0, safeOffset);
  const after = value.substring(safeOffset) || ".";

  mirror.textContent = "";
  mirror.appendChild(document.createTextNode(before));
  const marker = document.createElement("span");
  marker.textContent = after.charAt(0);
  mirror.appendChild(marker);
  if (after.length > 1) {
    mirror.appendChild(document.createTextNode(after.substring(1)));
  }

  const top = marker.offsetTop - textarea.scrollTop;
  const left = marker.offsetLeft - textarea.scrollLeft;
  const height = marker.offsetHeight;

  return { top, left, height };
}

export function __resetCaretMirrorForTests(): void {
  if (cachedMirror && cachedMirror.isConnected) {
    cachedMirror.remove();
  }
  cachedMirror = null;
}
