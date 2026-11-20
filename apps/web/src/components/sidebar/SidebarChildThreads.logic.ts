import { resolveSidebarThreadStatus, type SidebarThreadStatus } from "../Sidebar.logic";

type ChildThreadStatusInput = Parameters<typeof resolveSidebarThreadStatus>[0];

type ChildThreadRollupKind = "working" | "input" | "failed" | "done";

function childThreadRollupKind(status: SidebarThreadStatus): ChildThreadRollupKind {
  switch (status) {
    case "approval":
    case "input":
    case "request":
      return "input";
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

export function summarizeChildThreads(
  children: ReadonlyArray<ChildThreadStatusInput>,
): ChildThreadRollup {
  const rollup = { working: 0, input: 0, failed: 0, done: 0 };
  for (const child of children) {
    rollup[childThreadRollupKind(resolveSidebarThreadStatus(child))] += 1;
  }
  return rollup;
}

/** The user's last choice wins; until they make one, the list is open while any child is active. */
export function resolveChildThreadsExpanded(
  stored: boolean | undefined,
  rollup: ChildThreadRollup,
): boolean {
  return stored ?? rollup.working + rollup.input > 0;
}
