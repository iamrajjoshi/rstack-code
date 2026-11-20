import {
  AuthStandardClientScopes,
  ClaudeSessionTreeManifest,
  type ClaudeSessionTreeManifest as ClaudeSessionTreeManifestType,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { expandHomePath } from "../os-jank.ts";
import { buildClaudeSessionTreeManifest } from "../project/ClaudeSessionTree.ts";
import { readLiveServerRuntimeState } from "../serverRuntimeState.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import { findActiveProjectTarget } from "./project.ts";
import * as RunningServer from "./runningServer.ts";

const DESKTOP_SESSIONS_DIR = "~/Library/Application Support/Claude/claude-code-sessions";

export class ClaudeSessionsServerNotRunningError extends Schema.TaggedError<ClaudeSessionsServerNotRunningError>()(
  "ClaudeSessionsServerNotRunningError",
  { baseDir: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return `No running server uses ${this.baseDir}. Start it, then retry.`;
  }
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(ClaudeSessionTreeManifest));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Session files sit two folders down, named `local_<id>.json`. */
const readDesktopSessionFiles = Effect.fn("claudeSessions.readDesktopSessionFiles")(function* (
  directory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fileSystem.readDirectory(directory, { recursive: true });
  const sessionFiles = entries.filter((entry) =>
    /^local_[^/\\]+\.json$/.test(path.basename(entry)),
  );
  return yield* Effect.forEach(sessionFiles, (entry) =>
    fileSystem
      .readFileString(path.join(directory, entry))
      .pipe(Effect.map((text) => Option.getOrUndefined(decodeJson(text)))),
  );
});

/** Counts only: the manifest itself carries titles and paths, never message content. */
function summarizeManifest(manifest: ClaudeSessionTreeManifestType) {
  const byId = new Map(manifest.sessions.map((entry) => [entry.sessionId, entry] as const));
  const depth = (sessionId: string, seen = new Set<string>()): number => {
    const parentId = byId.get(sessionId)?.parentSessionId ?? null;
    if (parentId === null || seen.has(parentId) || !byId.has(parentId)) return 0;
    seen.add(sessionId);
    return depth(parentId, seen) + 1;
  };
  return {
    sessions: manifest.sessions.length,
    withParent: manifest.sessions.filter((entry) => entry.parentSessionId !== null).length,
    coordinators: manifest.sessions.filter((entry) => entry.coordinator).length,
    archived: manifest.sessions.filter((entry) => entry.archived).length,
    maxDepth: Math.max(0, ...manifest.sessions.map((entry) => depth(entry.sessionId))),
  };
}

const exportCommand = Command.make("export", {
  source: Flag.String("source").pipe(
    Flag.withDescription("Claude desktop app session folder."),
    Flag.withDefault(DESKTOP_SESSIONS_DIR),
  ),
  output: Flag.String("output").pipe(Flag.withDescription("Manifest file to write.")),
}).pipe(
  Command.withDescription(
    "Write the Claude desktop app's session tree (ids, titles, parents; no messages) to a file.",
  ),
  Command.withHandler(
    Effect.fn("claudeSessions.export")(function* ({ source, output }) {
      const fileSystem = yield* FileSystem.FileSystem;
      const files = yield* readDesktopSessionFiles(yield* expandHomePath(source));
      const manifest = buildClaudeSessionTreeManifest(files);
      yield* fileSystem.writeFileString(yield* expandHomePath(output), encodeJson(manifest));
      yield* Console.log(encodeJson(summarizeManifest(manifest)));
    }),
  ),
);

/** Calls the running server; these changes go through its command path, so it must be up. */
const withServerClient = Effect.fn("claudeSessions.withServerClient")(function* <A, E, R>(
  flags: CliAuthLocationFlags,
  run: (client: RunningServer.ServerClient) => Effect.Effect<A, E, R>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  return yield* Effect.gen(function* () {
    const { baseDir, serverRuntimeStatePath } = yield* ServerConfig.ServerConfig;
    const running = yield* readLiveServerRuntimeState(serverRuntimeStatePath);
    if (Option.isNone(running)) {
      const error = new ClaudeSessionsServerNotRunningError({ baseDir });
      yield* Console.error(error.message);
      return yield* error;
    }
    return yield* RunningServer.serverClient(running.value.origin, AuthStandardClientScopes).pipe(
      Effect.flatMap(run),
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(EnvironmentAuth.layerRuntime, WorkspacePaths.layer).pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provideMerge(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      ),
    ),
  );
});

const applyCommand = Command.make("apply", {
  ...projectLocationFlags,
  manifest: Argument.String("manifest").pipe(
    Argument.withDescription("Manifest written by `claude-sessions export`."),
  ),
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription("Print what would change without changing anything."),
    Flag.withDefault(false),
  ),
  unsettleUnlisted: Flag.Boolean("unsettle-unlisted").pipe(
    Flag.withDescription("Also unsettle imported Claude threads that the manifest does not list."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Nest imported Claude threads under the sessions that spawned them, and restore titles, coordinators and settled state.",
  ),
  Command.withHandler(
    Effect.fn("claudeSessions.apply")(function* (flags) {
      const fileSystem = yield* FileSystem.FileSystem;
      const manifest = yield* fileSystem
        .readFileString(yield* expandHomePath(flags.manifest))
        .pipe(Effect.flatMap(decodeManifest));
      const result = yield* withServerClient(flags, (client) =>
        client.projects.applyClaudeSessionTree({
          headers: {},
          payload: {
            manifest,
            dryRun: flags.dryRun,
            unsettleUnlisted: flags.unsettleUnlisted,
          },
        }),
      );
      yield* Console.log(encodeJson({ dryRun: flags.dryRun, ...result }));
    }),
  ),
);

const importCommand = Command.make("import", {
  ...projectLocationFlags,
  project: Argument.String("project").pipe(
    Argument.withDescription(
      "Project id or workspace root to import Claude, Codex and Pi history for.",
    ),
  ),
  allHistory: Flag.Boolean("all-history").pipe(
    Flag.withDescription("Import every conversation, not only the last 30 days or 100 per run."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Import agent conversations into a project, as the Welcome page does."),
  Command.withHandler(
    Effect.fn("claudeSessions.import")(function* (flags) {
      const result = yield* withServerClient(flags, (client) =>
        Effect.gen(function* () {
          const project = yield* findActiveProjectTarget({
            snapshot: yield* client.projects.snapshot({ headers: {} }),
            identifier: flags.project,
          });
          return yield* client.projects.importAgentSessions({
            headers: {},
            payload: {
              projectId: project.id,
              expectedWorkspaceRoot: project.workspaceRoot,
              allHistory: flags.allHistory,
            },
          });
        }),
      );
      yield* Console.log(encodeJson(result));
    }),
  ),
);

export const claudeSessionsCommand = Command.make("claude-sessions").pipe(
  Command.withDescription("Bring Claude desktop app sessions over, with their session tree."),
  Command.withSubcommands([exportCommand, importCommand, applyCommand]),
);
