import { type BoardStatus, ServerSettingsError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath } from "@t3tools/shared/shell";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";

const COMMAND_TIMEOUT = "15 seconds";
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
// Turns and tool listings ask often; a minute keeps them off the CLI without hiding a change for long.
const PROBE_TTL_MS = 60_000;
const MAX_DETAIL_CHARS = 300;

export class BoardNotConnectedError extends Schema.TaggedError<BoardNotConnectedError>()(
  "BoardNotConnectedError",
  {},
) {
  override get message(): string {
    return "rstack-board is not connected. Turn it on in Settings → Threads → Board.";
  }
}

export class BoardNotInstalledError extends Schema.TaggedError<BoardNotInstalledError>()(
  "BoardNotInstalledError",
  { cliPath: Schema.NullOr(Schema.String) },
) {
  override get message(): string {
    return this.cliPath === null
      ? "rstack-board is not installed on this machine."
      : `rstack-board was not found at ${this.cliPath}.`;
  }
}

/**
 * `reason` is the board's own error reason (`not_found`, `task_claimed`, ...) or one of ours.
 * `detail` is the board's message, capped: agents need it to recover, as with `DeviceBootError`.
 */
export class BoardCommandError extends Schema.TaggedError<BoardCommandError>()(
  "BoardCommandError",
  {
    command: Schema.String,
    reason: Schema.String,
    detail: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `rstack-board ${this.command} failed: ${this.reason}${this.detail ? `. ${this.detail}` : ""}`;
  }
}

export type BoardError =
  | BoardNotConnectedError
  | BoardNotInstalledError
  | BoardCommandError
  | ServerSettingsError;

const Labels = Schema.Record(Schema.String, Schema.String);

export const BoardMessage = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  channel: Schema.String,
  author: Schema.String,
  text: Schema.String,
  createdAt: Schema.String,
});
export type BoardMessage = typeof BoardMessage.Type;

export const BoardThreadSummary = Schema.Struct({
  id: Schema.String,
  channel: Schema.String,
  title: Schema.String,
  labels: Labels,
  last: BoardMessage,
  replyCount: Schema.Number,
  updatedAt: Schema.String,
});
export type BoardThreadSummary = typeof BoardThreadSummary.Type;

export const BoardThread = Schema.Struct({
  ...BoardThreadSummary.fields,
  message: BoardMessage,
  replies: Schema.Array(BoardMessage),
});
export type BoardThread = typeof BoardThread.Type;

export const BoardThreadList = Schema.Struct({ threads: Schema.Array(BoardThreadSummary) });
export const BoardLabels = Schema.Struct({ labels: Labels });

const CliStatus = Schema.Struct({
  running: Schema.Boolean,
  url: Schema.NullOr(Schema.String),
  database: Schema.String,
});
const decodeCliFailure = Schema.decodeOption(
  Schema.fromJsonString(
    Schema.Struct({ reason: Schema.String, message: Schema.optional(Schema.String) }),
  ),
);

export interface BoardCommand {
  /** CLI arguments after the global flags, such as `["reply", id, "--file", "-"]`. */
  readonly args: ReadonlyArray<string>;
  /** The handle writes are recorded as; omitted leaves it to the board's own default. */
  readonly as?: string | undefined;
  readonly stdin?: string | undefined;
  /** Passed as `T3CODE_THREAD_ID`, which the board can derive a default handle from. */
  readonly threadId?: string | undefined;
}

export class BoardService extends Context.Service<
  BoardService,
  {
    /** Runs the CLI now and remembers the answer for `isConnected`. Never fails. */
    readonly status: Effect.Effect<BoardStatus>;
    /** Turned on in settings and the CLI answered within the last minute. */
    readonly isConnected: Effect.Effect<boolean>;
    /** Runs one command with `--json` and decodes its output; extra fields are ignored. */
    readonly run: <A>(
      command: BoardCommand,
      success: Schema.Codec<A>,
    ) => Effect.Effect<A, BoardError>;
  }
>()("t3/board/BoardService") {}

const commandLabel = (args: ReadonlyArray<string>) =>
  args[0] === "tasks" && args[1] !== undefined ? `tasks ${args[1]}` : (args[0] ?? "command");

