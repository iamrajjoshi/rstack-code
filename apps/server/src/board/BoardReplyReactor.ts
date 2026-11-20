import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

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

/**
 * What a board event says to the rstack-code thread its board thread is labelled with. Only the
 * person's own writes pass: agents' board text is data, and forwarding it would let one agent
 * write into another's conversation. `labels` are the board thread's labels after the event.
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
    threadId === undefined ||
    threadId === "" ||
    context.labels.env !== context.environmentId
  ) {
    return null;
  }
  if (event.type === "message.posted") {
    if (event.message.author !== context.person || event.message.id === event.threadId) return null;
    return {
      key: `reply:${event.message.id}`,
      threadId,
      text: `[rstack-board] ${context.person} replied on board thread ${event.threadId}:\n${event.message.text}`,
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
      if (event.actor !== person) return;
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

  const follow = Stream.unwrap(
    Effect.gen(function* () {
      const person = yield* board.person;
      if (person === null) {
        return yield* new BoardService.BoardCommandError({
          command: "status",
          reason: "no_person",
        });
      }
      // The board filters on the thread's current labels; `handle` checks them again.
      return board
        .tail(["--by", person, "--label", "t3", "--label", `env=${environmentId}`])
        .pipe(Stream.mapEffect((event) => handle(event, person)));
    }),
  ).pipe(
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
