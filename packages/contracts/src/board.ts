import * as Schema from "effect/Schema";

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
});
export type BoardStatus = typeof BoardStatus.Type;
