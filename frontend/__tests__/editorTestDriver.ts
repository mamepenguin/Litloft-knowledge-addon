import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "@testing-library/react";

export function getEditorView(editor: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(editor);
  if (!view) throw new Error("CodeMirror view not found");
  return view;
}

export function editorContent(editor: HTMLElement): string {
  return getEditorView(editor).state.doc.toString();
}

export function setEditorContent(editor: HTMLElement, content: string): void {
  const view = getEditorView(editor);
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: EditorSelection.cursor(content.length),
    });
  });
}

export function editorSelection(editor: HTMLElement): {
  start: number;
  end: number;
} {
  const selection = getEditorView(editor).state.selection.main;
  return { start: selection.from, end: selection.to };
}
