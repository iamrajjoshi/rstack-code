export interface BoardEntryState {
  /** The thread's environment has rstack-board turned on in its settings. */
  readonly boardEnabled: boolean;
  /** This connection may run the board's CLI there. */
  readonly canOpen: boolean;
  readonly hasThread: boolean;
}

/** The sidebar's Board button and the command palette's Open board. */
export function boardEntryVisible(state: BoardEntryState): boolean {
  return state.hasThread && state.boardEnabled && state.canOpen;
}

/** A coordinator's Open on board, which shows the channels of that coordinator's workers. */
export function openOnBoardVisible(
  state: BoardEntryState & { readonly coordinator: boolean },
): boolean {
  return state.coordinator && boardEntryVisible(state);
}

/**
 * Where the board's page opens: the thread's browser panel when the environment has one; else a
 * new tab of this browser when it reaches the server's localhost, as a web client served on the
 * same machine does; else only its address, which this browser cannot load.
 */
export type BoardOpenTarget = "panel" | "tab" | "address";

/**
 * The board's address with `?theme=` set to the app's appearance, which the board's page uses
 * for that tab instead of the browser's `prefers-color-scheme`. Its `#/...` route is kept.
 */
export function boardUrlWithTheme(url: string, appearance: "light" | "dark"): string {
  const themed = new URL(url);
  themed.searchParams.set("theme", appearance);
  return themed.toString();
}

export function boardOpenTarget(input: {
  readonly previewAvailable: boolean;
  readonly reachesServerLoopback: boolean;
}): BoardOpenTarget {
  if (input.previewAvailable) return "panel";
  return input.reachesServerLoopback ? "tab" : "address";
}
