import { describe, expect, it } from "vite-plus/test";

import { resolveChildThreadsExpanded, summarizeChildThreads } from "./SidebarChildThreads.logic";

type Child = Parameters<typeof summarizeChildThreads>[0][number];

const child = (overrides: Partial<Child> = {}): Child => ({
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  pendingSubagentRequest: null,
  pendingGuestMessageCount: 0,
  blockedOnThreadWait: false,
  runtime: null,
  ...overrides,
});
const runtime = (status: string, lastErrorClass: string | null = null) =>
  ({ status, lastErrorClass }) as unknown as Child["runtime"];

describe("summarizeChildThreads", () => {
  it("counts children by what they need from the user", () => {
    expect(
      summarizeChildThreads([
        child({ runtime: runtime("running") }),
        child({ runtime: runtime("preparing") }),
        // Waiting on its own children, or parked on background work, is still working.
        child({ runtime: runtime("running"), blockedOnThreadWait: true }),
        child({ runtime: runtime("idle") }),
        child({ runtime: runtime("running"), hasPendingApprovals: true }),
        child({ runtime: runtime("running"), hasPendingUserInput: true }),
        // A grandchild's approval rolls up through its parent.
        child({ runtime: runtime("running"), pendingSubagentRequest: "approval" }),
        child({ runtime: runtime("failed") }),
        child({ runtime: runtime("failed", "usage_limit") }),
        child({ runtime: runtime("completed") }),
        child(),
      ]),
    ).toEqual({ working: 4, input: 3, failed: 2, done: 2 });
  });
});

describe("resolveChildThreadsExpanded", () => {
  const settled = { working: 0, input: 0, failed: 1, done: 4 };
  it("opens while any child is working or needs input, and closes once all settle", () => {
    expect(resolveChildThreadsExpanded(undefined, { ...settled, working: 1 })).toBe(true);
    expect(resolveChildThreadsExpanded(undefined, { ...settled, input: 1 })).toBe(true);
    expect(resolveChildThreadsExpanded(undefined, settled)).toBe(false);
  });

  it("keeps the user's choice either way", () => {
    expect(resolveChildThreadsExpanded(true, settled)).toBe(true);
    expect(resolveChildThreadsExpanded(false, { ...settled, working: 3 })).toBe(false);
  });
});
