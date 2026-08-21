import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

function frontmatterEnd(state: EditorState): number {
  if (state.doc.lines < 2 || state.doc.line(1).text.trim() !== "---") {
    return 0;
  }
  for (let number = 2; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (line.text.trim() === "---") return line.to;
  }
  return 0;
}

function selectionTouchesLine(state: EditorState, position: number): boolean {
  const line = state.doc.lineAt(position);
  return state.selection.ranges.some(
    (range) => range.from <= line.to && range.to >= line.from,
  );
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly markerFrom: number,
    private readonly checked: boolean,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return (
      other.markerFrom === this.markerFrom && other.checked === this.checked
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.className = "cm-live-task-checkbox";
    checkbox.setAttribute("aria-label", "Toggle task");
    checkbox.addEventListener("click", (event) => {
      event.preventDefault();
      if (!view.state.facet(EditorView.editable)) return;
      view.dispatch({
        changes: {
          from: this.markerFrom + 1,
          to: this.markerFrom + 2,
          insert: this.checked ? " " : "x",
        },
      });
      view.focus();
    });
    return checkbox;
  }
}

class HorizontalRuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "cm-live-horizontal-rule";
    rule.setAttribute("aria-hidden", "true");
    return rule;
  }
}

class ListMarkerWidget extends WidgetType {
  constructor(
    private readonly marker: string,
    private readonly ordered: boolean,
  ) {
    super();
  }

  eq(other: ListMarkerWidget): boolean {
    return other.marker === this.marker && other.ordered === this.ordered;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = this.ordered
      ? "cm-live-list-marker cm-live-list-marker-ordered"
      : "cm-live-list-marker cm-live-list-marker-unordered";
    marker.textContent = this.marker;
    return marker;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Array<ReturnType<Decoration["range"]>> = [];
  const lineClasses = new Set<string>();
  const state = view.state;
  const yamlEnd = frontmatterEnd(state);

  const addLineClass = (position: number, className: string) => {
    const line = state.doc.lineAt(position);
    const key = `${line.from}:${className}`;
    if (lineClasses.has(key)) return;
    lineClasses.add(key);
    ranges.push(Decoration.line({ class: className }).range(line.from));
  };

  for (const visible of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (yamlEnd > 0 && node.to <= yamlEnd) return false;
        const name = node.name;
        const inactiveLine =
          !view.hasFocus || !selectionTouchesLine(state, node.from);

        const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
        if (heading) {
          addLineClass(node.from, `cm-live-h${heading[1]}`);
          return;
        }

        if (name === "StrongEmphasis") {
          ranges.push(
            Decoration.mark({ class: "cm-live-strong" }).range(
              node.from,
              node.to,
            ),
          );
          return;
        }
        if (name === "Emphasis") {
          ranges.push(
            Decoration.mark({ class: "cm-live-emphasis" }).range(
              node.from,
              node.to,
            ),
          );
          return;
        }
        if (name === "Strikethrough") {
          ranges.push(
            Decoration.mark({ class: "cm-live-strikethrough" }).range(
              node.from,
              node.to,
            ),
          );
          return;
        }
        if (name === "InlineCode") {
          ranges.push(
            Decoration.mark({ class: "cm-live-inline-code" }).range(
              node.from,
              node.to,
            ),
          );
          return;
        }
        if (name === "Link") {
          ranges.push(
            Decoration.mark({ class: "cm-live-link" }).range(
              node.from,
              node.to,
            ),
          );
          return;
        }
        if (name === "Blockquote") {
          const first = state.doc.lineAt(node.from).number;
          const last = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
          for (let number = first; number <= last; number += 1) {
            addLineClass(state.doc.line(number).from, "cm-live-blockquote");
          }
          return;
        }
        if (name === "FencedCode") {
          const first = state.doc.lineAt(node.from).number;
          const last = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
          for (let number = first; number <= last; number += 1) {
            addLineClass(state.doc.line(number).from, "cm-live-code-block");
          }
          return;
        }
        if (name === "TaskMarker") {
          const marker = state.doc.sliceString(node.from, node.to);
          ranges.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(
                node.from,
                marker.toLowerCase() === "[x]",
              ),
            }).range(node.from, node.to),
          );
          return false;
        }
        if (name === "HorizontalRule" && inactiveLine) {
          ranges.push(
            Decoration.replace({
              widget: new HorizontalRuleWidget(),
              block: false,
            }).range(node.from, node.to),
          );
          return false;
        }
        if (name === "ListMark" && inactiveLine) {
          const item = node.node.parent;
          const isTask = Boolean(item?.getChild("Task"));
          const isOrdered = item?.parent?.name === "OrderedList";
          const marker = state.doc.sliceString(node.from, node.to);
          ranges.push(
            Decoration.replace(
              isTask
                ? {}
                : {
                    widget: new ListMarkerWidget(
                      isOrdered ? marker : "•",
                      isOrdered,
                    ),
                  },
            ).range(node.from, node.to),
          );
          return false;
        }

        const parentName = node.node.parent?.name;
        const isLinkDestination =
          (name === "URL" || name === "LinkTitle") &&
          (parentName === "Link" || parentName === "Image");
        const isMarker =
          name === "HeaderMark" ||
          name === "EmphasisMark" ||
          name === "StrikethroughMark" ||
          name === "CodeMark" ||
          name === "QuoteMark" ||
          name === "LinkMark" ||
          isLinkDestination ||
          name === "CodeInfo";
        if (isMarker && inactiveLine) {
          ranges.push(
            Decoration.replace({}).range(node.from, node.to),
          );
        }
      },
    });
  }

  return Decoration.set(ranges, true);
}

class LivePreviewPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.focusChanged ||
      update.viewportChanged ||
      update.geometryChanged
    ) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export const markdownLivePreview = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (plugin) => plugin.decorations,
});
