import type {
  ClaudeSessionTreeApplyResult,
  ClaudeSessionTreeEntry,
  ClaudeSessionTreeManifest,
  OrchestrationV2AppThreadLineage,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

/** The fields this reads from a Claude desktop app `local_<id>.json` session file. */
const DesktopSessionRecord = Schema.Struct({
  sessionId: Schema.String,
  cliSessionId: Schema.String,
  title: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.Number),
  lastActivityAt: Schema.optional(Schema.Number),
  model: Schema.optional(Schema.String),
  isArchived: Schema.optional(Schema.Boolean),
  worktreePath: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  lastAssistantCliSessionId: Schema.optional(Schema.String),
  priorRemoteCliSessionIds: Schema.optional(Schema.Array(Schema.String)),
  sshRemoteTranscriptPath: Schema.optional(Schema.String),
  lineageDetached: Schema.optional(Schema.Boolean),
  spawnedFrom: Schema.optional(
    Schema.Struct({
      sessionId: Schema.String,
      btw: Schema.optional(Schema.Boolean),
      userFork: Schema.optional(Schema.Boolean),
    }),
  ),
});
type DesktopSessionRecord = typeof DesktopSessionRecord.Type;
const decodeDesktopSessionRecord = Schema.decodeUnknownOption(DesktopSessionRecord);

const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SSH sessions name their transcript on the host; its file name is the id to resume. */
function claudeSessionId(record: DesktopSessionRecord): string {
  const fileName = record.sshRemoteTranscriptPath
    ?.split("/")
    .at(-1)
    ?.replace(/\.jsonl$/, "");
  return fileName !== undefined && CLAUDE_SESSION_ID.test(fileName)
    ? fileName
    : record.cliSessionId.trim();
}

const isoOrEpoch = (ms: number | undefined) => DateTime.formatIso(DateTime.makeUnsafe(ms ?? 0));
const nonEmpty = (value: string | undefined) =>
  value === undefined || value.trim() === "" ? null : value;

/** Builds the manifest from parsed session files; files that are not sessions are skipped. */
export function buildClaudeSessionTreeManifest(
  files: ReadonlyArray<unknown>,
): ClaudeSessionTreeManifest {
  const records = files.flatMap((file) => {
    const decoded = decodeDesktopSessionRecord(file);
    return decoded._tag === "Some" && decoded.value.cliSessionId.trim() !== ""
      ? [decoded.value]
      : [];
  });
  const byDesktopId = new Map(records.map((record) => [record.sessionId, record] as const));
  const parentOf = (record: DesktopSessionRecord) =>
    record.lineageDetached === true || record.spawnedFrom === undefined
      ? undefined
      : byDesktopId.get(record.spawnedFrom.sessionId);
  const relationshipOf = (record: DesktopSessionRecord): ClaudeSessionTreeEntry["relationship"] =>
    parentOf(record) === undefined
      ? null
      : record.spawnedFrom?.btw === true
        ? "side-question"
        : record.spawnedFrom?.userFork === true
          ? "fork"
          : "worker";
  const coordinators = new Set(
    records.flatMap((record) => {
      const parent = parentOf(record);
      return parent !== undefined && relationshipOf(record) === "worker" ? [parent.sessionId] : [];
    }),
  );
  const sessions = records.map((record): ClaudeSessionTreeEntry => {
    const sessionId = claudeSessionId(record);
    const parent = parentOf(record);
    const otherSessionIds = [
      record.cliSessionId,
      record.lastAssistantCliSessionId,
      ...(record.priorRemoteCliSessionIds ?? []),
    ].flatMap((id) => (id === undefined || id.trim() === "" ? [] : [id.trim()]));
    return {
      sessionId,
      otherSessionIds: [...new Set(otherSessionIds)].filter((id) => id !== sessionId),
      title: record.title?.trim() ?? "",
      parentSessionId: parent === undefined ? null : claudeSessionId(parent),
      relationship: relationshipOf(record),
      coordinator: coordinators.has(record.sessionId),
      cwd: record.cwd ?? "",
      worktreePath: nonEmpty(record.worktreePath),
      branch: nonEmpty(record.branch),
      model: nonEmpty(record.model),
      createdAt: isoOrEpoch(record.createdAt),
      lastActiveAt: isoOrEpoch(record.lastActivityAt ?? record.createdAt),
      archived: record.isArchived === true,
    };
  });
  return { version: 1, sessions };
}

/** An imported Claude thread, as the applier reads it. */
export interface ImportedClaudeThread {
  readonly threadId: ThreadId;
  /** Claude session ids the importer bound the thread to. */
  readonly nativeSessionIds: ReadonlyArray<string>;
  readonly title: string;
  readonly titleRenamed: boolean;
  readonly coordinator: boolean;
  readonly settled: boolean;
  readonly archived: boolean;
  readonly lineage: OrchestrationV2AppThreadLineage;
}

export type ClaudeSessionTreeAction =
  | { readonly type: "link"; readonly threadId: ThreadId; readonly parentThreadId: ThreadId }
  | {
      readonly type: "metadata";
      readonly threadId: ThreadId;
      readonly title?: string;
      readonly coordinator?: true;
    }
  | {
      readonly type: "unsettle";
      readonly threadId: ThreadId;
      readonly lastActiveAt: string | null;
    };

