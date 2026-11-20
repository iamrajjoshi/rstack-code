import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpToolAccessTestkit from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as BoardBridge from "./BoardBridge.ts";
import * as BoardService from "./BoardService.ts";
import * as BoardStatusReactor from "./BoardStatusReactor.ts";

const coordinatorId = ThreadId.make("thread-coord");
const workerId = ThreadId.make("thread-worker");
const loneId = ThreadId.make("thread-lone-subagent");
const plainParentId = ThreadId.make("thread-plain");

const subagentOf = (parentThreadId: ThreadId) => ({
  rootThreadId: parentThreadId,
  parentThreadId,
  relationshipToParent: "subagent" as const,
});
const shells: Record<string, OrchestrationV2ThreadShell> = {
  [coordinatorId]: {
    ...McpToolAccessTestkit.liveThreadShell(coordinatorId),
    title: "Ship search v2",
    coordinator: true,
  },
  [workerId]: {
    ...McpToolAccessTestkit.liveThreadShell(workerId),
    title: "Fix flaky search test",
    branch: "fix/search",
    lineage: subagentOf(coordinatorId),
  },
  [plainParentId]: { ...McpToolAccessTestkit.liveThreadShell(plainParentId), title: "Plain" },
  [loneId]: {
    ...McpToolAccessTestkit.liveThreadShell(loneId),
    title: "Lone",
    lineage: subagentOf(plainParentId),
  },
};

const run = (threadId: ThreadId, status: string) =>
  ({ type: "run.updated", threadId, payload: { status } }) as never as OrchestrationV2DomainEvent;
const question = (threadId: ThreadId) =>
  ({
    type: "runtime-request.updated",
    threadId,
    payload: { kind: "user_input", status: "pending", responseCapability: { type: "live" } },
  }) as never as OrchestrationV2DomainEvent;

const setup = Effect.gen(function* () {
  const domainEvents = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const commands = yield* Queue.unbounded<BoardService.BoardCommand>();
  // What the worker's check-in thread shows when the server reads it.
  const board = { labels: {} as Record<string, string>, failCheckin: false };
  const layer = BoardStatusReactor.layer.pipe(
    Layer.provide(BoardBridge.layer),
    Layer.provide(
      Layer.mock(BoardService.BoardService)({
        isConnected: Effect.succeed(true),
        run: (command) =>
          Queue.offer(commands, command).pipe(
            Effect.andThen(() => {
              if (command.args[0] === "read") {
                return Effect.succeed({
                  threads: Object.keys(board.labels).length === 0 ? [] : [{ labels: board.labels }],
                } as never);
              }
              return board.failCheckin
                ? Effect.fail(
                    new BoardService.BoardCommandError({ command: "checkin", reason: "crashed" }),
                  )
                : Effect.succeed({ id: "msg_1", channel: "c", labels: {} } as never);
            }),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: (threadId) => Effect.succeed(shells[threadId] ?? null),
        streamDomainEvents: Stream.fromQueue(domainEvents),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: () => Effect.succeedNone,
      }),
    ),
    Layer.provide(
      Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
        getEnvironmentId: Effect.succeed(EnvironmentId.make("env-1")),
      }),
    ),
    Layer.provide(ServerSettings.layerTest({ boardEnabled: true })),
  );
  return { domainEvents, commands, board, layer };
});

const stateOf = (command: BoardService.BoardCommand) =>
  command.args[command.args.indexOf("--state") + 1];

describe("BoardStatusReactor", () => {
  it.effect(
    "checks workers in once per state, after their own check-ins, and survives failures",
    () =>
      Effect.gen(function* () {
        const { domainEvents, commands, board, layer } = yield* setup;
        yield* Effect.gen(function* () {
          const reactor = yield* BoardStatusReactor.BoardStatusReactor;
          yield* reactor.start();
          const next = Queue.take(commands);

          yield* Queue.offer(domainEvents, run(workerId, "running"));
          assert.deepEqual((yield* next).args, [
            "read",
            "-n",
            "1",
            "--label",
            `t3=${workerId}`,
            "--",
            "ship-search-v2-utk1sl/workers",
          ]);
          const working = yield* next;
          assert.strictEqual(stateOf(working), "working");
          assert.include(working.args, "branch=fix/search");
          assert.strictEqual(working.as, "fix-flaky-search-test-38fh3u");

          // A second `running` reads nothing; the question that follows is the next call.
          yield* Queue.offerAll(domainEvents, [run(workerId, "running"), question(workerId)]);
          assert.strictEqual((yield* next).args[0], "read");
          const blocked = yield* next;
          assert.strictEqual(stateOf(blocked), "blocked");
          assert.include(blocked.args, "answer");

          // The agent already checked in as done, so the server posts nothing more.
          board.labels = { state: "done" };
          yield* Queue.offer(domainEvents, run(workerId, "completed"));
          assert.strictEqual((yield* next).args[0], "read");

          // A failed post is only logged; later events still reach the board.
          board.labels = {};
          board.failCheckin = true;
          yield* Queue.offer(domainEvents, run(workerId, "failed"));
          assert.strictEqual((yield* next).args[0], "read");
          assert.strictEqual(stateOf(yield* next), "failed");

          // A subagent outside any coordinator tree is never checked in.
          board.failCheckin = false;
          yield* Queue.offerAll(domainEvents, [run(loneId, "running"), run(workerId, "running")]);
          assert.strictEqual((yield* next).args[0], "read");
          assert.strictEqual(stateOf(yield* next), "working");
          assert.strictEqual(yield* Queue.size(commands), 0);
        }).pipe(Effect.scoped, Effect.provide(layer));
      }),
  );
});
