import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

/** From the board's README; Settings shows it while the CLI is missing. */
export const BOARD_INSTALL_COMMAND =
  "git clone https://github.com/iamrajjoshi/rstack-board.git && cd rstack-board && pnpm install && pnpm build && npm link";

/** What the server found when it last ran the rstack-board CLI. */
export const BoardStatus = Schema.Struct({
  /** Settings → Threads → Board → Connect. */
  enabled: Schema.Boolean,
  /** The CLI ran and answered. */
  installed: Schema.Boolean,
  /** The executable the server runs, once resolved. */
  cliPath: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  databasePath: Schema.NullOr(Schema.String),
  /** The board's browser page, when its local server is running. */
  webUrl: Schema.NullOr(Schema.String),
  /** Why the board is not usable, when it is not. */
  error: Schema.NullOr(Schema.String),
  /**
   * Whether the person's board replies reach threads: `update_needed` while the CLI predates the
   * features delivery relies on. Optional for servers that do not report it.
   */
  replies: Schema.optionalKey(Schema.Literals(["on", "off", "update_needed"])),
  /** Settings → Board → Automatic board status, as the server reads it. */
  autoStatus: Schema.optionalKey(Schema.Boolean),
});
export type BoardStatus = typeof BoardStatus.Type;

/**
 * Board threads waiting on the person: those carrying a `needs` label, as the board's own "needs
 * you" view counts them. `null` while the board is not connected.
 */
export const BoardNeedsYou = Schema.Struct({ needsYou: Schema.NullOr(Schema.Number) });
export type BoardNeedsYou = typeof BoardNeedsYou.Type;

/** Starts the board's page on the server's machine when it is not running. */
export const BOARD_OPEN_COMMAND = "rstack-board open --no-open";

export const BoardOpenInput = Schema.Struct({
  /** A coordinator's thread, or one of its workers', opens that coordinator's channels. */
  threadId: Schema.optionalKey(ThreadId),
});
export type BoardOpenInput = typeof BoardOpenInput.Type;

export const BoardOpenResult = Schema.Struct({
  /** The board's page as the server's machine reaches it, such as `http://localhost:4477/#/needs`. */
  url: Schema.String,
});
export type BoardOpenResult = typeof BoardOpenResult.Type;

export class BoardOpenError extends Schema.TaggedError<BoardOpenError>()("BoardOpenError", {
  message: Schema.String,
}) {}