export interface ClaudeSessionTreePlan {
  /** Links come parents first, so each child's root follows its parent's new root. */
  readonly actions: ReadonlyArray<ClaudeSessionTreeAction>;
  readonly result: ClaudeSessionTreeApplyResult;
}

/** Decides what to change so imported threads match the manifest. Pure, so a re-run plans nothing. */
export function planClaudeSessionTree(
  manifest: ClaudeSessionTreeManifest,
  threads: ReadonlyArray<ImportedClaudeThread>,
  options: { readonly unsettleUnlisted?: boolean } = {},
): ClaudeSessionTreePlan {
  const entries = new Map(manifest.sessions.map((entry) => [entry.sessionId, entry] as const));
  const canonical = new Map<string, string>();
  for (const entry of manifest.sessions) {
    for (const id of entry.otherSessionIds)
      if (!canonical.has(id)) canonical.set(id, entry.sessionId);
  }
  for (const entry of manifest.sessions) canonical.set(entry.sessionId, entry.sessionId);

  const cycles = new Set<string>();
  for (const entry of manifest.sessions) {
    const path: Array<string> = [];
    for (let id: string | null = entry.sessionId; id !== null;) {
      const at = path.indexOf(id);
      if (at !== -1) {
        for (const member of path.slice(at)) cycles.add(member);
        break;
      }
      path.push(id);
      id = entries.get(id)?.parentSessionId ?? null;
    }
  }

  const entryOf = new Map<ThreadId, ClaudeSessionTreeEntry>();
  const threadOf = new Map<string, ImportedClaudeThread>();
  for (const thread of threads) {
    const sessionId = thread.nativeSessionIds
      .map((id) => canonical.get(id))
      .find((id) => id !== undefined);
    const entry = sessionId === undefined ? undefined : entries.get(sessionId);
    if (entry === undefined) continue;
    entryOf.set(thread.threadId, entry);
    // Two threads of one session: the one bound to its main id is the parent of its children.
    const current = threadOf.get(entry.sessionId);
    if (current === undefined || thread.nativeSessionIds.includes(entry.sessionId)) {
      threadOf.set(entry.sessionId, thread);
    }
  }

  const parentOf = (thread: ImportedClaudeThread) => {
    const entry = entryOf.get(thread.threadId);
    if (entry === undefined || entry.parentSessionId === null || cycles.has(entry.sessionId)) {
      return undefined;
    }
    return threadOf.get(entry.parentSessionId);
  };
  const depth = (thread: ImportedClaudeThread): number => {
    const parent = parentOf(thread);
    return parent === undefined ? 0 : depth(parent) + 1;
  };
  const rootOf = (thread: ImportedClaudeThread): ThreadId => {
    const parent = parentOf(thread);
    return parent === undefined ? thread.lineage.rootThreadId : rootOf(parent);
  };

  const links: Array<{ readonly depth: number; readonly action: ClaudeSessionTreeAction }> = [];
  const others: Array<ClaudeSessionTreeAction> = [];
  let alreadyLinked = 0;
  let parentMissing = 0;
  let coordinatorsSet = 0;
  let titlesSet = 0;
  let unsettled = 0;
  let staySettled = 0;
  for (const thread of threads) {
    const entry = entryOf.get(thread.threadId);
    if (entry === undefined) {
      if (!thread.settled || thread.archived) continue;
      if (options.unsettleUnlisted === true) {
        unsettled += 1;
        others.push({ type: "unsettle", threadId: thread.threadId, lastActiveAt: null });
      } else {
        staySettled += 1;
      }
      continue;
    }
    const parent = parentOf(thread);
    if (parent !== undefined) {
      const linked =
        thread.lineage.parentThreadId === parent.threadId &&
        thread.lineage.relationshipToParent === "subagent" &&
        thread.lineage.rootThreadId === rootOf(parent) &&
        thread.lineage.sideChat !== true;
      if (linked) alreadyLinked += 1;
      else {
        links.push({
          depth: depth(thread),
          action: { type: "link", threadId: thread.threadId, parentThreadId: parent.threadId },
        });
      }
    } else if (entry.parentSessionId !== null && !cycles.has(entry.sessionId)) {
      parentMissing += 1;
    }
    const setCoordinator = entry.coordinator && !thread.coordinator;
    const setTitle = entry.title !== "" && !thread.titleRenamed && entry.title !== thread.title;
    if (setCoordinator) coordinatorsSet += 1;
    if (setTitle) titlesSet += 1;
    if (setCoordinator || setTitle) {
      others.push({
        type: "metadata",
        threadId: thread.threadId,
        ...(setTitle ? { title: entry.title } : {}),
        ...(setCoordinator ? { coordinator: true as const } : {}),
      });
    }
    if (thread.settled && !thread.archived) {
      if (entry.archived) staySettled += 1;
      else {
        unsettled += 1;
        others.push({
          type: "unsettle",
          threadId: thread.threadId,
          lastActiveAt: entry.lastActiveAt,
        });
      }
    }
  }

  const importedSessions = new Set(threadOf.keys());
  return {
    actions: [...links.toSorted((a, b) => a.depth - b.depth).map((link) => link.action), ...others],
    result: {
      matched: entryOf.size,
      linked: links.length,
      alreadyLinked,
      parentMissing,
      notImported: manifest.sessions.filter((entry) => !importedSessions.has(entry.sessionId))
        .length,
      cycles: cycles.size,
      coordinatorsSet,
      titlesSet,
      unsettled,
      staySettled,
    },
  };
}
