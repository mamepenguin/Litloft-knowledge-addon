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

  it("does not decode a plus sign into a space", () => {
    // `+` is a form-encoding convention, not a URI one, and an anchor
    // written `#a+b` means `a+b`.
    expect(decodeLinkTargets("[x](#a+b)")).toBe("[x](#a+b)");
  });
});
