import { EnvironmentId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isOpenThreadNested,
  nestThreadSearchResults,
  openThreadAncestry,
  resolveChildThreadsExpanded,
  summarizeChildThreads,
  visibleChildThreads,
} from "./SidebarChildThreads.logic";

type Child = Parameters<typeof summarizeChildThreads>[0][number];

const environmentId = EnvironmentId.make("env");
const remoteEnvironmentId = EnvironmentId.make("remote");
const key = (id: string, environment = environmentId) => `${environment}:${id}`;

const runtime = (status: string, lastErrorClass: string | null = null) =>
  ({ status, lastErrorClass }) as unknown as Child["runtime"];

const child = (
  id: string,
  parent: string | null,
  overrides: Partial<Child> = {},
  source: Partial<OrchestrationV2ThreadShell> = {},
): Child => ({
  id: ThreadId.make(id),
  environmentId,
  lineage: {
    parentThreadId: parent === null ? null : ThreadId.make(parent),
    relationshipToParent: parent === null ? null : "subagent",
    rootThreadId: ThreadId.make("root"),
  },
  delegatedFrom: null,
  archivedAt: null,
  updatedAt: "2026-11-19T00:00:00.000Z",
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  pendingSubagentRequest: null,
  pendingGuestMessageCount: 0,
  blockedOnThreadWait: false,
  runtime: null,
  source: {
    lineage: {
      parentThreadId: parent === null ? null : ThreadId.make(parent),
      relationshipToParent: parent === null ? null : "subagent",
      rootThreadId: ThreadId.make("root"),
    },
    pendingRuntimeRequest: null,
    status: "completed",
    activityRunStatus: null,
    ...source,
  } as OrchestrationV2ThreadShell,
  ...overrides,
});

const approval = {
  pendingRuntimeRequest: { id: "r", kind: "command", createdAt: 0 },
  status: "running",
  activityRunStatus: "running",
} as unknown as Partial<OrchestrationV2ThreadShell>;

describe("summarizeChildThreads", () => {
  it("counts children by what they need from the user", () => {
    const { rollup } = summarizeChildThreads([
      child("a", "root", { runtime: runtime("running") }),
      child("b", "root", { runtime: runtime("preparing") }),
      // Waiting on its own children, or parked on background work, is still working.
      child("c", "root", { runtime: runtime("running"), blockedOnThreadWait: true }),
      child("d", "root", { runtime: runtime("idle") }),
      // An approval reaches the user, as it flags the parent's row.
      child("e", "root", { runtime: runtime("running"), hasPendingApprovals: true }, approval),
      // A question its coordinator answers does not.
      child("f", "root", { runtime: runtime("running"), hasPendingUserInput: true }),
      // A grandchild's approval rolls up through its parent.
      child("g", "root", { runtime: runtime("running"), pendingSubagentRequest: "approval" }),
      child("h", "root", { runtime: runtime("failed") }),
      child("i", "root", { runtime: runtime("failed", "usage_limit") }),
      child("j", "root", { runtime: runtime("completed") }),
      child("k", "root"),
    ]);
    expect(rollup).toEqual({ working: 5, input: 2, failed: 2, done: 2 });
  });

  it("counts a sub-coordinator by its workers, through a task in a linked environment", () => {
    const task = {
      ...child("task", null, {}, {}),
      environmentId: remoteEnvironmentId,
      delegatedFrom: { environmentId, threadId: ThreadId.make("sub"), title: "Sub" },
    };
    const children = [child("sub", "root"), child("done", "root")];
    const descendants = [
      ...children,
      child("worker", "sub"),
      task,
      {
        ...child("task-worker", "task", { runtime: runtime("running") }),
        environmentId: remoteEnvironmentId,
      },
      child("asking", "sub", { hasPendingApprovals: true }, approval),
    ];
    const { rollup, kindByKey } = summarizeChildThreads(children, descendants);
    expect(rollup).toEqual({ working: 0, input: 1, failed: 0, done: 1 });
    expect(kindByKey.get(key("sub"))).toBe("input");

    const working = summarizeChildThreads(
      children,
      descendants.filter((thread) => thread.id !== "asking"),
    );
    expect(working.rollup).toEqual({ working: 1, input: 0, failed: 0, done: 1 });
  });
});

