import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ProcessRunner from "../processRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as BoardService from "./BoardService.ts";

// A stand-in for the rstack-board CLI: logs each call and answers like the real one.
const fakeCli = (log: string) => `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
let stdin = "";
try { stdin = fs.readFileSync(0, "utf8"); } catch {}
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, stdin, thread: process.env.T3CODE_THREAD_ID ?? null }) + "\\n");
const rest = args.filter((arg, index) => arg !== "--json" && args[index - 1] !== "--as" && arg !== "--as");
if (rest[0] === "status") {
  console.log(JSON.stringify({ running: true, url: "http://localhost:4477", pid: 1, stateDir: "/b", database: "/b/board.db", version: "0.1.0", person: "raj", ...(process.env.FAKE_BOARD_OLD ? {} : { features: ["via", "tail-after"] }) }));
  process.exit(0);
}
if (rest[0] === "tail" && rest.includes("--unknown")) {
  console.error(JSON.stringify({ reason: "usage", message: "error: unknown option '--unknown'" }));
  process.exit(1);
}
if (rest[0] === "tail") {
  const base = { threadId: "msg_1", channel: "prs", actor: "raj", at: "t" };
  console.log(JSON.stringify({ ...base, cursor: 7, type: "thread.renamed" }));
  console.log(JSON.stringify({ ...base, cursor: 8, type: "labels.changed", set: { decision: "approved" }, unset: ["needs"], labels: { decision: "approved" } }));
  process.exit(0);
}
if (rest[0] === "reply" && rest[1] === "msg_missing") {
  console.error(JSON.stringify({ reason: "not_found", message: "No thread msg_missing." }));
  process.exit(1);
}
if (rest[0] === "reply") {
  console.log(JSON.stringify({ id: "msg_2", threadId: rest[1], channel: "prs", author: "a", text: stdin, createdAt: "t", extra: true }));
  process.exit(0);
}
if (rest[0] === "open") {
  console.error("node:internal/modules/esm/resolve:873\\n  throw new ERR_MODULE_NOT_FOUND(name);\\n        ^\\n\\nError [ERR_MODULE_NOT_FOUND]: Cannot find package 'commander'\\n    at somewhere");
  process.exit(1);
}
console.error("TypeError: something broke\\n    at somewhere");
process.exit(1);
`;

const Reply = Schema.Struct({ id: Schema.String, threadId: Schema.String, text: Schema.String });

const setup = Effect.fn("BoardServiceTest.setup")(function* (
  place: "path" | "home" | "none",
  env: Record<string, string> = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-board-" });
  const log = `${root}/calls.log`;
  const bin = place === "home" ? `${root}/home/.local/bin` : `${root}/bin`;
  yield* fs.makeDirectory(bin, { recursive: true });
  yield* fs.makeDirectory(`${root}/home`, { recursive: true });
  if (place !== "none") {
    yield* fs.writeFileString(`${bin}/rstack-board`, fakeCli(log));
    yield* fs.chmod(`${bin}/rstack-board`, 0o755);
  }
  const calls = fs.readFileString(log).pipe(
    Effect.orElseSucceed(() => ""),
    Effect.map((text) =>
      text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              readonly args: ReadonlyArray<string>;
              readonly stdin: string;
              readonly thread: string | null;
            },
        ),
    ),
  );
  const withHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(HostProcess.Environment, { PATH: `${root}/bin`, ...env }),
      Effect.provideService(HostProcess.HomeDirectory, `${root}/home`),
    );
  return { calls, withHost };
});

const layer = (enabled: boolean) =>
  BoardService.layer.pipe(
    Layer.provide(ProcessRunner.layer),
    Layer.provide(ServerSettings.layerTest({ boardEnabled: enabled })),
    Layer.provideMerge(NodeServices.layer),
  );

