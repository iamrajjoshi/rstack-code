import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as BoardService from "./BoardService.ts";

const backoff = Schedule.exponential("2 seconds").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.minutes(5))),
  ),
);

export interface BoardDelivery {
  /** Stable per board event, so a replayed event is a receipt replay, never a second message. */
  readonly key: string;
  readonly threadId: string;
  readonly text: string;
}

/** The last board event this environment handled, in the board database it came from. */
const SavedCursor = Schema.Struct({ database: Schema.String, cursor: Schema.Number });
const decodeSavedCursor = Schema.decodeEffect(Schema.fromJsonString(SavedCursor));

/**
 * What a board event says to the rstack-code thread its board thread is labelled with. Only what
 * the person wrote on the board's own page passes (`via: "web"`): agents' board text is data, and
 * forwarding it, even posted with `--as <person>`, would let one agent write into another's
 * conversation. `labels` are the board thread's labels after the event.
 */
export const boardDelivery = (
  event: BoardService.BoardEvent,
  context: {
    readonly person: string;
    readonly environmentId: string;
    readonly labels: Readonly<Record<string, string>>;
  },
): BoardDelivery | null => {
  const threadId = context.labels.t3;
  if (
    event.actor !== context.person ||
    event.via !== "web" ||
    threadId === undefined ||
    threadId === "" ||
    context.labels.env !== context.environmentId
  ) {
    return null;
  }
  if (event.type === "message.posted") {
    if (
      event.message.author !== context.person ||
      event.message.via !== "web" ||
      event.message.id === event.threadId
    ) {
      return null;
    }
    return {
      key: `reply:${event.message.id}`,
      threadId,
      // The closing line sends the agent's answer back to the board, where the person wrote.
      text: `[rstack-board] ${context.person} replied on board thread ${event.threadId}:\n${event.message.text}\n[rstack-board] Answer with board_reply on board thread ${event.threadId}, then continue.`,
    };
  }
  const changes = [
    ...(event.set.decision === undefined ? [] : [`decision=${event.set.decision}`]),
    ...(event.set.hold === undefined ? [] : [`hold=${event.set.hold}`]),
    ...(event.unset.includes("hold") ? ["hold cleared"] : []),
    ...(event.unset.includes("needs") ? ["needs cleared"] : []),
  ];
  if (changes.length === 0) return null;
  return {
    key: `labels:${event.threadId}:${event.cursor}`,
    threadId,
    text: `[rstack-board] ${context.person} on board thread ${event.threadId}: ${changes.join(", ")}.`,
  };
};

/** Follows the board while it is connected and hands the person's answers to their threads. */
export class BoardReplyReactor extends Context.Service<
  BoardReplyReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/board/BoardReplyReactor") {}

