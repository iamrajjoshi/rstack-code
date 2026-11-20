import { describe, expect, it } from "@effect/vitest";
import { ThreadId, type ClaudeSessionTreeManifest } from "@t3tools/contracts";

import {
  buildClaudeSessionTreeManifest,
  planClaudeSessionTree,
  type ClaudeSessionTreeAction,
  type ImportedClaudeThread,
} from "./ClaudeSessionTree.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Synthetic desktop session files, shaped like `local_<id>.json`.
const desktopFiles = [
  {
    sessionId: "local_root",
    cliSessionId: uuid(1),
    title: "Coordinator",
    cwd: "/repo",
    createdAt: 1_000,
    lastActivityAt: 9_000,
    model: "claude-opus",
    isArchived: false,
    sshRemoteTranscriptPath: `/home/u/.claude/projects/-repo/${uuid(1)}.jsonl`,
  },
  {
    sessionId: "local_worker",
    cliSessionId: uuid(9),
    lastAssistantCliSessionId: uuid(9),
    title: "Worker",
    cwd: "/repo/.claude/worktrees/w",
    worktreePath: "/repo/.claude/worktrees/w",
    branch: "w",
    createdAt: 2_000,
    lastActivityAt: 3_000,
    isArchived: true,
    // The transcript on the host names the id to resume.
    sshRemoteTranscriptPath: `/home/u/.claude/projects/-repo/${uuid(2)}.jsonl`,
    spawnedFrom: { sessionId: "local_root", sideSession: true },
  },
  {
    sessionId: "local_question",
    cliSessionId: uuid(3),
    title: "Side question",
    cwd: "/repo",
    createdAt: 2_500,
    spawnedFrom: { sessionId: "local_root", btw: true, userFork: true },
  },
  {
    sessionId: "local_detached",
    cliSessionId: uuid(4),
    title: "Detached",
    cwd: "/repo",
    lineageDetached: true,
    spawnedFrom: { sessionId: "local_root" },
  },
  { scheduledTasks: [] },
];

describe("buildClaudeSessionTreeManifest", () => {
  it("maps desktop sessions to Claude session ids, parents and roles", () => {
    const manifest = buildClaudeSessionTreeManifest(desktopFiles);
    expect(manifest.sessions).toEqual([
      {
        sessionId: uuid(1),
        otherSessionIds: [],
        title: "Coordinator",
        parentSessionId: null,
        relationship: null,
        coordinator: true,
        cwd: "/repo",
        worktreePath: null,
        branch: null,
        model: "claude-opus",
        createdAt: "1970-01-01T00:00:01.000Z",
        lastActiveAt: "1970-01-01T00:00:09.000Z",
        archived: false,
      },
      {
        sessionId: uuid(2),
        otherSessionIds: [uuid(9)],
        title: "Worker",
        parentSessionId: uuid(1),
        relationship: "worker",
        coordinator: false,
        cwd: "/repo/.claude/worktrees/w",
        worktreePath: "/repo/.claude/worktrees/w",
        branch: "w",
        model: null,
        createdAt: "1970-01-01T00:00:02.000Z",
        lastActiveAt: "1970-01-01T00:00:03.000Z",
        archived: true,
      },
      expect.objectContaining({
        sessionId: uuid(3),
        parentSessionId: uuid(1),
        relationship: "side-question",
      }),
      expect.objectContaining({ sessionId: uuid(4), parentSessionId: null, relationship: null }),
    ]);
  });
});

const entry = (
  sessionId: string,
  overrides: Partial<ClaudeSessionTreeManifest["sessions"][number]> = {},
): ClaudeSessionTreeManifest["sessions"][number] => ({
  sessionId,
  otherSessionIds: [],
  title: `Title ${sessionId}`,
  parentSessionId: null,
  relationship: null,
  coordinator: false,
  cwd: "/repo",
  worktreePath: null,
  branch: null,
  model: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  lastActiveAt: "2026-11-02T00:00:00.000Z",
  archived: false,
  ...overrides,
});

const imported = (
  nativeSessionId: string,
  overrides: Partial<ImportedClaudeThread> = {},
): ImportedClaudeThread => {
  const threadId = ThreadId.make(`import:claudeAgent:${nativeSessionId}`);
  return {
    threadId,
    nativeSessionIds: [nativeSessionId],
    title: "First prompt",
    titleRenamed: false,
    coordinator: false,
    settled: true,
    archived: false,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    ...overrides,
  };
};

