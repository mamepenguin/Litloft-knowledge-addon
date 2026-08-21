"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
} from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";

import { markdownLivePreview } from "./livePreview";

export interface MarkdownEditorHandle {
  readonly view: EditorView;
  getContent: () => string;
  setContent: (
    content: string,
    options?: { addToHistory?: boolean },
  ) => void;
  getSelection: () => { start: number; end: number };
  setSelection: (start: number, end?: number) => void;
  focus: () => void;
  blur: () => void;
  coordsAtPos: (position: number) => ReturnType<EditorView["coordsAtPos"]>;
  undo: () => boolean;
}

interface Props {
  initialContent: string;
  ariaLabel: string;
  placeholder: string;
  className?: string;
  fillHeight?: boolean;
  disabled?: boolean;
  ariaBusy?: boolean;
  onChange: (content: string) => void;
  onSelectionChange?: (content: string, head: number) => void;
  onKeyDown?: (event: KeyboardEvent, view: EditorView) => boolean;
  onDropFiles?: (files: File[], position: number) => void;
  onPasteImages?: (files: File[], from: number, to: number) => void;
}

const blockedCoreShortcuts = new Set([
  "mod-s",
  "mod-b",
  "mod-i",
  "mod-k",
  "mod-e",
  "mod-shift-k",
  "mod-shift-\\",
  "cmd-s",
  "cmd-b",
  "cmd-i",
  "cmd-k",
  "cmd-e",
  "cmd-shift-k",
  "cmd-shift-\\",
  "ctrl-s",
  "ctrl-b",
  "ctrl-i",
  "ctrl-k",
  "ctrl-e",
  "ctrl-shift-k",
  "ctrl-shift-\\",
]);

const filteredDefaultKeymap = defaultKeymap.filter((binding) =>
  [binding.key, binding.mac, binding.linux, binding.win]
    .filter((key): key is string => typeof key === "string")
    .every((key) => !blockedCoreShortcuts.has(key.toLowerCase())),
);

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "24rem",
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
    fontSize: "16px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "system-ui, sans-serif",
    lineHeight: "1.625",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "24px 32px",
    caretColor: "var(--text-primary)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--text-primary)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--focus-ring) 24%, transparent)",
  },
  ".cm-live-h1": {
    fontSize: "1.75em",
    fontWeight: "700",
    lineHeight: "1.35",
  },
  ".cm-live-h2": {
    fontSize: "1.35em",
    fontWeight: "700",
    lineHeight: "1.4",
  },
  ".cm-live-h3": {
    fontSize: "1.15em",
    fontWeight: "650",
    lineHeight: "1.45",
  },
  ".cm-live-h4": {
    fontSize: "1.03em",
    fontWeight: "650",
    lineHeight: "1.45",
  },
  ".cm-live-h5": {
    fontSize: "0.95em",
    fontWeight: "650",
    lineHeight: "1.45",
  },
  ".cm-live-h6": {
    color: "var(--text-muted)",
    fontSize: "0.9em",
    fontWeight: "650",
    lineHeight: "1.45",
  },
  ".cm-live-strong": { fontWeight: "650" },
  ".cm-live-emphasis": { fontStyle: "italic" },
  ".cm-live-strikethrough": { textDecoration: "line-through" },
  ".cm-live-inline-code": {
    backgroundColor: "var(--bg-elevated)",
    borderRadius: "4px",
    fontFamily:
      'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
    fontSize: "0.85em",
    padding: "0.12em 0.38em",
  },
  ".cm-live-link": {
    color: "var(--accent)",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  ".cm-live-blockquote": {
    backgroundColor: "var(--bg-elevated)",
    borderLeft: "3px solid var(--accent)",
    color: "var(--text-muted)",
    paddingLeft: "1em",
  },
  ".cm-live-code-block": {
    backgroundColor: "var(--bg-elevated)",
    borderLeft: "1px solid var(--bg-border)",
    borderRight: "1px solid var(--bg-border)",
    fontFamily:
      'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
    fontSize: "0.85em",
    lineHeight: "1.6",
    paddingLeft: "1.1em",
    paddingRight: "1.1em",
  },
  ".cm-live-task-checkbox": {
    accentColor: "var(--accent)",
    margin: "0 0.45em 0 0",
    verticalAlign: "middle",
  },
  ".cm-live-list-marker": {
    color: "var(--text-muted)",
    fontWeight: "600",
  },
  ".cm-live-list-marker-ordered": {
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-live-horizontal-rule": {
    borderTop: "1px solid var(--bg-border)",
    display: "block",
    height: "1px",
    margin: "0.5em 0",
  },
});

