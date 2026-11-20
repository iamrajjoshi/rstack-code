import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as BoardBridge from "../../../board/BoardBridge.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { BoardToolkit } from "./tools.ts";

// The board refused the request; anything else is the CLI or this server failing.
const INFRASTRUCTURE_REASONS = new Set([
  "crashed",
  "timed_out",
  "output_too_large",
  "unexpected_output",
  "failed",
]);

const toFailure = (error: BoardBridge.BoardBridgeError) => {
  switch (error._tag) {
    case "BoardNotConnectedError":
    case "BoardNotInstalledError":
      return new OrchestratorMcpFailure({ code: "capability_denied", message: error.message });
    case "BoardCallerNotFoundError":
      return new OrchestratorMcpFailure({ code: "thread_not_found", message: error.message });
    case "BoardRequestError":
      return new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });
    case "BoardCommandError":
      return new OrchestratorMcpFailure({
        code: INFRASTRUCTURE_REASONS.has(error.reason) ? "orchestration_error" : "invalid_request",
        message: error.message,
      });
    case "ServerSettingsError":
      return new OrchestratorMcpFailure({
        code: "orchestration_error",
        message: "Unable to read server settings.",
      });
  }
};

/** Runs one bridge method as the calling thread. */
const asCaller = Effect.fn("BoardTools.asCaller")(function* <A>(
  call: (
    bridge: BoardBridge.BoardBridge["Service"],
    caller: BoardBridge.BoardCaller,
  ) => Effect.Effect<A, BoardBridge.BoardBridgeError>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "This tool");
  const bridge = yield* BoardBridge.BoardBridge;
  return yield* call(bridge, {
    threadId: thread.threadId,
    environmentId: scope.environmentId,
  }).pipe(Effect.mapError(toFailure));
});

export const layer = McpToolAccess.toLayer(BoardToolkit, {
  board_checkin: McpToolAccess.actsAsCaller((input) =>
    asCaller((bridge, caller) => bridge.checkin(caller, input)),
  ),
  board_post: McpToolAccess.actsAsCaller((input) =>
    asCaller((bridge, caller) => bridge.post(caller, input)),
  ),
  board_reply: McpToolAccess.actsAsCaller((input) =>
    asCaller((bridge, caller) => bridge.reply(caller, input)),
  ),
  board_read: McpToolAccess.readsAsCaller((input) =>
    asCaller((bridge, caller) => bridge.read(caller, input)),
  ),
  board_label: McpToolAccess.actsAsCaller((input) =>
    asCaller((bridge, caller) => bridge.label(caller, input)),
  ),
  board_claim: McpToolAccess.actsAsCaller((input) =>
    asCaller((bridge, caller) => bridge.claim(caller, input)),
  ),
  board_complete: McpToolAccess.actsAsCaller((input) =>
    asCaller((bridge, caller) => bridge.complete(caller, input)),
  ),
});
