"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
} from "react";

import { FileContextMenu } from "@/components/FileContextMenu";
import { deleteWatchProgress, getShelves, type ShelfItem } from "@/lib/api";
import type { FileItem } from "@/types";

/** One card's entry into the page's menu. */
export interface CardMenuOptions {
  /** The card's own link, for 新しいタブで開く. */
  href: string;
  /** The list the card was drawn in; the history rows are read from it. */
  listKey: string;
  /** Runs before a rename, move or trash is sent; a cancelled gate cancels it. */
  before?: (run: () => void) => void;
  onTrashed?: (file: FileItem) => void;
  onRenamed?: (file: FileItem) => void;
  onMoved?: (file: FileItem) => void;
}

export interface CardFileLists {
  /** Bumps on every removal. */
  version: number;
  /** The list's items with menu removals and re-read answers applied, in order. */
  filter: (listKey: string, items: readonly FileItem[]) => FileItem[];
  /** How many of these items this list has lost. */
  removedCount: (listKey: string, items: readonly FileItem[]) => number;
  /** Whether this list has lost the item. */
  isRemoved: (listKey: string, id: string) => boolean;
}

export interface PageFileMenuContextValue extends CardFileLists {
  open: (file: FileItem, position: { x: number; y: number }, options: CardMenuOptions) => void;
}

interface PageState {
  scope: string;
  version: number;
  trashed: ReadonlySet<string>;
  removed: ReadonlyMap<string, ReadonlySet<string>>;
  overrides: ReadonlyMap<string, FileItem>;
}

interface Opened {
  scope: string;
  file: FileItem;
  options: CardMenuOptions;
  position: { x: number; y: number };
  menuOpen: boolean;
}

const NO_LISTS: CardFileLists = {
  version: 0,
  filter: (_listKey, items) => [...items],
  removedCount: () => 0,
  isRemoved: () => false,
};

const PageFileMenuContext = createContext<PageFileMenuContextValue | null>(null);
const NO_LIST: ReadonlySet<string> = new Set();

function freshPage(scope: string): PageState {
  return {
    scope,
    version: 0,
    trashed: new Set(),
    removed: new Map(),
    overrides: new Map(),
  };
}

function mergeAnswer(drawn: FileItem, answer: FileItem): FileItem {
  const from = drawn as Partial<ShelfItem>;
  const to = answer as Partial<ShelfItem>;
  return {
    ...answer,
    ...(to.watch_progress === undefined ? { watch_progress: from.watch_progress } : {}),
    ...(to.watched_ranges === undefined ? { watched_ranges: from.watched_ranges } : {}),
  } as FileItem;
}

/**
 * One file menu for a page, and the list changes its rows make. The menu lives
 * here rather than on a card, so a dialog outlives the card behind it and a
 * second card moves the menu instead of opening another.
 */
export function usePageFileMenu({
  scope,
  hasProfile,
  historyListKeys = [],
}: {
  /** Changes when the drive, Target or profile the page shows changes. */
  scope: string;
  hasProfile: boolean;
  /** The lists whose cards offer 履歴から削除. */
  historyListKeys?: readonly string[];
}): {
  context: PageFileMenuContextValue;
  menu: ReactNode;
  filter: CardFileLists["filter"];
  removedCount: CardFileLists["removedCount"];
  isRemoved: CardFileLists["isRemoved"];
} {
  const [page, setPage] = useState<PageState>(() => freshPage(scope));
  if (page.scope !== scope) setPage(freshPage(scope));
  const livePage = page.scope === scope ? page : freshPage(scope);

  const [opened, setOpened] = useState<Opened | null>(null);
  if (opened !== null && opened.scope !== scope) setOpened(null);
  const liveOpened = opened !== null && opened.scope === scope ? opened : null;

  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const openedRef = useRef<Opened | null>(liveOpened);
  openedRef.current = liveOpened;
  const tickets = useRef(new Map<string, number>());

  const change = (captured: string, next: (held: PageState) => PageState) => {
    setPage((held) => (held.scope === captured ? next(held) : held));
  };

  const hide = (captured: string, listKey: string, id: string) => {
    change(captured, (held) => {
      const removed = new Map(held.removed);
      removed.set(listKey, new Set(removed.get(listKey) ?? NO_LIST).add(id));
      return { ...held, version: held.version + 1, removed };
    });
  };

  const filter: CardFileLists["filter"] = (listKey, items) => {
    const gone = livePage.removed.get(listKey);
    const out: FileItem[] = [];
    for (const item of items) {
      if (livePage.trashed.has(item.id) || gone?.has(item.id)) continue;
      const answer = livePage.overrides.get(item.id);
      out.push(answer === undefined ? item : mergeAnswer(item, answer));
    }
    return out;
  };

  const isRemoved: CardFileLists["isRemoved"] = (listKey, id) =>
    livePage.trashed.has(id) || (livePage.removed.get(listKey)?.has(id) ?? false);

  const removedCount: CardFileLists["removedCount"] = (listKey, items) =>
    items.filter((item) => isRemoved(listKey, item.id)).length;

  const open: PageFileMenuContextValue["open"] = (file, position, options) => {
    setOpened({ scope: scopeRef.current, file, options, position, menuOpen: true });
  };

  const close = () => {
    setOpened((held) => (held === null ? held : { ...held, menuOpen: false }));
  };

  const handleTrashed = (file: FileItem) => {
    const target = openedRef.current;
    if (target === null || scopeRef.current !== target.scope) return;
    change(target.scope, (held) => ({
      ...held,
      version: held.version + 1,
      trashed: new Set(held.trashed).add(file.id),
    }));
    target.options.onTrashed?.(file);
  };

  const handleRenamed = (file: FileItem) => {
    const target = openedRef.current;
    if (target === null || scopeRef.current !== target.scope) return;
    target.options.onRenamed?.(file);
    reRead(target.scope, file);
  };

  const reRead = (captured: string, file: FileItem) => {
    const id = file.id;
    const ticket = (tickets.current.get(id) ?? 0) + 1;
    tickets.current.set(id, ticket);
    void getShelves(file.drive, { by: "all", ids: [id] }).then(
      (answer) => {
        if (scopeRef.current !== captured) return;
        if (tickets.current.get(id) !== ticket) return;
        const found = answer.shelves.flatMap((shelf) => shelf.items).find((item) => item.id === id);
        if (found === undefined) return;
        change(captured, (held) => ({
          ...held,
          overrides: new Map(held.overrides).set(id, found),
        }));
      },
      () => {
        // The cards keep what they drew; the next load shows the truth.
      },
    );
  };

  const handleMoved = (file: FileItem) => {
    const target = openedRef.current;
    if (target === null || scopeRef.current !== target.scope) return;
    target.options.onMoved?.(file);
    reRead(target.scope, file);
  };

  const handleHistoryRemoved = (listKey: string, id: string) => {
    const target = openedRef.current;
    if (target === null || scopeRef.current !== target.scope) return;
    hide(target.scope, listKey, id);
  };

  const context: PageFileMenuContextValue = {
    version: livePage.version,
    open,
    filter,
    removedCount,
    isRemoved,
  };

  const menu =
    liveOpened === null ? null : (
      <PageFileMenuView
        opened={liveOpened}
        hasProfile={hasProfile}
        historyListKeys={historyListKeys}
        onClose={close}
        onTrashed={handleTrashed}
        onRenamed={handleRenamed}
        onMoved={handleMoved}
        onHistoryRemoved={handleHistoryRemoved}
      />
    );

  return { context, menu, filter, removedCount, isRemoved };
}

