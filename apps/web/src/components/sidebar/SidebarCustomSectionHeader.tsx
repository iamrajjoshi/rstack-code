import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ContextMenuSource } from "@t3tools/contracts";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useGT, useMessages } from "gt-react";
import { memo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { cn } from "~/lib/utils";
import { contextMenuSourceOf } from "../../contextMenuSource";
import { useUiStateStore } from "../../uiStateStore";
import {
  animateSidebarLayoutChanges,
  resolveSidebarFolderDot,
  resolveThreadLastVisitedAt,
  sidebarMarkerId,
} from "../Sidebar.logic";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { FOLDER_DOT_CLASS_NAME, FOLDER_DOT_LABEL } from "./SidebarProjectFolderHeader";
import { SIDEBAR_SECTION_HEADER_PREFIX } from "./SidebarSections.logic";

/** The section's sidebar tree row; its thread rows name it as their parent. */
export function sidebarSectionRowId(sectionId: string) {
  return `section:${sectionId}`;
}

// Mounted only while renaming, so each rename starts from the saved name.
function SectionNameInput(props: { name: string; onDone: (name: string | null) => void }) {
  const gt = useGT();
  const [value, setValue] = useState(props.name);
  // Enter and Escape blur the input as it unmounts; that blur must not commit again.
  const settledRef = useRef(false);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      settledRef.current = true;
      props.onDone(event.key === "Enter" ? value : null);
    }
  };
  return (
    <input
      autoFocus
      value={value}
      dir="auto"
      maxLength={120}
      aria-label={gt("Section name")}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (!settledRef.current) props.onDone(value);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className="mx-0.5 h-7 w-[calc(100%-4px)] min-w-0 rounded-sm bg-card px-1.5 text-xs font-medium text-card-foreground outline-none ring-1 ring-inset ring-input focus:ring-foreground"
    />
  );
}

/**
 * A section the user made. It reads like the Coordinators and Threads headers, drags by the
 * header to reorder, and a folded one keeps a dot when a thread inside needs the person.
 */
export const SidebarCustomSectionHeader = memo(function SidebarCustomSectionHeader(props: {
  sectionId: string;
  name: string;
  count: number;
  collapsed: boolean;
  /** Threads the fold hides, for the attention dot. */
  hiddenThreads: readonly EnvironmentThreadShell[];
  renaming: boolean;
  draggable: boolean;
  /** A thread or section drag is over this section. */
  isDropTarget: boolean;
  /** Some drag is in progress, so headers read as targets. */
  dragging: boolean;
  onToggle: (sectionId: string) => void;
  onRenameDone: (sectionId: string, name: string | null) => void;
  onContextMenu: (
    sectionId: string,
    position: { x: number; y: number },
    source: ContextMenuSource,
  ) => void;
}) {
  const m = useMessages();
  const rowId = sidebarSectionRowId(props.sectionId);
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: sidebarMarkerId(`${SIDEBAR_SECTION_HEADER_PREFIX}${props.sectionId}`),
    disabled: props.draggable && !props.renaming ? { draggable: false } : { draggable: true },
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const dot = props.collapsed
    ? resolveSidebarFolderDot(
        props.hiddenThreads.map((thread) => ({
          ...thread,
          lastVisitedAt: resolveThreadLastVisitedAt(
            thread.lastVisitedAt,
            localLastVisitedAtById[
              scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
            ],
          ),
        })),
      )
    : null;
  return (
    <li
      ref={setNodeRef}
      data-thread-selection-safe
      data-testid={`sidebar-section-${props.sectionId}`}
      className={cn("relative mx-0.5 h-8 list-none", isDragging && "z-10 rounded-md bg-sidebar")}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
      {...(props.renaming ? {} : listeners)}
    >
      {props.renaming ? (
        <SectionNameInput
          name={props.name}
          onDone={(name) => props.onRenameDone(props.sectionId, name)}
        />
      ) : (
        <CollapsibleSectionHeader
          data-sidebar-row={rowId}
          data-testid={`sidebar-section-toggle-${props.sectionId}`}
          onClick={() => props.onToggle(props.sectionId)}
          onContextMenu={(event) => {
            event.preventDefault();
            props.onContextMenu(
              props.sectionId,
              { x: event.clientX, y: event.clientY },
              contextMenuSourceOf(event),
            );
          }}
          expanded={!props.collapsed}
          tone={props.isDropTarget ? "accent" : props.dragging ? "emphasized" : "muted"}
          accessory={
            <span className="flex items-center gap-1.5">
              {dot ? (
                <span className={cn("size-1.5 shrink-0 rounded-full", FOLDER_DOT_CLASS_NAME[dot])}>
                  <span className="sr-only">{m(FOLDER_DOT_LABEL[dot])}</span>
                </span>
              ) : null}
              <span className="font-normal tabular-nums">{props.count}</span>
            </span>
          }
        >
          {props.name}
        </CollapsibleSectionHeader>
      )}
    </li>
  );
});
