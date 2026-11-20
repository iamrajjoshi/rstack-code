import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as BoardBridge from "./BoardBridge.ts";
import * as BoardService from "./BoardService.ts";

const MAX_REMEMBERED = 1_000;

type AutoStatus = Pick<BoardBridge.BoardCheckinInput, "status" | "needs">;

/** The check-in an event implies for its thread, or null when it changes nothing on the board. */
const boardStatusOf = (event: OrchestrationV2DomainEvent): AutoStatus | null => {
  if (event.type === "run.created" || event.type === "run.updated") {
    switch (event.payload.status) {
      case "running":
        return { status: "working" };
      case "completed":
        return { status: "done" };
      case "failed":
        return { status: "failed" };
      default:
        return null;
    }
  }
  if (event.type !== "runtime-request.updated") return null;
  const request = event.payload;
  // The app answers tool calls and auth itself; a `message` question does not stop the run.
  if (
    request.kind === "dynamic_tool_call" ||
    request.kind === "auth_refresh" ||
    request.responseCapability.type !== "live"
  ) {
    return null;
  }
  if (request.status === "pending") {
    return { status: "needs_input", needs: request.kind === "user_input" ? "answer" : "approval" };
  }
  return request.status === "resolved" ? { status: "working" } : null;
};

const noteFor = (status: AutoStatus, shell: OrchestrationV2ThreadShell, pr: number | undefined) => {
  const where = [
    ...(shell.branch === null ? [] : [`branch ${shell.branch}`]),
    ...(shell.worktreePath === null ? [] : [`worktree ${shell.worktreePath}`]),
    ...(pr === undefined ? [] : [`PR #${pr}`]),
  ].join(", ");
  const suffix = where === "" ? "" : ` (${where})`;
  switch (status.status) {
    case "working":
      return `Working${suffix}.`;
    case "needs_input":
      return status.needs === "answer"
        ? "Waiting on an answer in rstack code."
        : "Waiting on an approval in rstack code.";
    case "done":
      return `Finished${suffix}.`;
    case "failed":
      return `Failed${suffix}.`;
  }
};

/** Keeps coordinator workers' check-ins right on the board when their agents forget to. */
export class BoardStatusReactor extends Context.Service<
  BoardStatusReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/board/BoardStatusReactor") {}

const make = Effect.gen(function* () {
  const board = yield* BoardService.BoardService;
  const bridge = yield* BoardBridge.BoardBridge;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const environmentId = yield* (yield* ServerEnvironment.ServerEnvironmentIdentity)
    .getEnvironmentId;
  // Runs repeat a status (every steer is another `running`); skip those without a board read.
  const lastPosted = new Map<ThreadId, string>();

  const handle = Effect.fn("BoardStatusReactor.handle")(
    function* (event: OrchestrationV2DomainEvent, status: AutoStatus) {
      const settings = yield* settingsService.getSettings;
      if (!settings.boardEnabled || !settings.boardAutoStatus) return;
      const key = `${status.status}:${status.needs ?? ""}`;
      if (lastPosted.get(event.threadId) === key) return;
      const shell = yield* threads.getThreadShell(event.threadId);
      if (shell === null || shell.lineage.relationshipToParent !== "subagent") return;
      if (status.status === "working" && event.type === "runtime-request.updated") {
        if (shell.activeRunId === null) return;
      }
      if (!(yield* board.isConnected)) return;
      const pr = (shell.linkedPullRequest ?? shell.branchPullRequest)?.number;
      yield* bridge.autoCheckin(
        { threadId: event.threadId, environmentId },
        {
          ...status,
          note: noteFor(status, shell, pr),
          ...(shell.branch === null ? {} : { branch: shell.branch }),
          ...(shell.worktreePath === null ? {} : { worktree: shell.worktreePath }),
          ...(pr === undefined ? {} : { pr }),
        },
      );
      if (lastPosted.size >= MAX_REMEMBERED) lastPosted.clear();
      lastPosted.set(event.threadId, key);
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("checking a worker in on the board failed", {
            threadId: event.threadId,
            cause,
          }),
        ),
      ),
  );

  const start: BoardStatusReactor["Service"]["start"] = Effect.fn("BoardStatusReactor.start")(
    function* () {
      // Per thread in order, so a slow board delays only that worker's later check-ins.
      const reactions = yield* KeyedLock.makeRunner<ThreadId>();
      yield* forkParked(
        Stream.runForEach(threads.streamDomainEvents, (event) => {
          const status = boardStatusOf(event);
          return status === null
            ? Effect.void
            : reactions.run(event.threadId, handle(event, status));
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("board status event stream failed", { cause }),
          ),
        ),
      );
    },
  );

  return BoardStatusReactor.of({ start });
});

export const layer = Layer.effect(BoardStatusReactor, make);
