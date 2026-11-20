import { type BoardStatus, ServerSettingsError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { resolveCommandPath, resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

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

/** A failure that retrying the same command cannot fix: the CLI does not take these arguments. */
export const isPermanentBoardError = (error: BoardError) =>
  error._tag === "BoardCommandError" && error.reason === "usage";

export type BoardError =
  | BoardNotConnectedError
  | BoardNotInstalledError
  | BoardCommandError
  | ServerSettingsError;

const Labels = Schema.Record(Schema.String, Schema.String);

/** `web` for the person's writes on the board's own page, `cli` for every CLI write. Older CLIs omit it. */
const Via = Schema.optional(Schema.Literals(["web", "cli"]));

export const BoardMessage = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  channel: Schema.String,
  author: Schema.String,
  text: Schema.String,
  createdAt: Schema.String,
  via: Via,
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

const BoardEventFields = {
  cursor: Schema.Number,
  threadId: Schema.String,
  channel: Schema.String,
  /** Who made the change: an agent's handle, or the person's for writes from the board's page. */
  actor: Schema.String,
  at: Schema.String,
  via: Via,
};
export const BoardEvent = Schema.Union([
  Schema.Struct({
    ...BoardEventFields,
    type: Schema.Literal("message.posted"),
    message: BoardMessage,
  }),
  Schema.Struct({
    ...BoardEventFields,
    type: Schema.Literal("labels.changed"),
    set: Labels,
    unset: Schema.Array(Schema.String),
    labels: Labels,
  }),
]);
export type BoardEvent = typeof BoardEvent.Type;
// The board only adds event types; a line this server does not know is skipped.
const decodeBoardEvent = Schema.decodeOption(Schema.fromJsonString(BoardEvent));

const CliStatus = Schema.Struct({
  running: Schema.Boolean,
  url: Schema.NullOr(Schema.String),
  database: Schema.String,
  version: Schema.optional(Schema.String),
  person: Schema.optional(Schema.String),
  /** Bridge features such as `via` and `tail-after`; older CLIs omit the field. */
  features: Schema.optional(Schema.Array(Schema.String)),
});
const decodeCliFailure = Schema.decodeOption(
  Schema.fromJsonString(
    Schema.Struct({ reason: Schema.String, message: Schema.optional(Schema.String) }),
  ),
);

/** What the connected CLI can do, from its last `status`. Empty while the board is not usable. */
export interface BoardCapabilities {
  /** The handle the board records writes from its page under. */
  readonly person: string | null;
  readonly features: ReadonlyArray<string>;
  /** The board's database, which its event cursors belong to. */
  readonly database: string | null;
}

const noCapabilities: BoardCapabilities = { person: null, features: [], database: null };

/** Reply delivery needs to tell the person's writes on the board's page apart from CLI writes. */
export const canDeliverReplies = (capabilities: BoardCapabilities) =>
  capabilities.person !== null && capabilities.features.includes("via");

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
    /** The connected CLI's capabilities, probed at most once a minute. Never fails. */
    readonly capabilities: Effect.Effect<BoardCapabilities>;
    /**
     * The capabilities now, probing when the last answer is stale, then again whenever a later
     * probe (Settings, a turn, a tool listing) finds them changed, such as after a CLI update.
     */
    readonly capabilityChanges: Stream.Stream<BoardCapabilities>;
    /** `tail --json` with these arguments, until the scope closes. */
    readonly tail: (args: ReadonlyArray<string>) => Stream.Stream<BoardEvent, BoardError>;
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
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const probed = yield* SubscriptionRef.make<
    | {
        readonly cliSetting: string;
        readonly at: number;
        readonly status: BoardStatus;
        readonly capabilities: BoardCapabilities;
      }
    | undefined
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
    // Not a board error: Node itself failed, such as a version without node:sqlite or a missing
    // module, whose stack trace starts with a source location; the error line says why.
    const lines = output.stderr.trim().split("\n");
    const why = lines.find((line) => /^[A-Za-z]*Error\b/u.test(line)) ?? lines[0] ?? "";
    return yield* new BoardCommandError({
      command: label,
      reason: "crashed",
      ...(why === "" ? {} : { detail: cap(why) }),
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
      const status = yield* decode("status", yield* exec(cli, { args: ["status"] }), CliStatus);
      return {
        status: {
          enabled,
          installed: true,
          cliPath: cli,
          version: status.version?.trim() || null,
          databasePath: status.database,
          webUrl: status.running ? status.url : null,
          error: null,
        } satisfies BoardStatus,
        capabilities: {
          person: status.person?.trim() || null,
          features: status.features ?? [],
          database: status.database,
        } satisfies BoardCapabilities,
      };
    });
    return yield* attempt.pipe(
      Effect.catch((error) =>
        Effect.succeed({
          status: {
            enabled,
            installed: error._tag !== "BoardNotInstalledError",
            cliPath: error._tag === "BoardNotInstalledError" ? error.cliPath : null,
            version: null,
            databasePath: null,
            webUrl: null,
            error: error.message,
          } satisfies BoardStatus,
          capabilities: noCapabilities,
        }),
      ),
    );
  });

  const refresh = Effect.fn("BoardService.refresh")(function* (
    enabled: boolean,
    cliSetting: string,
  ) {
    const result = yield* probe(enabled, cliSetting);
    const at = yield* Clock.currentTimeMillis;
    yield* SubscriptionRef.set(probed, { cliSetting, at, ...result });
    return result;
  });

  /** The last probe while it is fresh and for the current CLI setting, else a new one. */
  const current = Effect.fn("BoardService.current")(function* (cliSetting: string) {
    const now = yield* Clock.currentTimeMillis;
    const last = yield* SubscriptionRef.get(probed);
    return last !== undefined && last.cliSetting === cliSetting && now - last.at < PROBE_TTL_MS
      ? last
      : yield* refresh(true, cliSetting);
  });

  const status = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    const result = yield* refresh(settings.boardEnabled, settings.boardCliPath);
    return {
      ...result.status,
      replies: !settings.boardDeliverReplies
        ? "off"
        : canDeliverReplies(result.capabilities)
          ? "on"
          : "update_needed",
      autoStatus: settings.boardAutoStatus,
    } satisfies BoardStatus;
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
    return (yield* current(settings.boardCliPath)).status.error === null;
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

  const capabilities = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    if (!settings.boardEnabled) return noCapabilities;
    return (yield* current(settings.boardCliPath)).capabilities;
  }).pipe(
    Effect.orElseSucceed(() => noCapabilities),
    Effect.withSpan("BoardService.capabilities"),
  );

  const capabilityKey = (value: BoardCapabilities) =>
    JSON.stringify([value.person, value.features, value.database]);
  const capabilityChanges = Stream.unwrap(
    capabilities.pipe(
      Effect.as(
        SubscriptionRef.changes(probed).pipe(
          Stream.map((last) =>
            last === undefined || !last.status.enabled ? noCapabilities : last.capabilities,
          ),
        ),
      ),
    ),
  ).pipe(Stream.changesWith((left, right) => capabilityKey(left) === capabilityKey(right)));

  const tail = (args: ReadonlyArray<string>) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const settings = yield* settingsService.getSettings;
        if (!settings.boardEnabled) return yield* new BoardNotConnectedError();
        const cli = yield* resolveCli(settings.boardCliPath);
        const env = yield* HostProcess.Environment;
        const command = yield* resolveSpawnCommand(cli, ["--json", "tail", ...args], {
          env,
          extendEnv: true,
        });
        const child = yield* spawner
          .spawn(
            ChildProcess.make(command.command, command.args, {
              env,
              extendEnv: true,
              shell: command.shell,
              stdin: "ignore",
              stderr: "pipe",
              forceKillAfter: "1 second",
            }),
          )
          .pipe(
            Effect.mapError(() => new BoardNotInstalledError({ cliPath: cli })),
            Effect.catchDefect(() => Effect.fail(new BoardNotInstalledError({ cliPath: cli }))),
          );
        // The stream ends only when the CLI exits, which a healthy `tail` never does.
        return child.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.flatMap((line) => {
            const event = decodeBoardEvent(line);
            return event._tag === "Some" ? Stream.succeed(event.value) : Stream.empty;
          }),
          Stream.mapError(
            (cause) => new BoardCommandError({ command: "tail", reason: "crashed", cause }),
          ),
          // On exit the board writes its reason to stderr, such as `usage` for an unknown option.
          Stream.concat(
            Stream.unwrap(
              child.stderr.pipe(
                Stream.decodeText(),
                Stream.mkString,
                Effect.orElseSucceed(() => ""),
                Effect.map((stderr) => {
                  const failure = decodeCliFailure(stderr.trim());
                  return Stream.fail(
                    failure._tag === "Some" && /^[a-z_]{1,40}$/u.test(failure.value.reason)
                      ? new BoardCommandError({
                          command: "tail",
                          reason: failure.value.reason,
                          ...(failure.value.message === undefined
                            ? {}
                            : { detail: cap(failure.value.message) }),
                        })
                      : new BoardCommandError({ command: "tail", reason: "exited" }),
                  );
                }),
              ),
            ),
          ),
        );
      }),
    ).pipe(Stream.withSpan("BoardService.tail"));

  return BoardService.of({
    status,
    isConnected,
    capabilities,
    capabilityChanges,
    tail,
    run,
  });
});

export const layer = Layer.effect(BoardService, make);
