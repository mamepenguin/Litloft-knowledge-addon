import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import EditorToolbar from "../EditorToolbar";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

describe("SPEC-ADDON-132 Library step 5: the pane's editor has no rule under its toolbar", () => {
  afterEach(cleanup);

  it.each([
    [true, true],
    [false, false],
  ])("bordered=%s draws the rule: %s", (bordered, drawn) => {
    const { container } = render(
      <EditorToolbar frameless={!bordered} onAction={() => {}} onKeepVersion={() => {}} onOpenVersionHistory={() => {}} />,
    );
    expect((container.firstElementChild as HTMLElement).className.includes("border-b")).toBe(drawn);
  });
});