const cap = (text: string) =>
  text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}…` : text;

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const probed = yield* Ref.make<
    { readonly cliSetting: string; readonly at: number; readonly status: BoardStatus } | undefined
  >(undefined);

  const resolveCli = Effect.fn("BoardService.resolveCli")(function* (cliSetting: string) {
    const home = yield* HostProcess.HomeDirectory;
    const env = yield* HostProcess.Environment;
    if (cliSetting !== "") {
      const expanded = cliSetting.startsWith("~/") ? `${home}/${cliSetting.slice(2)}` : cliSetting;
      const found = yield* resolveCommandPath(expanded, { env });
      return found === null ? yield* new BoardNotInstalledError({ cliPath: expanded }) : found;
    }
    const found =
      (yield* resolveCommandPath("rstack-board", { env })) ??
      (yield* resolveCommandPath(`${home}/.local/bin/rstack-board`, { env }));
    return found ?? (yield* new BoardNotInstalledError({ cliPath: null }));
  }, Effect.provide(platform));

  const exec = Effect.fn("BoardService.exec")(function* (cli: string, command: BoardCommand) {
    const label = commandLabel(command.args);
    const env = yield* HostProcess.Environment;
    const output = yield* processRunner
      .run({
        command: cli,
        args: [
          "--json",
          ...(command.as === undefined ? [] : ["--as", command.as]),
          ...command.args,
        ],
        // Always closed, so nothing in the CLI can wait on it.
        stdin: command.stdin ?? "",
        timeout: COMMAND_TIMEOUT,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        env: {
          ...env,
          ...(command.threadId === undefined ? {} : { T3CODE_THREAD_ID: command.threadId }),
        },
      })
      .pipe(
        Effect.catchTags({
          ProcessSpawnError: () => Effect.fail(new BoardNotInstalledError({ cliPath: cli })),
          ProcessTimeoutError: (cause) =>
            Effect.fail(new BoardCommandError({ command: label, reason: "timed_out", cause })),
          ProcessOutputLimitError: (cause) =>
            Effect.fail(
              new BoardCommandError({ command: label, reason: "output_too_large", cause }),
            ),
          ProcessReadError: (cause) =>
            Effect.fail(new BoardCommandError({ command: label, reason: "crashed", cause })),
          ProcessStdinError: (cause) =>
            Effect.fail(new BoardCommandError({ command: label, reason: "crashed", cause })),
        }),
      );
    if (output.code === 0) return output.stdout;
    const failure = decodeCliFailure(output.stderr.trim());
    if (failure._tag === "Some") {
      return yield* new BoardCommandError({
        command: label,
        reason: /^[a-z_]{1,40}$/u.test(failure.value.reason) ? failure.value.reason : "failed",
        ...(failure.value.message === undefined ? {} : { detail: cap(failure.value.message) }),
      });
    }
    // Not a board error: Node itself failed, such as a version without node:sqlite.
    const firstLine = output.stderr.trim().split("\n")[0] ?? "";
    return yield* new BoardCommandError({
      command: label,
      reason: "crashed",
      ...(firstLine === "" ? {} : { detail: cap(firstLine) }),
    });
  });

  const decode = <A>(label: string, stdout: string, success: Schema.Codec<A>) =>
    Schema.decodeEffect(Schema.fromJsonString(success))(stdout).pipe(
      Effect.mapError(
        (cause) => new BoardCommandError({ command: label, reason: "unexpected_output", cause }),
      ),
    );

  const probe = Effect.fn("BoardService.probe")(function* (enabled: boolean, cliSetting: string) {
    const attempt = Effect.gen(function* () {
      const cli = yield* resolveCli(cliSetting);
      const version = (yield* exec(cli, { args: ["--version"] })).trim();
      const status = yield* decode("status", yield* exec(cli, { args: ["status"] }), CliStatus);
      return {
        enabled,
        installed: true,
        cliPath: cli,
        version: version === "" ? null : version,
        databasePath: status.database,
        webUrl: status.running ? status.url : null,
        error: null,
      } satisfies BoardStatus;
    });
    return yield* attempt.pipe(
      Effect.catch((error) =>
        Effect.succeed({
          enabled,
          installed: error._tag !== "BoardNotInstalledError",
          cliPath: error._tag === "BoardNotInstalledError" ? error.cliPath : null,
          version: null,
          databasePath: null,
          webUrl: null,
          error: error.message,
        } satisfies BoardStatus),
      ),
    );
  });

  const refresh = Effect.fn("BoardService.refresh")(function* (
    enabled: boolean,
    cliSetting: string,
  ) {
    const status = yield* probe(enabled, cliSetting);
    const at = yield* Clock.currentTimeMillis;
    yield* Ref.set(probed, { cliSetting, at, status });
    return status;
  });

  const status = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    return yield* refresh(settings.boardEnabled, settings.boardCliPath);
  }).pipe(
    Effect.catchTags({
      ServerSettingsError: (error) =>
        Effect.succeed({
          enabled: false,
          installed: false,
          cliPath: null,
          version: null,
          databasePath: null,
          webUrl: null,
          error: error.message,
        } satisfies BoardStatus),
    }),
    Effect.withSpan("BoardService.status"),
  );

  const isConnected = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    if (!settings.boardEnabled) return false;
    const now = yield* Clock.currentTimeMillis;
    const last = yield* Ref.get(probed);
    const current =
      last !== undefined &&
      last.cliSetting === settings.boardCliPath &&
      now - last.at < PROBE_TTL_MS
        ? last.status
        : yield* refresh(true, settings.boardCliPath);
    return current.error === null;
  }).pipe(
    Effect.orElseSucceed(() => false),
    Effect.withSpan("BoardService.isConnected"),
  );

  const run = Effect.fn("BoardService.run")(function* <A>(
    command: BoardCommand,
    success: Schema.Codec<A>,
  ) {
    const settings = yield* settingsService.getSettings;
    if (!settings.boardEnabled) return yield* new BoardNotConnectedError();
    const cli = yield* resolveCli(settings.boardCliPath);
    const stdout = yield* exec(cli, command);
    return yield* decode(commandLabel(command.args), stdout, success);
  });

  return BoardService.of({
    status,
    isConnected,
    run,
  });
});

export const layer = Layer.effect(BoardService, make);
