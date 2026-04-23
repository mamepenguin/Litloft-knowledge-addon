"use client";

import { ExternalLink, FilePlus, FolderPlus, MoreHorizontal, Pin, PinOff, Tag, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ContextMenuState, ContextTarget } from "./hooks/useContextMenu";

export type ContextAction =
  | { type: "open" }
  | { type: "openNewTab" }
  | { type: "rename" }
  | { type: "move" }
  | { type: "pin" }
  | { type: "unpin" }
  | { type: "tags" }
  | { type: "trash" }
  | { type: "newNoteHere" }
  | { type: "newFolderHere" }
  | { type: "openFolder" }
  | { type: "deleteFolder" };

interface Props {
  menu: ContextMenuState;
  isPinned: boolean;
  onAction: (action: ContextAction, target: ContextTarget) => void;
  onClose: () => void;
}

export default function ContextMenu({ menu, isPinned, onAction, onClose }: Props) {
  const t = useTranslations("knowledge.contextMenu");

  function fire(action: ContextAction) {
    onAction(action, menu.target);
    onClose();
  }

  const isFolder = menu.target.kind === "folder";
  const folder = isFolder && menu.target.kind === "folder" ? menu.target.item : null;
  const folderEmpty = folder !== null ? folder.file_count === 0 : false;

  return (
    <div
      data-context-menu
      style={{ top: menu.y, left: menu.x }}
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-bg-border bg-bg-elevated shadow-xl animate-fade-in-scale"
      role="menu"
      aria-label="Context menu"
    >
      {isFolder ? (
        <>
          <MenuItem
            icon={<MoreHorizontal size={14} />}
            label={t("open")}
            onClick={() => fire({ type: "openFolder" })}
          />
          <Divider />
          <MenuItem
            icon={<FilePlus size={14} />}
            label={t("newNoteHere")}
            onClick={() => fire({ type: "newNoteHere" })}
          />
          <MenuItem
            icon={<FolderPlus size={14} />}
            label={t("newFolderHere")}
            onClick={() => fire({ type: "newFolderHere" })}
          />
          <Divider />
          <MenuItem
            label={t("rename")}
            onClick={() => fire({ type: "rename" })}
          />
          <MenuItem
            label={t("move")}
            onClick={() => fire({ type: "move" })}
          />
          <Divider />
          <MenuItem
            icon={<Trash2 size={14} />}
            label={t("deleteFolder")}
            disabled={!folderEmpty}
            title={!folderEmpty ? t("deleteFolderNotEmpty") : undefined}
            onClick={() => folderEmpty && fire({ type: "deleteFolder" })}
            danger
          />
        </>
      ) : (
        <>
          <MenuItem
            label={t("open")}
            onClick={() => fire({ type: "open" })}
          />
          <MenuItem
            icon={<ExternalLink size={14} />}
            label={t("openNewTab")}
            onClick={() => fire({ type: "openNewTab" })}
          />
          <Divider />
          <MenuItem
            label={t("rename")}
            onClick={() => fire({ type: "rename" })}
          />
          <MenuItem
            label={t("move")}
            onClick={() => fire({ type: "move" })}
          />
          <Divider />
          {isPinned ? (
            <MenuItem
              icon={<PinOff size={14} />}
              label={t("unpin")}
              onClick={() => fire({ type: "unpin" })}
            />
          ) : (
            <MenuItem
              icon={<Pin size={14} />}
              label={t("pin")}
              onClick={() => fire({ type: "pin" })}
            />
          )}
          <MenuItem
            icon={<Tag size={14} />}
            label={t("tags")}
            onClick={() => fire({ type: "tags" })}
          />
          <Divider />
          <MenuItem
            icon={<Trash2 size={14} />}
            label={t("trash")}
            onClick={() => fire({ type: "trash" })}
            danger
          />
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
  title,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-text-muted opacity-50"
          : danger
            ? "text-red-400 hover:bg-red-500/10"
            : "text-text-primary hover:bg-bg-primary/60",
      ].join(" ")}
    >
      {icon && (
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          {icon}
        </span>
      )}
      {!icon && <span className="h-4 w-4 flex-shrink-0" />}
      {label}
    </button>
  );
}

function Divider() {
  return <div className="my-0.5 border-t border-bg-border" />;
}
