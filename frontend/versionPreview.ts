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
 * can be. Only a real inline link destination is decoded: not `](…)` in a
 * fenced block or a code span, not one with no `[label]` in front of it,
 * and not a link's title. Everything else is returned byte for byte.
 */

/** Reads a destination from `start`, balancing parentheses. */
function readDestination(
  source: string,
  start: number,
): { text: string; end: number } | null {
  let depth = 1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    // A destination does not span a blank line, and treating one as if it
    // did would swallow the rest of the note on an unbalanced `](`.
    if (ch === "\n") return null;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return { text: source.slice(start, i), end: i };
    }
  }
  return null;
}

/**
 * Decodes the URL part of a destination, leaving any title untouched.
 *
 * A destination that is not valid percent-encoding is returned as written:
 * `decodeURIComponent` throws on a lone `%`, and a version's body is
 * arbitrary text that is allowed to contain one.
 */
function decodeDestination(destination: string): string {
  const match = /^(\s*)(\S*)([\s\S]*)$/.exec(destination);
  if (!match) return destination;
  const [, lead, url, rest] = match;
  try {
    return `${lead}${decodeURIComponent(url)}${rest}`;
  } catch {
    return destination;
  }
}

export function decodeLinkTargets(source: string): string {
  const out: string[] = [];
  let i = 0;
  let atLineStart = true;
  let fence: string | null = null;
  let labelOpen = false;

  while (i < source.length) {
    if (atLineStart) {
      const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(source.slice(i));
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (fence === null) fence = marker;
        else if (marker === fence) fence = null;
        const newline = source.indexOf("\n", i);
        const stop = newline === -1 ? source.length : newline;
        out.push(source.slice(i, stop));
        i = stop;
        atLineStart = false;
        continue;
      }
    }

    const ch = source[i];

    if (ch === "\n") {
      out.push(ch);
      i += 1;
      atLineStart = true;
      // A link label does not carry across a line break here.
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
      const stop = close === -1 ? source.length : close + run.length;
      out.push(source.slice(i, stop));
      i = stop;
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

    if (ch === "]" && labelOpen && source[i + 1] === "(") {
      const destination = readDestination(source, i + 2);
      labelOpen = false;
      if (destination) {
        out.push(`](${decodeDestination(destination.text)})`);
        i = destination.end + 1;
        continue;
      }
    }

    out.push(ch);
    i += 1;
  }

  return out.join("");
}
