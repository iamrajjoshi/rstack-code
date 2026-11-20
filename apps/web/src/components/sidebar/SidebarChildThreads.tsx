import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  UserRoundIcon,
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useGT } from "gt-react";

import { cn } from "~/lib/utils";
import { useSubagentChildren } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import { getTriggerDisplayModelName } from "../chat/providerIconUtils";
import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
  type SidebarThreadStatus,
} from "../Sidebar.logic";
import { resolveChildThreadsExpanded, summarizeChildThreads } from "./SidebarChildThreads.logic";
import type { SidebarProviderEntry } from "./SidebarThreadRow";

// A cycle in lineage can't happen, but a bad row must not recurse forever.
const MAX_DEPTH = 8;

interface SidebarChildThreadsProps {
  readonly parentRef: ScopedThreadRef;
  /** The open thread while it is somewhere below this parent; null otherwise. */
  readonly openThreadKey: string | null;
  readonly providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  readonly onThreadActivate: (threadRef: ScopedThreadRef) => void;
  readonly depth?: number;
}

/** A parent row's subagents: a rollup that toggles the list, and a row for each child. */
export function SidebarChildThreads(props: SidebarChildThreadsProps) {
  const gt = useGT();
  const children = useSubagentChildren(props.parentRef);
  const parentKey = scopedThreadKey(props.parentRef);
  const stored = useUiStateStore((state) => state.threadChildrenExpandedById[parentKey]);
  const setExpanded = useUiStateStore((state) => state.setThreadChildrenExpanded);
  const depth = props.depth ?? 0;
  if (children.length === 0 || depth >= MAX_DEPTH) return null;
  const rollup = summarizeChildThreads(children);
  const expanded = resolveChildThreadsExpanded(stored, rollup);
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
        <span className="min-w-0 truncate tabular-nums">{summary}</span>
      </button>
      {expanded ? (
        <ul role="group" className="flex flex-col gap-px">
          {children.map((child) => (
            <SidebarChildThreadRow
              key={child.id}
              thread={child}
              navigationParent={toggleId}
              openThreadKey={props.openThreadKey}
              providerEntryByInstanceId={props.providerEntryByInstanceId}
              onThreadActivate={props.onThreadActivate}
              depth={depth}
            />
          ))}
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
  readonly depth: number;
}) {
  const gt = useGT();
  const { thread } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
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
        {modelLabel ? (
          <span className="max-w-[45%] shrink-0 truncate text-2xs text-sidebar-muted-foreground">
            {modelLabel}
          </span>
        ) : null}
      </div>
      <SidebarChildThreads
        parentRef={threadRef}
        openThreadKey={props.openThreadKey}
        providerEntryByInstanceId={props.providerEntryByInstanceId}
        onThreadActivate={props.onThreadActivate}
        depth={props.depth + 1}
      />
    </li>
  );
}
