/**
 * The frame's changes (a tab, a Target) pass through whatever gate the page
 * under it has registered, so a Library pane with an editor mounted can save
 * first. With no gate registered a change happens at once.
 */
export type ChangeGate = (proceed: () => void) => void;

let gate: ChangeGate | null = null;

/** Returns the function that withdraws this gate, and only this one. */
export function registerChangeGate(next: ChangeGate): () => void {
  gate = next;
  return () => {
    if (gate === next) gate = null;
  };
}

export function hasChangeGate(): boolean {
  return gate !== null;
}

export function runGated(change: () => void): void {
  if (gate === null) change();
  else gate(change);
}
