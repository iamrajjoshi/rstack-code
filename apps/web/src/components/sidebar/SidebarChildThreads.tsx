import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ContextMenuSource, ScopedThreadRef } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  GitBranchIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  UserRoundIcon,
} from "lucide-react";
import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useGT, useMessages } from "gt-react";

import { cn } from "~/lib/utils";
import { contextMenuSourceOf } from "../../contextMenuSource";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import {
  useOmittedSubagentCount,
  useSubagentChildren,
  useSubagentDescendants,
} from "../../state/entities";
import { threadFamilies } from "../../state/threads";
import { useUiStateStore } from "../../uiStateStore";
import { getTriggerDisplayModelName } from "../chat/providerIconUtils";
import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
  type SidebarThreadStatus,
} from "../Sidebar.logic";
import { prStatusIndicator, useLinkedThreadPullRequest } from "../ThreadStatusIndicators";
import {
  openThreadAncestry,
  resolveChildThreadsExpanded,
  summarizeChildThreads,
  visibleChildThreads,
} from "./SidebarChildThreads.logic";
import type { SidebarProviderEntry } from "./SidebarThreadRow";

// A cycle in lineage can't happen, but a bad row must not recurse forever.
const MAX_DEPTH = 8;

type ChildThreadContextMenu = (
  threadRef: ScopedThreadRef,
  position: { x: number; y: number },
  source: ContextMenuSource,
) => void;

interface SidebarChildThreadsProps {
  readonly parentRef: ScopedThreadRef;
  /** The open thread while it is somewhere below this parent; null otherwise. */
  readonly openThreadKey: string | null;
  readonly providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  readonly onThreadActivate: (threadRef: ScopedThreadRef) => void;
  readonly onContextMenu: ChildThreadContextMenu;
  readonly depth?: number;
}

