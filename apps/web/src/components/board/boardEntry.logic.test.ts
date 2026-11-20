import { describe, expect, it } from "vite-plus/test";

import { boardEntryVisible, boardOpenTarget, openOnBoardVisible } from "./boardEntry.logic";

const ready = { boardEnabled: true, canOpen: true, hasThread: true };

describe("boardEntryVisible", () => {
  it.each([
    { name: "everything in place", state: ready, visible: true },
    {
      name: "board off for the environment",
      state: { ...ready, boardEnabled: false },
      visible: false,
    },
    { name: "connection cannot run the CLI", state: { ...ready, canOpen: false }, visible: false },
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

describe("boardOpenTarget", () => {
  it.each([
    {
      name: "desktop, or a server browser: the thread's panel",
      input: { previewAvailable: true, reachesServerLoopback: false },
      target: "panel",
    },
    {
      name: "web client on the server's machine: a new tab",
      input: { previewAvailable: false, reachesServerLoopback: true },
      target: "tab",
    },
    {
      name: "web client of a remote server: only the address",
      input: { previewAvailable: false, reachesServerLoopback: false },
      target: "address",
    },
  ] as const)("$name", ({ input, target }) => {
    expect(boardOpenTarget(input)).toBe(target);
  });
});
