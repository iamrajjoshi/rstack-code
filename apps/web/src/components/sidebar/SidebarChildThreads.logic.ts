import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { childRequestReachingUser } from "@t3tools/client-runtime/state/threads";
import { isListedThreadLineage } from "@t3tools/contracts";

import { resolveSidebarThreadStatus } from "../Sidebar.logic";

type NestedThread = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "lineage" | "delegatedFrom" | "archivedAt"
>;

type ChildThreadStatusInput = NestedThread &
  Parameters<typeof resolveSidebarThreadStatus>[0] &
  Pick<EnvironmentThreadShell, "updatedAt" | "source">;

type ChildThreadRollupKind = "working" | "input" | "failed" | "done";

/** Settled children a parent lists before "show more"; the server sends as many idle ones. */
const SETTLED_CHILD_THREADS_SHOWN = 5;

const threadKeyOf = (thread: Pick<NestedThread, "environmentId" | "id">) =>
  scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });

/** The thread a subagent or delegated task nests under; null for a thread with its own row. */
export function nestedParentKey(thread: NestedThread): string | null {
  if (thread.lineage.relationshipToParent === "subagent") {
    return thread.lineage.parentThreadId === null
      ? null
      : scopedThreadKey({
          environmentId: thread.environmentId,
          threadId: thread.lineage.parentThreadId,
        });
  }
  return thread.delegatedFrom == null ? null : scopedThreadKey(thread.delegatedFrom);
}

/**
 * Only what reaches the user counts as input, the same requests that flag the parent's own row:
 * a question the child's coordinator answers is still work in progress.
 */
function ownRollupKind(thread: ChildThreadStatusInput): ChildThreadRollupKind {
  if (
    thread.pendingSubagentRequest != null ||
    childRequestReachingUser(thread.source) !== null ||
    (thread.pendingGuestMessageCount ?? 0) > 0
  ) {
    return "input";
  }
  switch (resolveSidebarThreadStatus(thread)) {
    case "approval":
    case "input":
    case "request":
    case "preparing":
    case "working":
    case "waiting":
      return "working";
    case "failed":
    case "limited":
      return "failed";
    case "ready":
      return "done";
  }
}

type ChildThreadRollup = Readonly<Record<ChildThreadRollupKind, number>>;

/**
 * Counts direct children once each, by the most pressing state in its own tree: a sub-coordinator
 * whose workers still run, or one of which needs the user, counts as working or needing input.
 */
export function summarizeChildThreads(
  children: ReadonlyArray<ChildThreadStatusInput>,
  descendants: ReadonlyArray<ChildThreadStatusInput> = [],
): { readonly rollup: ChildThreadRollup; readonly kindByKey: ReadonlyMap<string, string> } {
  const kindByKey = new Map<string, ChildThreadRollupKind>();
  for (const child of children) kindByKey.set(threadKeyOf(child), ownRollupKind(child));
  const byKey = new Map(descendants.map((thread) => [threadKeyOf(thread), thread] as const));
  for (const thread of descendants) {
    const kind = ownRollupKind(thread);
    if (kind !== "input" && kind !== "working") continue;
    const seen = new Set<string>();
    let current: ChildThreadStatusInput | undefined = thread;
    while (current !== undefined) {
      const key = threadKeyOf(current);
      if (seen.has(key)) break;
      seen.add(key);
      const childKind = kindByKey.get(key);
      if (childKind !== undefined) {
        if (childKind !== "input") kindByKey.set(key, kind);
        break;
      }
      const parentKey = nestedParentKey(current);
      current = parentKey === null ? undefined : byKey.get(parentKey);
    }
  }
  const rollup = { working: 0, input: 0, failed: 0, done: 0 };
  for (const kind of kindByKey.values()) rollup[kind] += 1;
  return { rollup, kindByKey };
}

/**
 * The user's last choice wins; until they make one, the list is open while any child is active.
 * A list holding the open thread opens without changing that choice.
 */
export function resolveChildThreadsExpanded(
  stored: boolean | undefined,
  rollup: ChildThreadRollup,
  holdsOpenThread: boolean,
): boolean {
  return holdsOpenThread || (stored ?? rollup.working + rollup.input > 0);
}