describe("BoardService", () => {
  it.live("reports a missing CLI with the reason", () =>
    Effect.gen(function* () {
      const { withHost } = yield* setup("none");
      const board = yield* BoardService.BoardService;
      const status = yield* withHost(board.status);
      assert.deepEqual(status, {
        enabled: true,
        installed: false,
        cliPath: null,
        version: null,
        databasePath: null,
        webUrl: null,
        error: "rstack-board is not installed on this machine.",
        replies: "update_needed",
        autoStatus: true,
      });
      assert.isFalse(yield* withHost(board.isConnected));
    }).pipe(Effect.scoped, Effect.provide(layer(true))),
  );

  it.live("finds the CLI in ~/.local/bin and reads its version and state", () =>
    Effect.gen(function* () {
      const { withHost } = yield* setup("home");
      const board = yield* BoardService.BoardService;
      const status = yield* withHost(board.status);
      assert.include(status, {
        enabled: true,
        installed: true,
        version: "0.1.0",
        databasePath: "/b/board.db",
        webUrl: "http://localhost:4477",
        error: null,
        replies: "on",
        autoStatus: true,
      });
      assert.match(status.cliPath ?? "", /home\/\.local\/bin\/rstack-board$/u);
      assert.isTrue(yield* withHost(board.isConnected));
    }).pipe(Effect.scoped, Effect.provide(layer(true))),
  );

  it.live("reports that reply delivery needs a board without `via`", () =>
    Effect.gen(function* () {
      const { withHost } = yield* setup("path", { FAKE_BOARD_OLD: "1" });
      const board = yield* BoardService.BoardService;
      assert.include(yield* withHost(board.status), { error: null, replies: "update_needed" });
      assert.deepEqual(yield* withHost(board.capabilities), {
        person: "raj",
        features: [],
        database: "/b/board.db",
      });
    }).pipe(Effect.scoped, Effect.provide(layer(true))),
  );

  it.live("tails events, skipping kinds it does not know, and fails when the CLI exits", () =>
    Effect.gen(function* () {
      const { calls, withHost } = yield* setup("path");
      const board = yield* BoardService.BoardService;
      assert.deepEqual((yield* withHost(board.capabilities)).features, ["via", "tail-after"]);
      const exit = yield* withHost(
        board.tail(["--by", "raj"]).pipe(Stream.runCollect, Effect.flip),
      );
      assert.include(exit, { _tag: "BoardCommandError", command: "tail", reason: "exited" });
      // The board's own reason on stderr, here a flag this CLI does not know.
      const refused = yield* withHost(
        board.tail(["--unknown"]).pipe(Stream.runCollect, Effect.flip),
      );
      assert.include(refused, { _tag: "BoardCommandError", command: "tail", reason: "usage" });
      assert.isTrue(BoardService.isPermanentBoardError(refused));
      const seen: Array<BoardService.BoardEvent> = [];
      yield* withHost(
        board.tail([]).pipe(
          Stream.runForEach((event) => Effect.sync(() => seen.push(event))),
          Effect.ignore,
        ),
      );
      assert.deepEqual(
        seen.map((event) => [event.type, event.cursor]),
        [["labels.changed", 8]],
      );
      assert.deepEqual(
        (yield* calls).map((call) => call.args),
        [
          ["--json", "status"],
          ["--json", "tail", "--by", "raj"],
          ["--json", "tail", "--unknown"],
          ["--json", "tail"],
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(layer(true))),
  );

  it.live("refuses commands and never probes while the board is off", () =>
    Effect.gen(function* () {
      const { calls, withHost } = yield* setup("path");
      const board = yield* BoardService.BoardService;
      const error = yield* withHost(board.run({ args: ["reply", "msg_1"] }, Reply)).pipe(
        Effect.flip,
      );
      assert.strictEqual(error._tag, "BoardNotConnectedError");
      assert.isFalse(yield* withHost(board.isConnected));
      assert.deepEqual(yield* calls, []);
    }).pipe(Effect.scoped, Effect.provide(layer(false))),
  );

  it.live("runs as the given handle with stdin and the thread id, ignoring extra fields", () =>
    Effect.gen(function* () {
      const { calls, withHost } = yield* setup("path");
      const board = yield* BoardService.BoardService;
      const reply = yield* withHost(
        board.run(
          {
            args: ["reply", "msg_1", "--file", "-"],
            as: "fix-search-c1a2b3",
            stdin: "- starts with a dash",
            threadId: "thread-1",
          },
          Reply,
        ),
      );
      assert.deepEqual(reply, { id: "msg_2", threadId: "msg_1", text: "- starts with a dash" });
      assert.deepEqual(yield* calls, [
        {
          args: ["--json", "--as", "fix-search-c1a2b3", "reply", "msg_1", "--file", "-"],
          stdin: "- starts with a dash",
          thread: "thread-1",
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(layer(true))),
  );

  it.live("maps the board's error and a crash to typed errors", () =>
    Effect.gen(function* () {
      const { withHost } = yield* setup("path");
      const board = yield* BoardService.BoardService;
      const refused = yield* withHost(board.run({ args: ["reply", "msg_missing"] }, Reply)).pipe(
        Effect.flip,
      );
      assert.include(refused, {
        _tag: "BoardCommandError",
        command: "reply",
        reason: "not_found",
        detail: "No thread msg_missing.",
      });
      const crashed = yield* withHost(board.run({ args: ["tasks", "claim"] }, Reply)).pipe(
        Effect.flip,
      );
      assert.include(crashed, {
        _tag: "BoardCommandError",
        command: "tasks claim",
        reason: "crashed",
        detail: "TypeError: something broke",
      });
      // A broken install fails before the board runs; the error line, not the trace, is the reason.
      const broken = yield* withHost(board.run({ args: ["open", "--no-open"] }, Reply)).pipe(
        Effect.flip,
      );
      assert.strictEqual(
        broken.message,
        "rstack-board open failed: crashed. Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'commander'",
      );
    }).pipe(Effect.scoped, Effect.provide(layer(true))),
  );
});
