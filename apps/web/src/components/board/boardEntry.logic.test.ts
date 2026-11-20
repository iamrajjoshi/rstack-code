import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  boardEmbed,
  boardEnvironmentIds,
  boardPort,
  boardSearchFromUrl,
  boardUrlWithTheme,
  chooseBoardEnvironment,
  openOnBoardVisible,
} from "./boardEntry.logic";

const local = "local" as EnvironmentId;
const devbox = "devbox" as EnvironmentId;
const laptop = "laptop" as EnvironmentId;

describe("openOnBoardVisible", () => {
  it("offers Open on board only to coordinators whose environment has the board", () => {
    const ready = { boardEnabled: true, canOpen: true, coordinator: true };
    expect(openOnBoardVisible(ready)).toBe(true);
    expect(openOnBoardVisible({ ...ready, coordinator: false })).toBe(false);
    expect(openOnBoardVisible({ ...ready, boardEnabled: false })).toBe(false);
    expect(openOnBoardVisible({ ...ready, canOpen: false })).toBe(false);
  });
});

describe("boardEnvironmentIds", () => {
  it("keeps connected environments with the board turned on", () => {
    expect(
      boardEnvironmentIds([
        { environmentId: local, connected: true, boardEnabled: false },
        { environmentId: devbox, connected: true, boardEnabled: true },
        { environmentId: laptop, connected: false, boardEnabled: true },
      ]),
    ).toEqual([devbox]);
  });
});

describe("chooseBoardEnvironment", () => {
  const available = [devbox, laptop];
  it.each([
    {
      name: "a link's environment first",
      input: { requested: laptop, remembered: devbox, lastThread: devbox },
      chosen: laptop,
    },
    {
      name: "then this device's last choice",
      input: { requested: undefined, remembered: laptop, lastThread: devbox },
      chosen: laptop,
    },
    {
      name: "then the last open thread's environment",
      input: { requested: undefined, remembered: null, lastThread: laptop },
      chosen: laptop,
    },
    {
      name: "skipping ones without the board, down to the first that has it",
      input: { requested: local, remembered: local, lastThread: local },
      chosen: devbox,
    },
  ])("$name", ({ input, chosen }) => {
    expect(chooseBoardEnvironment({ available, ...input })).toBe(chosen);
  });

  it("has nothing to choose when no environment has the board", () => {
    expect(
      chooseBoardEnvironment({
        available: [],
        requested: devbox,
        remembered: null,
        lastThread: null,
      }),
    ).toBeNull();
  });
});

describe("boardEmbed", () => {
  it.each([
    {
      name: "desktop and its own environment: this machine's loopback",
      input: { canForward: false, locality: "unknown", reachesLoopback: true },
      embed: "direct",
    },
    {
      name: "desktop and an SSH environment: forward the port here",
      input: { canForward: true, locality: "remote", reachesLoopback: true },
      embed: "forward",
    },
    {
      name: "desktop while it tells whether the environment runs here",
      input: { canForward: true, locality: "pending", reachesLoopback: false },
      embed: "locating",
    },
    {
      name: "desktop and a route that leads back to this computer",
      input: { canForward: true, locality: "local", reachesLoopback: false },
      embed: "direct",
    },
    {
      name: "desktop that could not tell: try a forward",
      input: { canForward: true, locality: "unknown", reachesLoopback: false },
      embed: "forward",
    },
    {
      name: "web client served by the server's machine",
      input: { canForward: false, locality: "unknown", reachesLoopback: true },
      embed: "direct",
    },
    {
      name: "web client of a remote server: only the address",
      input: { canForward: false, locality: "unknown", reachesLoopback: false },
      embed: "address",
    },
  ] as const)("$name", ({ input, embed }) => {
    expect(boardEmbed(input)).toBe(embed);
  });
});

describe("boardPort", () => {
  it("reads the page's port, defaulting by protocol", () => {
    expect(boardPort("http://127.0.0.1:4477/#/c/artemis/")).toBe(4477);
    expect(boardPort("http://localhost/")).toBe(80);
  });
});

describe("boardUrlWithTheme", () => {
  it("adds the app's appearance before the board's hash route", () => {
    expect(boardUrlWithTheme("http://127.0.0.1:4477/#/c/artemis/", "dark")).toBe(
      "http://127.0.0.1:4477/?theme=dark#/c/artemis/",
    );
    expect(boardUrlWithTheme("http://127.0.0.1:4477/", "light")).toBe(
      "http://127.0.0.1:4477/?theme=light",
    );
  });

  it("replaces a theme already in the address", () => {
    expect(boardUrlWithTheme("http://127.0.0.1:4477/?theme=light", "dark")).toBe(
      "http://127.0.0.1:4477/?theme=dark",
    );
  });
});

describe("boardSearchFromUrl", () => {
  it("keeps every key, trimmed, and drops what is not text", () => {
    expect(boardSearchFromUrl({ boardServer: " devbox ", boardThread: 7 })).toEqual({
      boardServer: "devbox",
      boardThread: undefined,
    });
  });
});
