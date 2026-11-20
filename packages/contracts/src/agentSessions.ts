import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const AgentSessionSource = Schema.Literals(["claudeAgent", "codex", "pi"]);
export type AgentSessionSource = typeof AgentSessionSource.Type;

export const AgentSessionImportSource = Schema.Struct({
  provider: AgentSessionSource,
  providerInstanceId: ProviderInstanceId,
  providerSessionId: TrimmedNonEmptyString,
  filePath: TrimmedNonEmptyString,
  size: NonNegativeInt,
  mtimeMs: Schema.NullOr(Schema.Number),
  device: Schema.Number,
  // A decimal string keeps file IDs above 2^53 (common on NTFS) exact. Older
  // records stored a number.
  inode: Schema.NullOr(Schema.Union([Schema.String, Schema.Number])),
  birthtimeMs: Schema.NullOr(Schema.Number),
});
export type AgentSessionImportSource = typeof AgentSessionImportSource.Type;

export const AgentSessionScanInput = Schema.Struct({});
export type AgentSessionScanInput = typeof AgentSessionScanInput.Type;

export const AgentSessionProjectGit = Schema.Struct({
  remoteKey: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
});
export type AgentSessionProjectGit = typeof AgentSessionProjectGit.Type;

export const AgentSessionProjectCandidate = Schema.Struct({
  path: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  projectId: Schema.optional(ProjectId),
  sources: Schema.Array(AgentSessionSource),
  threadCount: NonNegativeInt,
  lastActiveAt: Schema.NullOr(IsoDateTime),
  alreadyImported: Schema.Boolean,
  git: Schema.optionalKey(Schema.NullOr(AgentSessionProjectGit)),
});
export type AgentSessionProjectCandidate = typeof AgentSessionProjectCandidate.Type;

export const AgentSessionScanResult = Schema.Struct({
  candidates: Schema.Array(AgentSessionProjectCandidate),
  scannedAt: IsoDateTime,
  truncated: Schema.optional(Schema.Boolean),
});
export type AgentSessionScanResult = typeof AgentSessionScanResult.Type;

export const AgentSessionImportInput = Schema.Struct({
  projectId: ProjectId,
  expectedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
  /** Lifts the 30-day window and the per-attempt caps, for a one-off bulk import from the CLI. */
  allHistory: Schema.optional(Schema.Boolean),
});
export type AgentSessionImportInput = typeof AgentSessionImportInput.Type;

export class AgentSessionImportProjectNotFoundError extends Schema.TaggedError<AgentSessionImportProjectNotFoundError>()(
  "AgentSessionImportProjectNotFoundError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project '${this.projectId}' does not exist.`;
  }
}

export class AgentSessionImportProjectChangedError extends Schema.TaggedError<AgentSessionImportProjectChangedError>()(
  "AgentSessionImportProjectChangedError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project '${this.projectId}' changed directories. Scan for projects again before importing history.`;
  }
}

export const AgentSessionImportResult = Schema.Struct({
  importedCount: NonNegativeInt,
  skippedCount: NonNegativeInt,
});
export type AgentSessionImportResult = typeof AgentSessionImportResult.Type;

/** One Claude desktop app session, written by `t3 claude-sessions export`. Carries no message content. */
export const ClaudeSessionTreeEntry = Schema.Struct({
  /** The Claude Code session id, which names the transcript file. */
  sessionId: TrimmedNonEmptyString,
  /** Other Claude Code session ids the same desktop session used. */
  otherSessionIds: Schema.Array(TrimmedNonEmptyString),
  title: Schema.String,
  /** The spawning session's Claude Code session id. */
  parentSessionId: Schema.NullOr(TrimmedNonEmptyString),
  relationship: Schema.NullOr(Schema.Literals(["worker", "fork", "side-question"])),
  /** Spawned at least one worker. */
  coordinator: Schema.Boolean,
  cwd: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  lastActiveAt: IsoDateTime,
  archived: Schema.Boolean,
});
export type ClaudeSessionTreeEntry = typeof ClaudeSessionTreeEntry.Type;

export const ClaudeSessionTreeManifest = Schema.Struct({
  version: Schema.Literal(1),
  sessions: Schema.Array(ClaudeSessionTreeEntry),
});
export type ClaudeSessionTreeManifest = typeof ClaudeSessionTreeManifest.Type;

export const ClaudeSessionTreeApplyInput = Schema.Struct({
  manifest: ClaudeSessionTreeManifest,
  dryRun: Schema.Boolean,
  /** Also unsettle imported Claude threads with no manifest entry; absent leaves them alone. */
  unsettleUnlisted: Schema.optional(Schema.Boolean),
});
export type ClaudeSessionTreeApplyInput = typeof ClaudeSessionTreeApplyInput.Type;

export const ClaudeSessionTreeApplyResult = Schema.Struct({
  /** Imported threads whose Claude session is in the manifest. */
  matched: NonNegativeInt,
  linked: NonNegativeInt,
  alreadyLinked: NonNegativeInt,
  /** Children left top-level because their parent session was not imported. */
  parentMissing: NonNegativeInt,
  /** Manifest sessions with no imported thread yet. */
  notImported: NonNegativeInt,
  /** Sessions skipped because their manifest parents form a cycle. */
  cycles: NonNegativeInt,
  coordinatorsSet: NonNegativeInt,
  titlesSet: NonNegativeInt,
  /** Settled threads whose desktop session was not archived. */
  unsettled: NonNegativeInt,
  /** Settled threads left settled: archived in the desktop app, or unlisted without the flag. */
  staySettled: NonNegativeInt,
});
export type ClaudeSessionTreeApplyResult = typeof ClaudeSessionTreeApplyResult.Type;

export class AgentSessionScanError extends Schema.TaggedError<AgentSessionScanError>()(
  "AgentSessionScanError",
  {
    operation: Schema.Literals(["read-settings", "read-projects"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to scan agent sessions during ${this.operation}.`;
  }
}
