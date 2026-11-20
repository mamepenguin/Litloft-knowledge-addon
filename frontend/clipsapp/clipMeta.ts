import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

import { fetchClipCovers, type ClipCover } from "../api";
import { isViewerRequired, loadUnreadAmong, type ReadyNotesTarget } from "./requests";

const BATCH = 60;

function chunks(ids: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) out.push(ids.slice(i, i + BATCH));
  return out;
}

/**
 * What the page knows about the clips it has drawn: each one's cover and site,
 * and whether the viewer has not opened it. Held for as long as the page is
 * mounted, so a card drawn again is not asked about again. An id is asked once;
 * `refresh` is what lets a failed one, and the one a clip event names, be asked again.
 */
export class ClipMeta {
  private covers = new Map<string, ClipCover>();
  private coverAsked = new Set<string>();
  private coverFailed = new Set<string>();

  private unread = new Set<string>();
  private dotAsked = new Set<string>();
  private dotFailed = new Set<string>();
  /** The nickname the dots belong to; another one starts them over. */
  private dotsKey: string | null = null;
  private epoch = 0;

  private version = 0;
  private listeners = new Set<() => void>();

  constructor(
    private readonly drive: string,
    private readonly onViewerRequired: () => void,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private bump() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  coverOf(id: string): ClipCover | undefined {
    return this.covers.get(id);
  }

  hasDot(id: string, key: string | null): boolean {
    return key !== null && this.dotsKey === key && this.unread.has(id);
  }

  /** Lets what failed, and `eventId`, be asked about again by the next `ensure`. */
  refresh(eventId?: string): void {
    for (const id of this.coverFailed) this.coverAsked.delete(id);
    for (const id of this.dotFailed) this.dotAsked.delete(id);
    this.coverFailed.clear();
    this.dotFailed.clear();
    if (eventId) {
      this.coverAsked.delete(eventId);
      this.dotAsked.delete(eventId);
    }
  }

  /** `dotsKey` is the nickname to ask the dots for; `undefined` asks for covers only. */
  ensure(ids: readonly string[], dotsKey?: string, target: ReadyNotesTarget | null = null): void {
    this.ensureCovers(ids);
    if (dotsKey !== undefined) this.ensureDots(ids, dotsKey, target);
  }

  private ensureCovers(ids: readonly string[]) {
    const missing = [...new Set(ids)].filter((id) => !this.coverAsked.has(id));
    for (const batch of chunks(missing)) {
      for (const id of batch) this.coverAsked.add(id);
      fetchClipCovers(this.drive, batch).then(
        (covers) => {
          for (const id of batch) {
            const cover = covers[id];
            if (cover) this.covers.set(id, cover);
          }
          this.bump();
        },
        () => {
          for (const id of batch) this.coverFailed.add(id);
        },
      );
    }
  }

  private ensureDots(ids: readonly string[], key: string, target: ReadyNotesTarget | null) {
    if (key !== this.dotsKey) {
      this.dotsKey = key;
      this.epoch += 1;
      this.unread = new Set();
      this.dotAsked = new Set();
      this.dotFailed = new Set();
      this.bump();
    }
    const epoch = this.epoch;
    const missing = [...new Set(ids)].filter((id) => !this.dotAsked.has(id));
    for (const batch of chunks(missing)) {
      for (const id of batch) this.dotAsked.add(id);
      loadUnreadAmong(this.drive, batch, target).then(
        (unread) => {
          if (epoch !== this.epoch) return;
          const next = new Set(this.unread);
          for (const id of batch) next.delete(id);
          for (const id of unread) next.add(id);
          this.unread = next;
          this.bump();
        },
        (error: unknown) => {
          if (epoch !== this.epoch) return;
          for (const id of batch) this.dotFailed.add(id);
          if (isViewerRequired(error)) this.onViewerRequired();
        },
      );
    }
  }
}

export const ClipMetaContext = createContext<{
  meta: ClipMeta;
  refresh: number;
  dotsKey: string | null;
  target?: ReadyNotesTarget | null;
} | null>(null);

/**
 * Asks for the covers (and, with a profile, the unread dots) of `ids` and reads
 * them back. Cards draw at their final size before any of it arrives.
 */
export function useClipMeta(ids: readonly string[], { dots }: { dots: boolean }) {
  const context = useContext(ClipMetaContext);
  if (context === null) throw new Error("useClipMeta needs a ClipMetaContext");
  const { meta, refresh, dotsKey, target = null } = context;
  const key = dots ? dotsKey : null;
  const idsKey = ids.join(",");
  useEffect(() => {
    meta.ensure(idsKey === "" ? [] : idsKey.split(","), key ?? undefined, target);
  }, [meta, idsKey, key, refresh, target]);
  useSyncExternalStore(meta.subscribe, meta.getVersion, meta.getVersion);
  return {
    coverOf: (id: string) => meta.coverOf(id),
    hasDot: (id: string) => meta.hasDot(id, key),
  };
}
