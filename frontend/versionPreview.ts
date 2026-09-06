/**
 * Read-only rendering helpers for a stored version's body.
 *
 * The preview deliberately shows the raw Markdown source — the point of
 * the panel is to see what is saved, and rendering it would hide that.
 * The one exception is the case that made the panel unreadable: a table of
 * contents written by the editor's heading links, where every entry is a
 * percent-encoded fragment — `[はじめに](#1-%E3%81%AF%E3%81%98%E3%82%81%E3%81%AB)`.
 *
 * So the exception is exactly that shape and nothing wider: a destination
 * that is a bare `#` fragment, with no whitespace, parentheses, quotes,
 * brackets or angle brackets in it, inside a link whose label brackets
 * balance, outside of code.
 *
 * Three earlier attempts here tried to decode *any* link destination, and
 * each review found more Markdown that a hand-written scanner reads wrong
 * — titles, balanced parentheses in a URL, angle-bracket forms, escapes
 * inside them. Link destinations are a real grammar, and this module is a
 * display convenience on a view whose whole promise is fidelity, so it
 * does not try to be a parser. Anything that is not plainly the shape
 * above is left exactly as written: the unhandled path does nothing rather
 * than something wrong.
 */

/**
 * A destination that is safe to decode: `#` then characters that cannot
 * start a title, close the link early, or nest anything.
 */
const HEADING_ANCHOR = /^#[^\s()<>"'`\[\]\\]*\)/;

/**
 * A version's body is arbitrary text and may hold a lone `%`, on which
 * `decodeURIComponent` throws. Then the anchor is returned as written.
 */
function decodeAnchor(anchor: string): string {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}

export function decodeLinkTargets(source: string): string {
  const out: string[] = [];
  let i = 0;
  let atLineStart = true;
  /** The run that opened the current fence, or null outside one. */
  let fence: string | null = null;
  /** Whether an indented code block is running. */
  let indentedCode = false;
  /** Whether the previous line was blank, which is what may start one. */
  let afterBlankLine = true;
  /**
   * The open `[` on this line, innermost last, each remembering whether it
   * was an image opener. Labels nest — `[outer [inner]](#x)` is one link.
   */
  let labels: boolean[] = [];
  /** Whether the open label already holds a link, which voids the outer one. */
  let labelHasLink = false;

  while (i < source.length) {
    if (atLineStart) {
      const newline = source.indexOf("\n", i);
      const stop = newline === -1 ? source.length : newline;
      const line = source.slice(i, stop);

      const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const run = fenceMatch[1];
        if (fence === null) fence = run;
        // A fence opened with four backticks is not closed by three.
        else if (run[0] === fence[0] && run.length >= fence.length) fence = null;
        afterBlankLine = false;
        out.push(line);
        i = stop;
        atLineStart = false;
        continue;
      }

      if (fence === null) {
        const blank = line.trim() === "";
        const indented = /^(?: {4}|\t)/.test(line);
        // Four spaces after a blank line opens an indented code block, and it
        // runs until a line that is neither blank nor indented — a second
        // indented line is a continuation, not a new opening.
        if (indentedCode) indentedCode = blank || indented;
        else if (afterBlankLine && indented) indentedCode = true;
        afterBlankLine = blank;

        if (indentedCode) {
          out.push(line);
          i = stop;
          atLineStart = false;
          continue;
        }
      }
    }

    const ch = source[i];

    if (ch === "\n") {
      out.push(ch);
      i += 1;
      atLineStart = true;
      labels = [];
      labelHasLink = false;
      continue;
    }
    atLineStart = false;

    if (fence !== null) {
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch === "`") {
      const run = /^`+/.exec(source.slice(i))![0];
      const close = source.indexOf(run, i + run.length);
      if (close === -1) {
        // An unmatched backtick is literal text, and the links after it are
        // still links — skipping to the end of the file would lose them all.
        out.push(run);
        i += run.length;
        continue;
      }
      out.push(source.slice(i, close + run.length));
      i = close + run.length;
      continue;
    }

    if (ch === "\\") {
      out.push(source.slice(i, i + 2));
      i += 2;
      continue;
    }

    if (ch === "[") {
      // `![` opens an image, and an image inside a link is allowed.
      labels.push(source[i - 1] === "!" && source[i - 2] !== "\\");
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch === "]") {
      // A label has to have been open: a bare `]` with no `[` before it is
      // ordinary text, and `plain ](#x)` is not a link.
      const wasImage = labels.pop() ?? null;
      const closesLabel = wasImage !== null && labels.length === 0;
      // Markdown forbids a link inside a link, so an inner one voids the
      // outer opener and `[outer [inner](url)](#x)` ends as literal text.
      // An image is not a link, so `[![alt](img.png)](#x)` still decodes.
      if (!closesLabel && wasImage === false && source[i + 1] === "(") {
        labelHasLink = true;
      }
      // `wasImage === false`: an outer `![…](…)` is an image, and its
      // destination is a file path, not a heading anchor to make readable.
      if (closesLabel && wasImage === false && !labelHasLink && source[i + 1] === "(") {
        const match = HEADING_ANCHOR.exec(source.slice(i + 2));
        if (match) {
          const anchor = match[0].slice(0, -1);
          out.push(`](${decodeAnchor(anchor)})`);
          i += 2 + match[0].length;
          labelHasLink = false;
          continue;
        }
      }
      if (closesLabel) labelHasLink = false;
      out.push(ch);
      i += 1;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out.join("");
}
