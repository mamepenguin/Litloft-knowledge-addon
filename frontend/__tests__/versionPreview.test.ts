import { describe, expect, it } from "vitest";

import { decodeLinkTargets } from "../versionPreview";

describe("decodeLinkTargets", () => {
  it("decodes a percent-encoded heading anchor", () => {
    expect(
      decodeLinkTargets("[はじめに](#1-%E3%81%AF%E3%81%98%E3%82%81%E3%81%AB)"),
    ).toBe("[はじめに](#1-はじめに)");
  });

  it("decodes every link on a line, not just the first", () => {
    expect(decodeLinkTargets("[a](#%E4%B8%80) and [b](#%E4%BA%8C)")).toBe(
      "[a](#一) and [b](#二)",
    );
  });

  it("leaves a malformed percent escape exactly as written", () => {
    // `decodeURIComponent("100%")` throws. A version's body is arbitrary
    // text and is allowed to contain a lone `%`.
    const source = "see [the report](#up-100%-year) for the rest";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("keeps the sound links on a line that also has a malformed one", () => {
    expect(decodeLinkTargets("[a](#%E4%B8%80) [b](#50%)")).toBe(
      "[a](#一) [b](#50%)",
    );
  });

  it("leaves text with no links untouched", () => {
    const source = "# heading\n\n100% of the body, verbatim (parens) too\n";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("leaves a fenced code block byte for byte", () => {
    // A real link inside the fence: with no fence handling this decodes,
    // which is the whole point of the case.
    const source = "```md\n[a](#%E4%B8%80)\n```\n";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("leaves a `](...)` inside a fence that has no label either", () => {
    const source = '```js\nconst x = "](#%66oo)";\n```\n';
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("leaves an inline code span byte for byte", () => {
    const source = 'write `[a](#%66oo)` to link';
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("leaves a `](...)` that has no label in front of it", () => {
    const source = "plain ](#%E3%81%AF) is not a link";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("leaves a destination that is not a bare fragment", () => {
    // Deliberately narrower than "every link destination": a URL with
    // balanced parentheses is a grammar this module does not try to parse,
    // so it is left as written rather than half-decoded.
    const source = "[wiki](https://en.wikipedia.org/wiki/Foo_(bar)%20baz)";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("leaves a link that carries a title", () => {
    const source = '[a](#%E4%B8%80 "a %20 title")';
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("does not let a destination run past the end of its line", () => {
    // Without the newline stop, the `)` on the second line closes this and
    // the whole span is rewritten as a destination.
    const source = "[a](#%E4%B8%80\nstill going )\n";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("still decodes a later link after an unclosed one", () => {
    expect(decodeLinkTargets("[a](#%E4%B8%80\n[b](#%E4%BA%8C)\n")).toBe(
      "[a](#%E4%B8%80\n[b](#二)\n",
    );
  });

  it("ends the label at every closing bracket", () => {
    // `[closed]` finishes its label, so the later `](` is not a link.
    const source = "[closed] text ](#%66oo)";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("leaves a four-space indented code block alone", () => {
    const source = "para\n\n    [example](#%66oo)\n";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("keeps the continuation lines of an indented code block", () => {
    // Only the first line follows a blank one; the second is a continuation,
    // and is just as much code as the first.
    const source = "para\n\n    first\n    [a](#%E4%B8%80)\n";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("leaves the indented block when the indent stops", () => {
    expect(decodeLinkTargets("para\n\n    code\n\n[a](#%E4%B8%80)\n")).toBe(
      "para\n\n    code\n\n[a](#一)\n",
    );
  });

  it("does not close a four-backtick fence with three", () => {
    const source = "````\n```\n[a](#%E4%B8%80)\n````\n";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("keeps decoding after an unmatched backtick", () => {
    // Markdown treats a lone backtick as literal text, so the link is real.
    expect(decodeLinkTargets("` unmatched [x](#%E4%B8%80)")).toBe(
      "` unmatched [x](#一)",
    );
  });

  it("leaves a title holding a parenthesis", () => {
    const source = '[a](#%E4%B8%80 "see (draft")';
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("leaves an angle-bracketed destination alone", () => {
    const source = "[a](<#%E4%B8%80 %E4%BA%8C>)";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("decodes a label whose own brackets balance", () => {
    expect(decodeLinkTargets("[outer [inner]](#%E4%B8%80)")).toBe(
      "[outer [inner]](#一)",
    );
  });

  it("leaves a label that already holds a link", () => {
    // Markdown forbids a link inside a link, so the outer opener is void and
    // the trailing `](#…)` is literal text.
    const source = "[outer [inner](https://x)](#%E4%B8%80)";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("leaves an unclosed label alone", () => {
    const source = "[outer [inner](#%E4%B8%80)";
    expect(decodeLinkTargets(source)).toBe(source);
  });

  it("does not decode a plus sign into a space", () => {
    // `+` is a form-encoding convention, not a URI one, and an anchor
    // written `#a+b` means `a+b`.
    expect(decodeLinkTargets("[x](#a+b)")).toBe("[x](#a+b)");
  });
});
