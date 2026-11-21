import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import * as BoardService from "./BoardService.ts";

/** A check-in writes its message and labels together; one read covers the whole burst. */
export const NEEDS_YOU_DEBOUNCE = Duration.millis(300);

const NEEDS_LABEL = "needs";

const backoff = Schedule.exponential("2 seconds").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.minutes(5))),
  ),
);

const Channels = Schema.Struct({
  channels: Schema.Array(Schema.Struct({ needs: Schema.Number })),
});
const Cursor = Schema.Struct({ cursor: Schema.Number });

/**
 * Only a new thread or setting or clearing `needs` changes which threads wait on the person. A
 * new thread's own labels arrive with its post, without a `labels.changed`.
 */
const changesNeedsYou = (event: BoardService.BoardEvent) =>
  event.type === "message.posted"
    ? event.message.id === event.threadId
    : NEEDS_LABEL in event.set || event.unset.includes(NEEDS_LABEL);

/** How many board threads wait on the person, live from the board's event stream. */
export class BoardNeedsYou extends Context.Service<
  BoardNeedsYou,
  {
    /** The latest count first, then each change; `null` while the board is not connected. */
    readonly changes: Stream.Stream<number | null>;
  }
>()("t3/board/BoardNeedsYou") {}

const make = Effect.gen(function* () {
  const board = yield* BoardService.BoardService;
  const settingsService = yield* ServerSettings.ServerSettingsService;

  // The board page's own "needs you": threads carrying a `needs` label, summed over channels.
  const read = board
    .run({ args: ["channels"] }, Channels)
    .pipe(Effect.map(({ channels }) => channels.reduce((sum, channel) => sum + channel.needs, 0)));

  const countFrom = (resumable: boolean) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Tails from the newest event, so a change made while the tail starts is not missed.
        const after = resumable
          ? (yield* board.run({ args: ["read", "-n", "1"] }, Cursor)).cursor
          : null;
        return Stream.concat(
          Stream.succeed("initial" as const),
          board
            .tail(after === null ? [] : ["--after", String(after)])
            .pipe(Stream.filter(changesNeedsYou)),
        ).pipe(
          Stream.debounce(NEEDS_YOU_DEBOUNCE),
          Stream.mapEffect(() => read),
        );
      }),
    );

  // Restarts whenever a probe finds the CLI changed, as reply delivery does.
  const follow = board.capabilityChanges.pipe(
    Stream.switchMap((capabilities) =>
      capabilities.database === null
        ? Stream.fail(
            new BoardService.BoardCommandError({ command: "status", reason: "unavailable" }),
          )
        : countFrom(capabilities.features.includes("tail-after")),
    ),
    // No badge while the board cannot be reached, then follow it again after a pause.
    Stream.catch((error) => Stream.concat(Stream.succeed(null), Stream.fail(error))),
    Stream.tapCause((cause) =>
      Effect.logInfo("counting board threads that need you stopped; retrying", { cause }),
    ),
    Stream.retry(backoff),
    Stream.orDie,
  );

  const source = Stream.unwrap(
    Effect.gen(function* () {
      const changes = yield* settingsService.subscribeChanges;
      const current = yield* settingsService.getSettings.pipe(Effect.option);
      return Stream.concat(
        current._tag === "Some" ? Stream.succeed(current.value) : Stream.empty,
        changes,
      );
    }),
  ).pipe(
    Stream.map((settings) => (settings.boardEnabled ? settings.boardCliPath : null)),
    Stream.changes,
    Stream.switchMap((cliPath) => (cliPath === null ? Stream.succeed(null) : follow)),
    Stream.changes,
  );

  // One tail for every client, running only while one is watching.
  const changes = yield* Stream.share(source, { capacity: 1, strategy: "sliding", replay: 1 });
  return BoardNeedsYou.of({ changes });
});

export const layer = Layer.effect(BoardNeedsYou, make);
