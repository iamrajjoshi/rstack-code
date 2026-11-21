import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSettings from "../serverSettings.ts";
import * as BoardNeedsYou from "./BoardNeedsYou.ts";
import * as BoardService from "./BoardService.ts";

const connected: BoardService.BoardCapabilities = {
  person: "raj",
  features: ["via", "tail-after"],
  database: "/b/board.db",
};

const labelsChanged = (
  threadId: string,
  cursor: number,
  set: Record<string, string>,
  unset: ReadonlyArray<string> = [],
): BoardService.BoardEvent => ({
  type: "labels.changed",
  cursor,
  threadId,
  channel: "ship/workers",
  actor: "ship-worker-1x2y3z",
  at: "t",
  via: "cli",
  set,
  unset,
  labels: set,
});

/** A reply, or with `root` the post that starts the thread, which carries its labels. */
const posted = (threadId: string, cursor: number, root = false): BoardService.BoardEvent => ({
  type: "message.posted",
  cursor,
  threadId,
  channel: "ship/workers",
  actor: "raj",
  at: "t",
  via: "web",
  message: {
    id: root ? threadId : `msg_${cursor}`,
    threadId,
    channel: "ship/workers",
    author: "raj",
    text: "On it.",
    createdAt: "t",
    via: "web",
  },
});

const setup = Effect.gen(function* () {
  const events = yield* Queue.unbounded<BoardService.BoardEvent>();
  // Every event the tail hands on, so a test knows a burst has arrived before moving the clock.
  const seen = yield* Queue.unbounded<BoardService.BoardEvent>();
  const capabilities = yield* Queue.unbounded<BoardService.BoardCapabilities>();
  const tails = yield* Queue.unbounded<ReadonlyArray<string>>();
  const board = { needs: 0, reads: 0 };
  const layer = BoardNeedsYou.layer.pipe(
    Layer.provide(
      Layer.mock(BoardService.BoardService)({
        capabilityChanges: Stream.fromQueue(capabilities),
        tail: (args) =>
          Stream.unwrap(
            Queue.offer(tails, args).pipe(
              Effect.as(
                Stream.fromQueue(events).pipe(Stream.tap((event) => Queue.offer(seen, event))),
              ),
            ),
          ),
        run: (command) =>
          Effect.sync(() => {
            if (command.args[0] !== "channels") return { cursor: 5 } as never;
            board.reads += 1;
            // Spread over channels as the board reports them.
            return {
              channels: [
                { channel: "ship/workers", needs: board.needs },
                { channel: "threads", needs: 0 },
              ],
            } as never;
          }),
      }),
    ),
    Layer.provide(ServerSettings.layerTest({ boardEnabled: true })),
  );
  return { events, seen, capabilities, tails, board, layer };
});

/** Follows the count as a client does. */
const watch = Effect.gen(function* () {
  const counts = yield* Queue.unbounded<number | null>();
  const needsYou = yield* BoardNeedsYou.BoardNeedsYou;
  yield* needsYou.changes.pipe(
    Stream.runForEach((count) => Queue.offer(counts, count)),
    Effect.forkScoped,
  );
  return counts;
});

describe("BoardNeedsYou", () => {
  it.effect("reads the board once per burst and follows `needs` set then cleared", () =>
    Effect.gen(function* () {
      const { events, seen, capabilities, tails, board, layer } = yield* setup;
      yield* Effect.gen(function* () {
        const counts = yield* watch;
        yield* Queue.offer(capabilities, connected);
        // Tails from the board's newest event, so nothing written meanwhile is missed.
        assert.deepEqual(yield* Queue.take(tails), ["--after", "5"]);
        yield* TestClock.adjust(BoardNeedsYou.NEEDS_YOU_DEBOUNCE);
        assert.strictEqual(yield* Queue.take(counts), 0);
        assert.strictEqual(board.reads, 1);

        // Replies and other labels do not change who waits, so they cost no read.
        const unrelated = [posted("msg_a", 6), labelsChanged("msg_a", 7, { state: "blocked" })];
        yield* Queue.offerAll(events, unrelated);
        yield* Queue.takeN(seen, unrelated.length);
        yield* TestClock.adjust(BoardNeedsYou.NEEDS_YOU_DEBOUNCE);
        assert.strictEqual(board.reads, 1);

        // A burst: a question asked on the board, a new thread posted with `needs`, more noise.
        board.needs = 1;
        const burst = [
          labelsChanged("msg_a", 8, { needs: "decision" }),
          posted("msg_b", 9, true),
          posted("msg_b", 10),
          labelsChanged("msg_b", 11, { needs: "approval" }),
          labelsChanged("msg_b", 12, {}, ["needs"]),
        ];
        yield* Queue.offerAll(events, burst);
        yield* Queue.takeN(seen, burst.length);
        yield* TestClock.adjust(BoardNeedsYou.NEEDS_YOU_DEBOUNCE);
        assert.strictEqual(yield* Queue.take(counts), 1);
        assert.strictEqual(board.reads, 2);

        board.needs = 0;
        yield* Queue.offer(events, labelsChanged("msg_a", 13, { decision: "approved" }, ["needs"]));
        yield* Queue.take(seen);
        yield* TestClock.adjust(BoardNeedsYou.NEEDS_YOU_DEBOUNCE);
        assert.strictEqual(yield* Queue.take(counts), 0);
        assert.strictEqual(board.reads, 3);
      }).pipe(Effect.scoped, Effect.provide(layer));
    }),
  );

  it.effect("reports no count once the board stops answering", () =>
    Effect.gen(function* () {
      const { capabilities, tails, layer } = yield* setup;
      yield* Effect.gen(function* () {
        const counts = yield* watch;
        yield* Queue.offer(capabilities, { ...connected, features: [] });
        assert.deepEqual(yield* Queue.take(tails), []);
        yield* TestClock.adjust(BoardNeedsYou.NEEDS_YOU_DEBOUNCE);
        assert.strictEqual(yield* Queue.take(counts), 0);

        yield* Queue.offer(capabilities, { person: null, features: [], database: null });
        assert.isNull(yield* Queue.take(counts));
      }).pipe(Effect.scoped, Effect.provide(layer));
    }),
  );
});
