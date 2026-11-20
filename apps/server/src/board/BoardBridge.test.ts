import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, type OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as McpToolAccessTestkit from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as BoardBridge from "./BoardBridge.ts";
import * as BoardService from "./BoardService.ts";

const environmentId = EnvironmentId.make("env-1");
const coordinatorId = ThreadId.make("thread-coord");
const workerId = ThreadId.make("thread-worker");
const plainId = ThreadId.make("thread-plain");

const setup = Effect.sync(() => {
  const commands: Array<BoardService.BoardCommand> = [];
  const board = { features: [] as ReadonlyArray<string> };
  const shells: Record<string, OrchestrationV2ThreadShell> = {
    [coordinatorId]: {
      ...McpToolAccessTestkit.liveThreadShell(coordinatorId),
      title: "Ship search v2",
      coordinator: true,
    },
    [workerId]: {
      ...McpToolAccessTestkit.liveThreadShell(workerId),
      title: "Fix flaky search test",
      lineage: {
        rootThreadId: coordinatorId,
        parentThreadId: coordinatorId,
        relationshipToParent: "subagent",
      },
    },
    [plainId]: {
      ...McpToolAccessTestkit.liveThreadShell(plainId),
      title: "  Tidy the\n  release notes  ",
    },
  };
  const layer = BoardBridge.layer.pipe(
    Layer.provide(
      Layer.mock(BoardService.BoardService)({
        capabilities: Effect.sync(() => ({
          person: "raj",
          features: board.features,
          database: "/b/board.db",
        })),
        run: (command) =>
          Effect.sync(() => commands.push(command)).pipe(
            Effect.as({ id: "msg_1", threadId: "msg_1", channel: "c", labels: {} } as never),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: (threadId) => Effect.succeed(shells[threadId] ?? null),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: () => Effect.succeedSome({ title: "rstack Code" } as never),
      }),
    ),
    Layer.provide(ServerSettings.layerTest({ boardEnabled: true })),
  );
  return { commands, board, shells, layer };
});

const optionValue = (command: BoardService.BoardCommand | undefined, option: string) => {
  const index = command?.args.indexOf(option) ?? -1;
  return index === -1 ? undefined : command?.args[index + 1];
};

describe("BoardBridge", () => {
  it.effect("files check-ins by channel, labels them with the title, and settles tasks", () =>
    Effect.gen(function* () {
      const { commands, board, shells, layer } = yield* setup;
      yield* Effect.gen(function* () {
        const bridge = yield* BoardBridge.BoardBridge;
        const plain = { threadId: plainId, environmentId };
        const worker = { threadId: workerId, environmentId };

        // An older CLI cannot take --channel, so the plain thread's check-in keeps its default.
        yield* bridge.checkin(plain, { status: "working", note: "Starting." });
        assert.isUndefined(optionValue(commands.at(-1), "--channel"));
        assert.include(commands.at(-1)?.args ?? [], "title=Tidy the release notes");

        board.features = ["checkin-channel", "tasks-file"];
        yield* bridge.checkin(plain, { status: "working", note: "Still going." });
        assert.strictEqual(optionValue(commands.at(-1), "--channel"), "rstack-code");
        // A worker stays under its coordinator.
        yield* bridge.checkin(worker, { status: "done", note: "Done." });
        assert.isUndefined(optionValue(commands.at(-1), "--channel"));
        assert.strictEqual(optionValue(commands.at(-1), "--coordinator"), "ship-search-v2-utk1sl");

        // A retitled thread shows its new title from its next post on; the handle stays.
        shells[plainId] = { ...shells[plainId]!, title: "Ship the release notes" };
        yield* bridge.post(plain, { text: "Draft is up." });
        assert.include(commands.at(-1)?.args ?? [], "title=Ship the release notes");
        assert.strictEqual(commands.at(-1)?.as, commands[0]?.as);

        yield* bridge.complete(worker, { id: "msg_task", outcome: "failed", result: "--force" });
        assert.deepEqual(commands.at(-1)?.args, ["tasks", "fail", "--file", "-", "--", "msg_task"]);
        assert.strictEqual(commands.at(-1)?.stdin, "--force");
        board.features = [];
        yield* bridge.complete(worker, { id: "msg_task", result: "Merged." });
        assert.deepEqual(commands.at(-1)?.args, ["tasks", "complete", "--", "msg_task", "Merged."]);
      }).pipe(Effect.provide(layer));
    }),
  );
});