const make = Effect.gen(function* () {
  const board = yield* BoardService.BoardService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const environmentId = yield* (yield* ServerEnvironment.ServerEnvironmentIdentity)
    .getEnvironmentId;
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const cursorPath = (yield* Path.Path).join((yield* ServerConfig).stateDir, "board-cursor.json");

  const readCursor = (database: string) =>
    fs.readFileString(cursorPath).pipe(
      Effect.flatMap(decodeSavedCursor),
      Effect.map((saved) => (saved.database === database ? saved.cursor : null)),
      Effect.orElseSucceed(() => null),
    );

  const saveCursor = (database: string, cursor: number) =>
    writeFileStringAtomically({
      filePath: cursorPath,
      contents: JSON.stringify({ database, cursor }),
    }).pipe(
      Effect.provide(platform),
      Effect.catchCause((cause) =>
        Effect.logWarning("saving the board cursor failed", { cursor, cause }),
      ),
    );

  const deliver = Effect.fn("BoardReplyReactor.deliver")(function* (delivery: BoardDelivery) {
    const commandId = CommandId.make(`server:board-delivery:${delivery.key}`);
    if (yield* threads.hasReceipt(commandId)) return;
    const threadId = ThreadId.make(delivery.threadId);
    const thread = yield* threads.getThreadShell(threadId);
    if (thread === null || thread.deletedAt !== null || thread.archivedAt !== null) {
      return yield* Effect.logInfo("a board reply names a thread that is gone", {
        threadId,
      });
    }
    yield* threads.sendToThread({
      projectId: thread.projectId,
      commandId,
      threadId,
      messageId: MessageId.make(`message:board-delivery:${delivery.key}`),
      text: delivery.text,
      attachments: [],
      mode: "queue",
      createdBy: "user",
      creationSource: "server",
    });
  });

  const handle = Effect.fn("BoardReplyReactor.handle")(
    function* (event: BoardService.BoardEvent, person: string) {
      if (event.actor !== person || event.via !== "web") return;
      // A posted message carries no labels, so read the thread's; a label change carries them.
      const labels =
        event.type === "labels.changed"
          ? event.labels
          : (yield* board.run(
              { args: ["read", "--", event.threadId] },
              BoardService.BoardThreadSummary,
            )).labels;
      const delivery = boardDelivery(event, { person, environmentId, labels });
      if (delivery !== null) yield* deliver(delivery);
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("delivering a board event failed", {
            boardThreadId: event.threadId,
            cursor: event.cursor,
            cause,
          }),
        ),
      ),
  );

  /**
   * Tails the person's page writes. With `tail-after`, it starts after the last event handled,
   * so replies written while the server was down arrive now; receipts keep each to one message.
   */
  const followFrom = (person: string, database: string, resumable: boolean) =>
    Stream.unwrap(
      Effect.gen(function* () {
        let after = resumable ? yield* readCursor(database) : null;
        if (resumable && after === null) {
          // Nothing handled yet in this board: start from its newest event, and remember it.
          after = (yield* board.run(
            { args: ["read", "-n", "1"] },
            Schema.Struct({ cursor: Schema.Number }),
          )).cursor;
          yield* saveCursor(database, after);
        }
        // The board filters on the thread's current labels; `handle` checks them again.
        return board
          .tail([
            ...(after === null ? [] : ["--after", String(after)]),
            "--by",
            person,
            "--via",
            "web",
            "--label",
            "t3",
            "--label",
            `env=${environmentId}`,
          ])
          .pipe(
            Stream.mapEffect((event) =>
              handle(event, person).pipe(
                Effect.andThen(resumable ? saveCursor(database, event.cursor) : Effect.void),
              ),
            ),
          );
      }),
    );

  // Restarts whenever a probe finds the CLI changed, such as after it is updated.
  const follow = board.capabilityChanges.pipe(
    Stream.switchMap((capabilities) => {
      if (capabilities.database === null) {
        // The board did not answer; transient, so retry like a failed tail.
        return Stream.fail(
          new BoardService.BoardCommandError({ command: "status", reason: "unavailable" }),
        );
      }
      if (capabilities.person === null || !BoardService.canDeliverReplies(capabilities)) {
        return Stream.fromEffectDrain(
          Effect.logWarning(
            "board replies are not delivered: update rstack-board, which cannot yet tell the person's page writes apart",
          ),
        );
      }
      return followFrom(
        capabilities.person,
        capabilities.database,
        capabilities.features.includes("tail-after"),
      ).pipe(
        Stream.catchIf(BoardService.isPermanentBoardError, (error) =>
          Stream.fromEffectDrain(
            Effect.logWarning("board replies stopped: the board CLI refused the request", {
              error,
            }),
          ),
        ),
      );
    }),
    Stream.tapCause((cause) => Effect.logInfo("following the board stopped; retrying", { cause })),
    Stream.retry(backoff),
  );

  const start: BoardReplyReactor["Service"]["start"] = Effect.fn("BoardReplyReactor.start")(
    function* () {
      const changes = yield* settingsService.subscribeChanges;
      const current = yield* settingsService.getSettings.pipe(Effect.option);
      yield* forkParked(
        Stream.concat(
          current._tag === "Some" ? Stream.succeed(current.value) : Stream.empty,
          changes,
        ).pipe(
          // Reconnects when the CLI changes, as the board may then be another one.
          Stream.map((settings) =>
            settings.boardEnabled && settings.boardDeliverReplies ? settings.boardCliPath : null,
          ),
          Stream.changes,
          Stream.switchMap((cliPath) => (cliPath === null ? Stream.empty : follow)),
          Stream.runDrain,
        ),
      );
    },
  );

  return BoardReplyReactor.of({ start });
});

export const layer = Layer.effect(BoardReplyReactor, make);
