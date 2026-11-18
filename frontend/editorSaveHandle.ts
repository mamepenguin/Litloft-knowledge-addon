export type EditorFlushResult = "saved" | "failed" | "conflict";

/**
 * What a host that embeds the editor can ask of it. `current` of the ref the
 * host passes is set only while the editor holds loaded content for the file
 * it shows.
 */
export interface EditorSaveHandle {
  /** The text on screen differs from what the editor last saved. */
  dirty(): boolean;
  /**
   * Saves what is on screen now, ahead of the autosave debounce. Resolves
   * "saved" only once the text current at that moment is on the server.
   */
  flush(): Promise<EditorFlushResult>;
}