const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(
  function MarkdownEditor(
    {
      initialContent,
      ariaLabel,
      placeholder,
      className,
      fillHeight = false,
      disabled = false,
      ariaBusy = false,
      onChange,
      onSelectionChange,
      onKeyDown,
      onDropFiles,
      onPasteImages,
    },
    forwardedRef,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const editableCompartmentRef = useRef(new Compartment());
    const callbackRef = useRef({
      onChange,
      onSelectionChange,
      onKeyDown,
      onDropFiles,
      onPasteImages,
    });
    callbackRef.current = {
      onChange,
      onSelectionChange,
      onKeyDown,
      onDropFiles,
      onPasteImages,
    };

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const editableCompartment = editableCompartmentRef.current;
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: initialContent,
          extensions: [
            markdown({ base: markdownLanguage }),
            markdownLivePreview,
            history(),
            indentUnit.of("  "),
            keymap.of([indentWithTab, ...filteredDefaultKeymap, ...historyKeymap]),
            EditorView.lineWrapping,
            placeholderExtension(placeholder),
            editableCompartment.of(EditorView.editable.of(!disabled)),
            EditorView.contentAttributes.of({
              "aria-label": ariaLabel,
              "aria-busy": String(ariaBusy),
              spellcheck: "false",
              autocapitalize: "off",
              autocomplete: "off",
              autocorrect: "off",
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                callbackRef.current.onChange(update.state.doc.toString());
              }
              if (update.docChanged || update.selectionSet) {
                callbackRef.current.onSelectionChange?.(
                  update.state.doc.toString(),
                  update.state.selection.main.head,
                );
              }
            }),
            Prec.highest(EditorView.domEventHandlers({
              keydown(event, currentView) {
                return (
                  callbackRef.current.onKeyDown?.(event, currentView) ?? false
                );
              },
              dragover(event) {
                if (!event.dataTransfer?.types.includes("Files")) return false;
                event.preventDefault();
                event.stopPropagation();
                return true;
              },
              drop(event, currentView) {
                const files = Array.from(event.dataTransfer?.files ?? []);
                if (files.length === 0) return false;
                event.preventDefault();
                event.stopPropagation();
                let position = currentView.state.selection.main.head;
                try {
                  position =
                    currentView.posAtCoords({
                      x: event.clientX,
                      y: event.clientY,
                    }) ?? position;
                } catch {
                  // jsdom and browsers without layout information fall back
                  // to the current selection, which is also what keyboard
                  // initiated paste/drop semantics use.
                }
                callbackRef.current.onDropFiles?.(files, position);
                return true;
              },
              paste(event, currentView) {
                const files = Array.from(event.clipboardData?.items ?? [])
                  .filter((item) => item.type.startsWith("image/"))
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => file !== null);
                if (files.length === 0) {
                  // Some synthetic clipboard events (notably jsdom) expose
                  // items but not getData(). Claim those events so CM6 does
                  // not call a missing API; real browser text paste keeps
                  // flowing to CM6 normally.
                  return typeof event.clipboardData?.getData !== "function";
                }
                event.preventDefault();
                const selection = currentView.state.selection.main;
                callbackRef.current.onPasteImages?.(
                  files,
                  selection.from,
                  selection.to,
                );
                return true;
              },
            })),
            fillHeight
              ? EditorView.theme({
                  "&": { height: "auto" },
                  ".cm-scroller": { overflow: "visible" },
                })
              : [],
            editorTheme,
          ],
        }),
      });
      viewRef.current = view;
      return () => {
        viewRef.current = null;
        view.destroy();
      };
      // The editor is intentionally uncontrolled. External replacements go
      // through the imperative handle instead of rebuilding EditorState.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: editableCompartmentRef.current.reconfigure(
          EditorView.editable.of(!disabled),
        ),
      });
      view.contentDOM.setAttribute("aria-busy", String(ariaBusy));
    }, [ariaBusy, disabled]);

    useImperativeHandle(
      forwardedRef,
      () => {
        const requireView = () => {
          const view = viewRef.current;
          if (!view) throw new Error("CodeMirror is not mounted");
          return view;
        };
        return {
          get view() {
            return requireView();
          },
          getContent: () => requireView().state.doc.toString(),
          setContent: (next, options) => {
            const view = requireView();
            if (next === view.state.doc.toString()) return;
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: next },
              annotations:
                options?.addToHistory === false
                  ? Transaction.addToHistory.of(false)
                  : undefined,
            });
          },
          getSelection: () => {
            const selection = requireView().state.selection.main;
            return { start: selection.from, end: selection.to };
          },
          setSelection: (start, end = start) => {
            const view = viewRef.current;
            if (!view) return;
            view.dispatch({ selection: EditorSelection.range(start, end) });
          },
          focus: () => viewRef.current?.focus(),
          blur: () => viewRef.current?.contentDOM.blur(),
          coordsAtPos: (position) => requireView().coordsAtPos(position),
          undo: () => undo(requireView()),
        };
      },
      [],
    );

    return <div ref={hostRef} className={className} />;
  },
);

export default MarkdownEditor;
