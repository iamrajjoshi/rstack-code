export interface BoardEntryState {
  /** The thread's environment has rstack-board turned on in its settings. */
  readonly boardEnabled: boolean;
  /** This connection may run the board's CLI there. */
  readonly canOpen: boolean;
  /** The board opens in a browser tab of the thread, so the environment needs the panel. */
  readonly previewAvailable: boolean;
  readonly hasThread: boolean;
}

/** The sidebar's Board button and the command palette's Open board. */
export function boardEntryVisible(state: BoardEntryState): boolean {
  return state.hasThread && state.boardEnabled && state.canOpen && state.previewAvailable;
}

/** A coordinator's Open on board, which shows the channels of that coordinator's workers. */
export function openOnBoardVisible(
  state: BoardEntryState & { readonly coordinator: boolean },
): boolean {
  return state.coordinator && boardEntryVisible(state);
}