/** A parent row's subagents: a rollup that toggles the list, and a row for each child. */
export function SidebarChildThreads(props: SidebarChildThreadsProps) {
  const gt = useGT();
  const children = useSubagentChildren(props.parentRef);
  const descendants = useSubagentDescendants(props.parentRef);
  const omitted = useOmittedSubagentCount(props.parentRef);
  const parentKey = scopedThreadKey(props.parentRef);
  const stored = useUiStateStore((state) => state.threadChildrenExpandedById[parentKey]);
  const setExpanded = useUiStateStore((state) => state.setThreadChildrenExpanded);
  const [showAll, setShowAll] = useState(false);
  const depth = props.depth ?? 0;
  const { rollup, kindByKey } = summarizeChildThreads(children, descendants);
  const openAncestry = openThreadAncestry(props.openThreadKey, descendants);
  const expanded = resolveChildThreadsExpanded(stored, rollup, openAncestry.size > 0);
  // The shell sends only a parent's newest idle children; the rest come with its family.
  const loadsFamily = expanded && showAll && omitted > 0;
  const { environmentId, threadId } = props.parentRef;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the parent's thread family in the registry while its full child list is shown
  useEffect(() => {
    if (!loadsFamily) return;
    return threadFamilies.mount(appAtomRegistry, environmentId, threadId);
  }, [loadsFamily, environmentId, threadId]);
  if (children.length === 0 || depth >= MAX_DEPTH) return null;
  const { visible, hidden } = visibleChildThreads({
    children,
    kindByKey,
    descendants,
    openAncestry,
    showAll,
  });
  const moreCount = showAll ? 0 : hidden + omitted;
  const toggleId = `children:${parentKey}`;
  const summary = [
    rollup.working > 0
      ? gt("{count, plural, one {{count} working} other {{count} working}}", {
          count: rollup.working,
          $context: "sidebar subagent rollup",
        })
      : null,
    rollup.input > 0
      ? gt("{count, plural, one {{count} needs input} other {{count} need input}}", {
          count: rollup.input,
          $context: "sidebar subagent rollup",
        })
      : null,
    rollup.failed > 0
      ? gt("{count, plural, one {{count} failed} other {{count} failed}}", {
          count: rollup.failed,
          $context: "sidebar subagent rollup",
        })
      : null,
    rollup.done > 0
      ? gt("{count, plural, one {{count} done} other {{count} done}}", {
          count: rollup.done,
          $context: "sidebar subagent rollup",
        })
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <div className="ms-3 border-s border-sidebar-border/70 ps-1">
      <button
        type="button"
        data-sidebar-row={toggleId}
        data-sidebar-parent={parentKey}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? gt("Hide subagents: {summary}", { summary })
            : gt("Show subagents: {summary}", { summary })
        }
        onClick={() => setExpanded(parentKey, !expanded)}
        className="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronDownIcon
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", !expanded && "-rotate-90")}
        />
        <span
          className={cn(
            "min-w-0 truncate tabular-nums",
            rollup.input > 0 && "text-warning-foreground",
          )}
        >
          {summary}
        </span>
      </button>
      {expanded ? (
        <ul role="group" className="flex flex-col gap-px">
          {visible.map((child) => (
            <SidebarChildThreadRow
              key={scopedThreadKey(scopeThreadRef(child.environmentId, child.id))}
              thread={child}
              navigationParent={toggleId}
              openThreadKey={props.openThreadKey}
              providerEntryByInstanceId={props.providerEntryByInstanceId}
              onThreadActivate={props.onThreadActivate}
              onContextMenu={props.onContextMenu}
              depth={depth}
            />
          ))}
          {moreCount > 0 ? (
            <li className="list-none">
              <button
                type="button"
                data-sidebar-row={`more:${parentKey}`}
                data-sidebar-parent={toggleId}
                onClick={() => setShowAll(true)}
                className="flex h-6 w-full cursor-pointer items-center rounded-md px-1.5 text-left text-xs text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {gt("{count, plural, one {Show {count} more} other {Show {count} more}}", {
                  count: moreCount,
                  $context: "sidebar subagent list",
                })}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

const STATUS_ICON: Record<SidebarThreadStatus, { icon: typeof CircleDashedIcon; color: string }> = {
  preparing: { icon: CircleDashedIcon, color: "text-info-foreground" },
  working: { icon: CircleDashedIcon, color: "text-info-foreground" },
  waiting: { icon: CircleDotDashedIcon, color: "text-muted-foreground" },
  approval: { icon: ShieldQuestionIcon, color: "text-warning-foreground" },
  input: { icon: MessageCircleQuestionIcon, color: "text-indigo-600 dark:text-indigo-300" },
  request: { icon: UserRoundIcon, color: "text-guest-foreground" },
  limited: { icon: CircleAlertIcon, color: "text-warning-foreground" },
  failed: { icon: CircleAlertIcon, color: "text-error-foreground" },
  ready: { icon: CircleCheckIcon, color: "text-sidebar-muted-foreground" },
};

function SidebarChildThreadRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly navigationParent: string;
  readonly openThreadKey: string | null;
  readonly providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  readonly onThreadActivate: (threadRef: ScopedThreadRef) => void;
  readonly onContextMenu: ChildThreadContextMenu;
  readonly depth: number;
}) {
  const gt = useGT();
  const messages = useMessages();
  const { thread } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  // Only what the shell already carries: no pull request read starts for a child row.
  const linkedPullRequest = useLinkedThreadPullRequest(
    thread.environmentId,
    thread.linkedPullRequest,
    false,
    thread.pullRequests,
    thread.branchPullRequest,
  );
  const prStatus = prStatusIndicator(
    linkedPullRequest?.pr ?? null,
    linkedPullRequest?.sourceControlProvider,
    messages,
  );
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const status = resolveSidebarRowStatus({ ...thread, lastVisitedAt });
  const isUnread = status === "ready" && hasUnseenCompletion({ ...thread, lastVisitedAt });
  const statusLabel = {
    preparing: gt("Setting up"),
    working: gt("Working", { $context: "thread status" }),
    waiting: gt("Waiting", { $context: "thread status" }),
    approval: gt("Approval", { $context: "thread status: needs approval" }),
    input: gt("Input", { $context: "thread status: needs user input" }),
    request: gt("Request", { $context: "thread status: guest request" }),
    limited: gt("Limited", { $context: "thread status: usage limited" }),
    failed: gt("Failed", { $context: "thread status" }),
    ready: gt("Done", { $context: "thread status" }),
  }[status];
  const { icon: StatusIcon, color } = STATUS_ICON[status];
  const providerEntry =
    props.providerEntryByInstanceId.get(
      thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId,
    ) ?? null;
  const model = providerEntry?.models.find((entry) => entry.slug === thread.modelSelection.model);
  const modelLabel = model
    ? getTriggerDisplayModelName(model, providerEntry?.driverKind)
    : thread.modelSelection.model;
  const isOpen = props.openThreadKey === threadKey;
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    props.onThreadActivate(threadRef);
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    props.onContextMenu(
      threadRef,
      { x: event.clientX, y: event.clientY },
      contextMenuSourceOf(event),
    );
  };
  return (
    <li className="list-none">
      <div
        role="button"
        tabIndex={0}
        data-sidebar-row={threadKey}
        data-sidebar-parent={props.navigationParent}
        aria-label={`${thread.title}, ${statusLabel}`}
        aria-current={isOpen ? "page" : undefined}
        onClick={() => props.onThreadActivate(threadRef)}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        className={cn(
          "flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left text-xs outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          isOpen
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "text-sidebar-foreground/90 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        )}
      >
        <StatusIcon
          aria-hidden
          className={cn("size-3.5 shrink-0", isUnread ? "text-success-foreground" : color)}
        />
        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
        {prStatus ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-0.5 text-2xs",
              prStatus.colorClass,
            )}
          >
            <prStatus.Icon aria-hidden className="size-3" />
            <span className="tabular-nums">#{linkedPullRequest?.pr?.number}</span>
          </span>
        ) : thread.branch ? (
          <span className="inline-flex max-w-[35%] shrink-0 items-center gap-0.5 text-2xs text-sidebar-muted-foreground">
            <GitBranchIcon aria-hidden className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{thread.branch}</span>
          </span>
        ) : null}
        {modelLabel ? (
          <span className="max-w-[35%] shrink-0 truncate text-2xs text-sidebar-muted-foreground">
            {modelLabel}
          </span>
        ) : null}
      </div>
      <SidebarChildThreads
        parentRef={threadRef}
        openThreadKey={props.openThreadKey}
        providerEntryByInstanceId={props.providerEntryByInstanceId}
        onThreadActivate={props.onThreadActivate}
        onContextMenu={props.onContextMenu}
        depth={props.depth + 1}
      />
    </li>
  );
}