/** Applies a plan the way the commands do, so a second plan shows what a re-run would change. */
function applyPlan(
  threads: ReadonlyArray<ImportedClaudeThread>,
  actions: ReadonlyArray<ClaudeSessionTreeAction>,
): ReadonlyArray<ImportedClaudeThread> {
  const byId = new Map(threads.map((thread) => [thread.threadId, thread] as const));
  for (const action of actions) {
    const thread = byId.get(action.threadId)!;
    if (action.type === "link") {
      const parent = byId.get(action.parentThreadId)!;
      byId.set(thread.threadId, {
        ...thread,
        lineage: {
          parentThreadId: parent.threadId,
          relationshipToParent: "subagent",
          rootThreadId: parent.lineage.rootThreadId,
        },
      });
    } else if (action.type === "metadata") {
      byId.set(thread.threadId, {
        ...thread,
        ...(action.title === undefined ? {} : { title: action.title, titleRenamed: true }),
        ...(action.coordinator === undefined ? {} : { coordinator: true }),
      });
    } else {
      byId.set(thread.threadId, { ...thread, settled: false });
    }
  }
  return [...byId.values()];
}

describe("planClaudeSessionTree", () => {
  const manifest: ClaudeSessionTreeManifest = {
    version: 1,
    sessions: [
      entry("root", { coordinator: true }),
      entry("worker", {
        parentSessionId: "root",
        relationship: "worker",
        otherSessionIds: ["worker-old"],
        archived: true,
      }),
      entry("grandchild", { parentSessionId: "worker", relationship: "worker" }),
      entry("orphan", { parentSessionId: "never-imported", relationship: "worker" }),
      entry("never-imported"),
      entry("cycle-a", { parentSessionId: "cycle-b" }),
      entry("cycle-b", { parentSessionId: "cycle-a" }),
    ],
  };
  // Listed child first, so links must still come out parents first.
  const threads = [
    imported("grandchild"),
    imported("worker-old"),
    imported("root", { title: "Renamed here", titleRenamed: true }),
    imported("orphan"),
    imported("cycle-a"),
    imported("cycle-b"),
    imported("not-in-manifest"),
  ];

  it("links by session id alias, parents first, and is idempotent", () => {
    const plan = planClaudeSessionTree(manifest, threads);
    expect(plan.result).toEqual({
      matched: 6,
      linked: 2,
      alreadyLinked: 0,
      parentMissing: 1,
      notImported: 1,
      cycles: 2,
      coordinatorsSet: 1,
      titlesSet: 5,
      unsettled: 5,
      staySettled: 2,
    });
    expect(plan.actions.filter((action) => action.type === "link")).toEqual([
      {
        type: "link",
        threadId: "import:claudeAgent:worker-old",
        parentThreadId: "import:claudeAgent:root",
      },
      {
        type: "link",
        threadId: "import:claudeAgent:grandchild",
        parentThreadId: "import:claudeAgent:worker-old",
      },
    ]);
    // A title renamed in the app stays; the archived worker stays settled.
    expect(plan.actions).toContainEqual({
      type: "metadata",
      threadId: "import:claudeAgent:root",
      coordinator: true,
    });
    expect(plan.actions).not.toContainEqual(
      expect.objectContaining({ type: "unsettle", threadId: "import:claudeAgent:worker-old" }),
    );
    expect(plan.actions).toContainEqual({
      type: "unsettle",
      threadId: "import:claudeAgent:grandchild",
      lastActiveAt: "2026-11-02T00:00:00.000Z",
    });

    const again = planClaudeSessionTree(manifest, applyPlan(threads, plan.actions));
    expect(again.actions).toEqual([]);
    expect(again.result).toMatchObject({ linked: 0, alreadyLinked: 2, staySettled: 2 });
  });

  it("re-roots descendants when a parent is imported later", () => {
    const first = planClaudeSessionTree(manifest, [imported("worker-old"), imported("grandchild")]);
    const linkedEarly = applyPlan([imported("worker-old"), imported("grandchild")], first.actions);
    expect(first.result).toMatchObject({ linked: 1, parentMissing: 1 });

    const later = planClaudeSessionTree(manifest, [imported("root"), ...linkedEarly]);
    expect(later.actions.filter((action) => action.type === "link")).toEqual([
      {
        type: "link",
        threadId: "import:claudeAgent:worker-old",
        parentThreadId: "import:claudeAgent:root",
      },
      {
        type: "link",
        threadId: "import:claudeAgent:grandchild",
        parentThreadId: "import:claudeAgent:worker-old",
      },
    ]);
  });

  it("unsettles threads missing from the manifest only when asked", () => {
    const unlisted = [imported("not-in-manifest")];
    expect(planClaudeSessionTree(manifest, unlisted).actions).toEqual([]);
    expect(planClaudeSessionTree(manifest, unlisted, { unsettleUnlisted: true }).actions).toEqual([
      { type: "unsettle", threadId: "import:claudeAgent:not-in-manifest", lastActiveAt: null },
    ]);
  });
});
