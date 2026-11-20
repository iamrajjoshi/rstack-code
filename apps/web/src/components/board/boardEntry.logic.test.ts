import { describe, expect, it } from "vite-plus/test";

import { boardEntryVisible, openOnBoardVisible } from "./boardEntry.logic";

const ready = { boardEnabled: true, canOpen: true, previewAvailable: true, hasThread: true };

describe("boardEntryVisible", () => {
  it.each([
    { name: "everything in place", state: ready, visible: true },
    {
      name: "board off for the environment",
      state: { ...ready, boardEnabled: false },
      visible: false,
    },
    { name: "connection cannot run the CLI", state: { ...ready, canOpen: false }, visible: false },
    { name: "no browser panel", state: { ...ready, previewAvailable: false }, visible: false },
    { name: "no thread to open the tab in", state: { ...ready, hasThread: false }, visible: false },
  ])("$name", ({ state, visible }) => {
    expect(boardEntryVisible(state)).toBe(visible);
  });

  it("offers Open on board only to coordinators", () => {
    expect(openOnBoardVisible({ ...ready, coordinator: true })).toBe(true);
    expect(openOnBoardVisible({ ...ready, coordinator: false })).toBe(false);
    expect(openOnBoardVisible({ ...ready, coordinator: true, boardEnabled: false })).toBe(false);
  });
});
