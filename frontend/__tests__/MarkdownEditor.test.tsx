import { createRef } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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

describe("MarkdownEditor live preview", () => {
  it("keeps markers on the selected line and hides them elsewhere", async () => {
    const { container, editor } = mount("# Heading\n\n**bold**");
    editor.focus();
    const lines = () =>
      Array.from(container.querySelectorAll<HTMLElement>(".cm-line"));

    expect(container.querySelector(".cm-live-h1")).not.toBeNull();
    expect(container.querySelector(".cm-live-strong")).not.toBeNull();
    await waitFor(() => {
      expect(lines()[0]?.textContent).toBe("# Heading");
      expect(lines()[2]?.textContent).toBe("bold");
    });

    editor.setSelection(12);
    await waitFor(() => {
      expect(lines()[0]?.textContent).toBe(" Heading");
      expect(lines()[2]?.textContent).toBe("**bold**");
    });
  });

  it("hides markers on the selected line after the editor loses focus", async () => {
    const { container, editor } = mount("# Heading\n\nplain");
    const headingText = () =>
      container.querySelector<HTMLElement>(".cm-line")?.textContent;

    editor.focus();
    editor.setSelection(2);
    await waitFor(() => expect(headingText()).toBe("# Heading"));

    editor.blur();
    await waitFor(() => expect(headingText()).toBe(" Heading"));
  });

  it("keeps a bare URL visible while hiding an inline link destination", () => {
    const doc = [
      "plain",
      "",
      "https://example.test/path?q=1",
      "",
      "[text](https://hidden.example)",
    ].join("\n");
    const { container, editor } = mount(doc);
    const lines = Array.from(
      container.querySelectorAll<HTMLElement>(".cm-line"),
    );

    expect(editor.getContent()).toBe(doc);
    expect(lines[2]?.textContent).toBe("https://example.test/path?q=1");
    expect(lines[4]?.textContent).toBe("text");
  });

  it("renders inactive list markers without changing the Markdown buffer", async () => {
    const doc = ["- bullet", "1. first", "- [ ] task"].join("\n");
    const { container, editor } = mount(doc);
    const lines = () =>
      Array.from(container.querySelectorAll<HTMLElement>(".cm-line"));

    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(".cm-live-list-marker"),
      ).map((marker) => marker.textContent),
    ).toEqual(["•", "1."]);
    expect(lines()[2]?.querySelector(".cm-live-list-marker")).toBeNull();
    expect(lines()[2]?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(editor.getContent()).toBe(doc);

    editor.focus();
    editor.setSelection(2);
    await waitFor(() => expect(lines()[0]?.textContent).toBe("- bullet"));
    expect(editor.getContent()).toBe(doc);
  });

  it("reveals the raw task marker on the active line", async () => {
    const doc = "plain\n- [ ] task";
    const { container, editor } = mount(doc);
    const taskLine = () =>
      Array.from(container.querySelectorAll<HTMLElement>(".cm-line"))[1];

    expect(taskLine()?.querySelector('input[type="checkbox"]')).not.toBeNull();

    editor.focus();
    editor.setSelection(doc.indexOf("["));
    await waitFor(() => expect(taskLine()?.textContent).toBe("- [ ] task"));
    expect(taskLine()?.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("uses compact vertical spacing around horizontal rules", () => {
    const { container } = mount("plain\n\n---\n\nplain");
    const rule = container.querySelector<HTMLElement>(
      ".cm-live-horizontal-rule",
    );

    expect(rule).not.toBeNull();
    expect(getComputedStyle(rule!).marginTop).toBe("0.5em");
    expect(getComputedStyle(rule!).marginBottom).toBe("0.5em");
  });

  it("leaves frontmatter and unterminated markup raw", () => {
    const doc = "---\ntags: [one]\n---\n# Heading\n\n**open";
    const { container, editor } = mount(doc);

    expect(editor.getContent()).toBe(doc);
    expect(container.textContent).toContain("---tags: [one]---");
    expect(container.textContent).toContain("**open");
    expect(container.querySelector('[class*="cm-live-frontmatter"]')).toBeNull();
    expect(container.querySelector(".cm-live-strong")).toBeNull();
  });

  it("decorates the Markdown body after raw frontmatter", () => {
    const doc = "---\ntags: [one]\n---\n# Heading\n\n**bold**";
    const { container, editor } = mount(doc);
    const lines = Array.from(container.querySelectorAll<HTMLElement>(".cm-line"));

    expect(editor.getContent()).toBe(doc);
    expect(lines.slice(0, 3).every((line) => !line.className.includes("cm-live-")))
      .toBe(true);
    expect(container.querySelector(".cm-live-h1")).not.toBeNull();
    expect(container.querySelector(".cm-live-strong")).not.toBeNull();
  });

  it("does not mistake leading horizontal rules for frontmatter", () => {
    const doc = "---\n\n# Real heading\n\n---\n\n# After";
    const { container, editor } = mount(doc);

    expect(editor.getContent()).toBe(doc);
    expect(container.querySelectorAll(".cm-live-h1")).toHaveLength(2);
    expect(container.querySelectorAll(".cm-live-horizontal-rule")).toHaveLength(2);
  });

  it("decorates the v1 syntax scope while leaving tables raw", () => {
    const doc = [
      "plain",
      "",
      "> quote",
      "",
      "**bold** *em* ~~strike~~ `code` [text](https://example.test)",
      "",
      "```ts",
      "const answer = 42",
      "```",
      "",
      "---",
      "",
      "| a | b |",
      "| - | - |",
    ].join("\n");
    const { container, editor } = mount(doc);

    expect(container.querySelector(".cm-live-blockquote")).not.toBeNull();
    expect(container.querySelector(".cm-live-strong")).not.toBeNull();
    expect(container.querySelector(".cm-live-emphasis")).not.toBeNull();
    expect(container.querySelector(".cm-live-strikethrough")).not.toBeNull();
    expect(container.querySelector(".cm-live-inline-code")).not.toBeNull();
    expect(container.querySelector(".cm-live-link")).not.toBeNull();
    expect(container.querySelector(".cm-live-code-block")).not.toBeNull();
    expect(container.querySelector(".cm-live-horizontal-rule")).not.toBeNull();
    expect(container.querySelector('[class*="cm-live-table"]')).toBeNull();
    expect(editor.getContent()).toBe(doc);
  });

  it("toggles a task through an ordinary document transaction", async () => {
    const onChange = vi.fn();
    const { container, editor } = mount("- [ ] todo", onChange);
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox).not.toBeNull();

    fireEvent.click(checkbox!);

    await waitFor(() => expect(editor.getContent()).toBe("- [x] todo"));
    expect(onChange).toHaveBeenLastCalledWith("- [x] todo");
    expect(editor.undo()).toBe(true);
    expect(editor.getContent()).toBe("- [ ] todo");
  });

  it("does not mutate the document merely by moving the selection", () => {
    const doc = "# Heading\n\n**bold**\n\n[link](https://example.test)";
    const { editor, onChange } = mount(doc);

    editor.setSelection(doc.length);
    editor.setSelection(0);

    expect(editor.getContent()).toBe(doc);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not run CM6 Shift-Mod-k before the core shortcut", () => {
    const doc = "keep this line\nsecond";
    const { editor } = mount(doc);
    editor.focus();
    editor.setSelection(4);
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue(
      new DOMRect(0, 0, 0, 16),
    );

    fireEvent.keyDown(editor.view.contentDOM, {
      key: "k",
      ctrlKey: true,
      shiftKey: true,
    });

    expect(editor.getContent()).toBe(doc);
  });

  it("does not run CM6 Shift-Mod-backslash before the core shortcut", () => {
    const { editor } = mount("(inside)");
    editor.focus();
    editor.setSelection(0);

    fireEvent.keyDown(editor.view.contentDOM, {
      key: "\\",
      ctrlKey: true,
      shiftKey: true,
    });

    expect(editor.getSelection()).toEqual({ start: 0, end: 0 });
  });

  it("preserves the caret across programmatic content replacement", () => {
    const { editor } = mount("0123456789");
    editor.focus();
    editor.setSelection(6);

    editor.setContent("abcdefghij", { addToHistory: false });

    expect(editor.getSelection()).toEqual({ start: 6, end: 6 });
  });

  it("excludes programmatic replacements from undo history", () => {
    const { editor } = mount("before");

    editor.setContent("restored", { addToHistory: false });

    expect(editor.getContent()).toBe("restored");
    expect(editor.undo()).toBe(false);
    expect(editor.getContent()).toBe("restored");
  });
});