describe("resolveChildThreadsExpanded", () => {
  const settled = { working: 0, input: 0, failed: 1, done: 4 };
  it("opens while any child is working or needs input, and closes once all settle", () => {
    expect(resolveChildThreadsExpanded(undefined, { ...settled, working: 1 }, false)).toBe(true);
    expect(resolveChildThreadsExpanded(undefined, { ...settled, input: 1 }, false)).toBe(true);
    expect(resolveChildThreadsExpanded(undefined, settled, false)).toBe(false);
  });

  it("keeps the user's choice, except to reveal the open thread", () => {
    expect(resolveChildThreadsExpanded(true, settled, false)).toBe(true);
    expect(resolveChildThreadsExpanded(false, { ...settled, working: 3 }, false)).toBe(false);
    expect(resolveChildThreadsExpanded(false, settled, true)).toBe(true);
  });
});

describe("visibleChildThreads", () => {
  const settledChild = (index: number) =>
    child(`settled-${index}`, "root", {
      updatedAt: `2026-11-19T00:00:${String(index).padStart(2, "0")}.000Z`,
    });

  it("lists active children and the newest settled few, and counts the rest", () => {
    const children = [
      ...Array.from({ length: 30 }, (_, index) => settledChild(index)),
      child("running", "root", { runtime: runtime("running") }),
      child("sub", "root"),
    ];
    const descendants = [...children, child("worker", "sub")];
    const { kindByKey } = summarizeChildThreads(children, descendants);
    const open = openThreadAncestry(key("settled-0"), descendants);
    const { visible, hidden } = visibleChildThreads({
      children,
      kindByKey,
      descendants,
      openAncestry: open,
      showAll: false,
    });
    expect(visible.map((thread) => thread.id)).toEqual([
      // The open thread shows wherever it sorts.
      "settled-0",
      "settled-25",
      "settled-26",
      "settled-27",
      "settled-28",
      "settled-29",
      "running",
      // It holds other threads.
      "sub",
    ]);
    expect(hidden).toBe(24);
    expect(
      visibleChildThreads({
        children,
        kindByKey,
        descendants,
        openAncestry: open,
        showAll: true,
      }).hidden,
    ).toBe(0);
  });
});

describe("openThreadAncestry", () => {
  it("names a grandchild and the child above it", () => {
    const descendants = [child("sub", "root"), child("worker", "sub")];
    expect([...openThreadAncestry(key("worker"), descendants)]).toEqual([
      key("worker"),
      key("sub"),
    ]);
    expect(openThreadAncestry(key("elsewhere"), descendants).size).toBe(0);
  });
});

describe("isOpenThreadNested", () => {
  const threads = new Map<string, Child>([
    [key("root"), child("root", null)],
    [key("sub"), child("sub", "root")],
    [key("worker"), child("worker", "sub")],
    [
      key("side-chat"),
      child("side-chat", null, {
        lineage: {
          parentThreadId: ThreadId.make("root"),
          relationshipToParent: "fork",
          rootThreadId: ThreadId.make("root"),
          sideChat: true,
        },
      }),
    ],
    [key("orphan"), child("orphan", "missing")],
  ]);
  const find = (threadKey: string) => threads.get(threadKey);

  it("is true for subagents at any depth and false for side chats, listed rows, and orphans", () => {
    expect(isOpenThreadNested(key("sub"), find)).toBe(true);
    expect(isOpenThreadNested(key("worker"), find)).toBe(true);
    expect(isOpenThreadNested(key("side-chat"), find)).toBe(false);
    expect(isOpenThreadNested(key("root"), find)).toBe(false);
    expect(isOpenThreadNested(key("orphan"), find)).toBe(false);
  });
});

describe("nestThreadSearchResults", () => {
  it("moves a matching worker under its matching ancestor and keeps others in place", () => {
    const threads = new Map<string, Child>([
      [key("root"), child("root", null)],
      [key("other"), child("other", null)],
      [key("sub"), child("sub", "root")],
      [key("worker"), child("worker", "sub")],
      [key("lone"), child("lone", "other-root")],
    ]);
    const results = [
      threads.get(key("worker"))!,
      threads.get(key("other"))!,
      threads.get(key("root"))!,
      threads.get(key("lone"))!,
    ];
    expect(
      nestThreadSearchResults(results, (threadKey) => threads.get(threadKey)).map(
        ({ thread, depth }) => [thread.id, depth],
      ),
    ).toEqual([
      ["other", 0],
      ["root", 0],
      ["worker", 1],
      ["lone", 0],
    ]);
  });
});