export function PageFileMenuProvider({
  value,
  children,
}: {
  value: PageFileMenuContextValue;
  children: ReactNode;
}) {
  return <PageFileMenuContext.Provider value={value}>{children}</PageFileMenuContext.Provider>;
}

/** The page's list changes and its menu, for a component that is not the page itself. */
export function usePageFileLists(): CardFileLists {
  return useContext(PageFileMenuContext) ?? NO_LISTS;
}

export interface CardMenuHandlers {
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  onTouchStart?: (event: TouchEvent<HTMLElement>) => void;
  onTouchEnd?: (event: TouchEvent<HTMLElement>) => void;
  onTouchMove?: (event: TouchEvent<HTMLElement>) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * A card's entry into the page's file menu: a right-click, or a 500 ms press
 * without movement. The click that ends a press that opened the menu is
 * swallowed so it does not open the card.
 */
export function useCardMenuHandlers(
  file: FileItem,
  options?: CardMenuOptions,
): CardMenuHandlers {
  const menu = useContext(PageFileMenuContext);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const pressAt = useRef({ x: 0, y: 0 });
  const latest = useRef({ file, options });
  latest.current = { file, options };

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (menu === null || options === undefined) return {};

  return {
    onContextMenu: (event) => {
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = false;
      clear();
      const { file: target, options: current } = latest.current;
      if (current === undefined) return;
      menu.open(target, { x: event.clientX, y: event.clientY }, current);
    },
    onTouchStart: (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      pressAt.current = { x: touch.clientX, y: touch.clientY };
      suppressClick.current = false;
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        suppressClick.current = true;
        const { file: target, options: current } = latest.current;
        if (current === undefined) return;
        menu.open(target, pressAt.current, current);
      }, 500);
    },
    onTouchMove: () => {
      clear();
    },
    onTouchEnd: () => {
      clear();
    },
    onClick: (event) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

function PageFileMenuView({
  opened,
  hasProfile,
  historyListKeys,
  onClose,
  onTrashed,
  onRenamed,
  onMoved,
  onHistoryRemoved,
}: {
  opened: Opened;
  hasProfile: boolean;
  historyListKeys: readonly string[];
  onClose: () => void;
  onTrashed: (file: FileItem) => void;
  onRenamed: (file: FileItem) => void;
  onMoved: (file: FileItem) => void;
  onHistoryRemoved: (listKey: string, id: string) => void;
}) {
  const file = opened.file;
  const listKey = opened.options.listKey;

  const offersHistory = hasProfile && historyListKeys.includes(listKey);
  const onRemoveFromHistory = offersHistory
    ? async () => {
        try {
          await deleteWatchProgress(file.id);
        } catch {
          return;
        }
        onHistoryRemoved(listKey, file.id);
      }
    : undefined;

  return (
    <FileContextMenu
      key={file.id}
      open={opened.menuOpen}
      position={opened.position}
      target={file}
      onClose={onClose}
      onOpenInNewTab={() => {
        window.open(opened.options.href, "_blank");
      }}
      immediateRows
      onRemoveFromHistory={onRemoveFromHistory}
      beforeChange={opened.options.before}
      onTrashed={onTrashed}
      onRenamed={onRenamed}
      onMoved={onMoved}
    />
  );
}
