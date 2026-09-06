/**
 * Read-only rendering helpers for a stored version's body.
 *
 * The preview deliberately shows the raw Markdown source — the point of
 * the panel is to see what is saved, and rendering it would hide that.
 * The one exception is link destinations: an anchor written by the
 * editor's heading links arrives percent-encoded, so a table of contents
 * reads `[はじめに](#1-%E3%81%AF%E3%81%98%E3%82%81%E3%81%AB)` and a page
 * of it is unreadable.
 *
 * Because the promise is fidelity, that exception is kept as narrow as it
 * can be: only the URL of a real inline link is decoded. Code — fenced,
 * indented, or inline — is copied through untouched, a `](` with no
 * `[label]` in front of it is not a link, and a link's title keeps its own
 * escapes. Everything the scanner is unsure of is left exactly as written,
 * which is the safe direction for a view whose job is fidelity.
 */

interface Destination {
  /** Where the URL starts, after any leading whitespace. */
  urlStart: number;
  /** Where the URL ends, before any title. */
  urlEnd: number;
  /** The index of the closing `)`. */
  end: number;
}

/**
 * Reads an inline link destination starting just after `](`.
 *
 * Returns `null` for anything it cannot read confidently — an unbalanced
 * parenthesis, a run past the end of the line, an unterminated title —
 * which leaves the source untouched.
 */
function readDestination(source: string, start: number): Destination | null {
  const spaces = /[ \t]/;
  let i = start;
  while (i < source.length && spaces.test(source[i])) i += 1;

  const urlStart = i;
  if (source[i] === "<") {
    const close = source.indexOf(">", i + 1);
    const newline = source.indexOf("\n", i + 1);
    if (close === -1 || (newline !== -1 && newline < close)) return null;
    i = close + 1;
  } else {
    let depth = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "\n") return null;
      if (spaces.test(ch)) break;
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      i += 1;
    }
    if (depth !== 0) return null;
  }
  const urlEnd = i;

  // A title is read but never decoded, and its parentheses are the title's,
  // not the destination's — counting them never lets the link close.
  while (i < source.length && spaces.test(source[i])) i += 1;
  const quote = source[i];
  if (quote === '"' || quote === "'") {
    i += 1;
    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\\") i += 1;
      else if (source[i] === "\n") return null;
      i += 1;
    }
    if (i >= source.length) return null;
    i += 1;
    while (i < source.length && spaces.test(source[i])) i += 1;
  }

  if (source[i] !== ")") return null;
  return { urlStart, urlEnd, end: i };
}

/**
 * A version's body is arbitrary text and may hold a lone `%`, on which
 * `decodeURIComponent` throws. Then the URL is returned as written.
 */
function decodeUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

export function decodeLinkTargets(source: string): string {
  const out: string[] = [];
  let i = 0;
  let atLineStart = true;
  /** The run that opened the current fence, or null outside one. */
  let fence: string | null = null;
  /** Whether the previous line was blank, for indented code blocks. */
  let afterBlankLine = true;
  let labelOpen = false;

  const copyLine = () => {
    const newline = source.indexOf("\n", i);
    const stop = newline === -1 ? source.length : newline;
    out.push(source.slice(i, stop));
    i = stop;
    atLineStart = false;
  };

  while (i < source.length) {
    if (atLineStart) {
      const line = source.slice(i, (source.indexOf("\n", i) + 1 || source.length + 1) - 1);

      const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const run = fenceMatch[1];
        if (fence === null) {
          fence = run;
        } else if (run[0] === fence[0] && run.length >= fence.length) {
          // A fence opened with four backticks is not closed by three.
          fence = null;
        }
        afterBlankLine = false;
        copyLine();
        continue;
      }

      if (fence === null) {
        // An indented code block: four spaces, where a paragraph is not
        // already running. Its contents are code and stay as written.
        if (afterBlankLine && /^(?: {4}|\t)/.test(line)) {
          afterBlankLine = false;
          copyLine();
          continue;
        }
        afterBlankLine = line.trim() === "";
      }
    }

    const ch = source[i];

    if (ch === "\n") {
      out.push(ch);
      i += 1;
      atLineStart = true;
      labelOpen = false;
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
      labelOpen = true;
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch === "]") {
      // Every closing bracket ends its label, whether or not a `(` follows.
      // Otherwise `[closed] text ](#x)` would read the second `](` as a link.
      const wasOpen = labelOpen;
      labelOpen = false;
      if (wasOpen && source[i + 1] === "(") {
        const destination = readDestination(source, i + 2);
        if (destination) {
          const { urlStart, urlEnd, end } = destination;
          out.push(
            `](${source.slice(i + 2, urlStart)}${decodeUrl(
              source.slice(urlStart, urlEnd),
            )}${source.slice(urlEnd, end)})`,
          );
          i = end + 1;
          continue;
        }
      }
      out.push(ch);
      i += 1;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out.join("");
}