/** The open thread and its ancestors among `descendants`; empty when it is not below them. */
export function openThreadAncestry(
  openThreadKey: string | null,
  descendants: ReadonlyArray<NestedThread>,
): ReadonlySet<string> {
  if (openThreadKey === null) return new Set();
  const byKey = new Map(descendants.map((thread) => [threadKeyOf(thread), thread] as const));
  const ancestry = new Set<string>();
  let key: string | null = openThreadKey;
  while (key !== null && byKey.has(key) && !ancestry.has(key)) {
    ancestry.add(key);
    key = nestedParentKey(byKey.get(key)!);
  }
  return ancestry;
}

/**
 * Children a parent lists: every active one, any above more children or the open thread, and the
 * most recently updated settled few, in creation order. `hidden` counts the rest.
 */
export function visibleChildThreads<T extends ChildThreadStatusInput>(input: {
  readonly children: ReadonlyArray<T>;
  readonly kindByKey: ReadonlyMap<string, string>;
  readonly descendants: ReadonlyArray<NestedThread>;
  readonly openAncestry: ReadonlySet<string>;
  readonly showAll: boolean;
}): { readonly visible: ReadonlyArray<T>; readonly hidden: number } {
  if (input.showAll) return { visible: input.children, hidden: 0 };
  const parentKeys = new Set(input.descendants.map(nestedParentKey));
  const settled = input.children.filter((child) => {
    const key = threadKeyOf(child);
    const kind = input.kindByKey.get(key);
    return (
      kind !== "working" && kind !== "input" && !parentKeys.has(key) && !input.openAncestry.has(key)
    );
  });
  const shownSettled = new Set(
    settled
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, SETTLED_CHILD_THREADS_SHOWN),
  );
  const settledSet = new Set(settled);
  const visible = input.children.filter(
    (child) => !settledSet.has(child) || shownSettled.has(child),
  );
  return { visible, hidden: input.children.length - visible.length };
}

/**
 * Whether the open thread has a nested row: reached from a listed thread through subagent and
 * delegation hops only. A side chat or a broken chain leaves its listed ancestor standing in.
 */
export function isOpenThreadNested(
  openThreadKey: string,
  findThread: (key: string) => NestedThread | undefined,
): boolean {
  const seen = new Set<string>();
  let key = openThreadKey;
  let thread = findThread(key);
  while (thread !== undefined && !seen.has(key)) {
    seen.add(key);
    const parentKey = nestedParentKey(thread);
    if (parentKey === null) return key !== openThreadKey && isListedThreadLineage(thread.lineage);
    const parent = findThread(parentKey);
    if (parent === undefined || parent.archivedAt !== null) return false;
    key = parentKey;
    thread = parent;
  }
  return false;
}

/**
 * Search results with each nested thread moved under its nearest listed ancestor when that
 * ancestor is also a result, so a worker shows under its coordinator. `depth` indents it.
 */
export function nestThreadSearchResults<T extends NestedThread>(
  results: ReadonlyArray<T>,
  findThread: (key: string) => NestedThread | undefined,
): ReadonlyArray<{ readonly thread: T; readonly depth: number }> {
  const resultKeys = new Set(results.map(threadKeyOf));
  const anchorOf = new Map<string, string>();
  for (const thread of results) {
    let parentKey = nestedParentKey(thread);
    const seen = new Set<string>();
    while (parentKey !== null && !seen.has(parentKey)) {
      seen.add(parentKey);
      if (resultKeys.has(parentKey)) {
        anchorOf.set(threadKeyOf(thread), parentKey);
        break;
      }
      const parent = findThread(parentKey);
      parentKey = parent === undefined ? null : nestedParentKey(parent);
    }
  }
  const nestedUnder = new Map<string, T[]>();
  for (const thread of results) {
    const anchor = anchorOf.get(threadKeyOf(thread));
    if (anchor === undefined) continue;
    const siblings = nestedUnder.get(anchor);
    if (siblings) siblings.push(thread);
    else nestedUnder.set(anchor, [thread]);
  }
  const ordered: Array<{ readonly thread: T; readonly depth: number }> = [];
  const place = (thread: T, depth: number, seen: Set<string>) => {
    const key = threadKeyOf(thread);
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({ thread, depth });
    for (const child of nestedUnder.get(key) ?? []) place(child, depth + 1, seen);
  };
  const seen = new Set<string>();
  for (const thread of results) {
    if (!anchorOf.has(threadKeyOf(thread))) place(thread, 0, seen);
  }
  // A cycle of anchors has no root; keep its rows rather than drop them.
  for (const thread of results) place(thread, 0, seen);
  return ordered;
}
