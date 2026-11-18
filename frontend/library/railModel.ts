import type { RailEntry } from "./useRailEntries";
import type { ListPhase } from "./useNotesList";
import type { Segment, Selection } from "./libraryUrl";

export interface RailItem {
  kind: "all" | "entry";
  /** The folder path or tag name; `null` for All. */
  key: string | null;
  /** `null` draws no count. */
  count: number | null;
  selected: boolean;
}

export interface RailModelInput {
  segment: Segment;
  /** `null` until the rail's own request has answered. */
  entries: readonly RailEntry[] | null;
  railFailed: boolean;
  selection: Selection;
  /** The scope line's total; `null` while it is unknown. */
  allTotal: number | null;
  listTotal: number | null;
  listPhase: ListPhase;
}

function selectedKey(selection: Selection, segment: Segment): string | null {
  if (selection.kind === "folder" && segment === "folder") return selection.path;
  if (selection.kind === "tag" && segment === "tag") return selection.name;
  return null;
}

/**
 * All, then the entries, then the selected entry when it is not among them
 * (beyond the cap, or no note under the target) with the list's own total.
 */
export function railItems(input: RailModelInput): RailItem[] {
  const { segment, entries, selection } = input;
  const chosen = selectedKey(selection, segment);
  const items: RailItem[] = [
    { kind: "all", key: null, count: input.allTotal, selected: selection.kind === "all" },
  ];
  for (const entry of entries ?? []) {
    items.push({ kind: "entry", key: entry.key, count: entry.count, selected: entry.key === chosen });
  }
  if (chosen !== null && !(entries ?? []).some((entry) => entry.key === chosen)) {
    const listAnswered = input.listPhase === "ready" && input.listTotal !== null;
    items.push({
      kind: "entry",
      key: chosen,
      count: input.railFailed ? null : listAnswered ? input.listTotal : null,
      selected: true,
    });
  }
  return items;
}
