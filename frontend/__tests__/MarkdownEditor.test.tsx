import { createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MarkdownEditor, {
  type MarkdownEditorHandle,
} from "../MarkdownEditor";

afterEach(cleanup);

function mount(doc: string, onChange = vi.fn()) {
  const ref = createRef<MarkdownEditorHandle>();
  const result = render(
    <MarkdownEditor
      ref={ref}
      initialContent={doc}
      ariaLabel="editArea"
      placeholder=""
      onChange={onChange}
    />,
  );
  if (!ref.current) throw new Error("CodeMirror did not mount");
  return { ...result, editor: ref.current, onChange };
}

describe("MarkdownEditor", () => {
  it("excludes programmatic replacements from undo history", () => {
    const { editor } = mount("before");

    editor.setContent("restored", { addToHistory: false });

    expect(editor.getContent()).toBe("restored");
    expect(editor.undo()).toBe(false);
    expect(editor.getContent()).toBe("restored");
  });
});
