/**
 * Read-only rendering helpers for a stored version's body.
 *
 * The preview deliberately shows the raw Markdown source — the point of
 * the panel is to see what is saved, and rendering it would hide that.
 * The one exception is link targets: an anchor written by the editor's
 * heading links arrives percent-encoded, so a table of contents reads as
 * `[はじめに](#1-%E3%81%AF%E3%81%98%E3%82%81%E3%81%AB)` and a page of it
 * is unreadable.
 */

const LINK_TARGET = /\]\(([^)]*)\)/g;

/**
 * Decodes the target of every `[label](target)` in `source`.
 *
 * A target that is not valid percent-encoding is left exactly as written:
 * `decodeURIComponent` throws on a lone `%`, and a version's body is
 * arbitrary text that is allowed to contain one.
 */
export function decodeLinkTargets(source: string): string {
  return source.replace(LINK_TARGET, (whole, target: string) => {
    try {
      return `](${decodeURIComponent(target)})`;
    } catch {
      return whole;
    }
  });
}
