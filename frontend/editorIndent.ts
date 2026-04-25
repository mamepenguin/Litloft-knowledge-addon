export const INDENT = "  ";

export function applyIndent(
  text: string,
  selStart: number,
  selEnd: number,
  outdent: boolean,
): { text: string; selStart: number; selEnd: number } {
  const hasSelection = selStart !== selEnd;
  const isMultiLine =
    hasSelection && text.slice(selStart, selEnd).includes("\n");

  if (!isMultiLine && !outdent) {
    const newText = text.slice(0, selStart) + INDENT + text.slice(selEnd);
    const caret = selStart + INDENT.length;
    return { text: newText, selStart: caret, selEnd: caret };
  }

  const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;

  let effectiveEnd = selEnd;
  if (hasSelection && selEnd > selStart && text[selEnd - 1] === "\n") {
    effectiveEnd = selEnd - 1;
  }
  let blockEnd = text.indexOf("\n", effectiveEnd);
  if (blockEnd === -1) blockEnd = text.length;

  const lines = text.slice(lineStart, blockEnd).split("\n");

  let firstDelta = 0;
  let totalDelta = 0;
  const transformed = lines.map((line, i) => {
    if (outdent) {
      let removed = 0;
      if (line.startsWith("\t")) {
        removed = 1;
      } else {
        const m = line.match(/^ {1,2}/);
        if (m) removed = m[0].length;
      }
      if (i === 0) firstDelta = -removed;
      totalDelta -= removed;
      return line.slice(removed);
    }
    if (i === 0) firstDelta = INDENT.length;
    totalDelta += INDENT.length;
    return INDENT + line;
  });

  const newText =
    text.slice(0, lineStart) + transformed.join("\n") + text.slice(blockEnd);

  const newSelStart = Math.max(lineStart, selStart + firstDelta);
  const newSelEnd = Math.max(newSelStart, selEnd + totalDelta);

  return { text: newText, selStart: newSelStart, selEnd: newSelEnd };
}
