import { describe, expect, it } from "@effect/vitest";

import { type BoardIdentityThread, deriveBoardIdentity } from "./boardIdentity.ts";

const worker: BoardIdentityThread = { id: "thread-worker", title: "Fix flaky search test" };
const coordinator: BoardIdentityThread = {
  id: "thread-coord",
  title: "Ship search v2",
  coordinator: true,
};
const rootCoordinator: BoardIdentityThread = {
  id: "thread-root",
  title: "Release planning",
  coordinator: true,
};
const auto = { boardChannel: "", boardAutoIdentity: true };

describe("deriveBoardIdentity", () => {
  it.each([
    {
      name: "a plain thread posts as itself in the project's channel",
      thread: worker,
      ancestors: [],
      projectTitle: "rstack Code",
      settings: auto,
      expected: { handle: "fix-flaky-search-test-38fh3u", channel: "rstack-code" },
    },
    {
      name: "a worker checks in under its coordinator",
      thread: worker,
      ancestors: [coordinator],
      projectTitle: "rstack Code",
      settings: auto,
      expected: {
        handle: "fix-flaky-search-test-38fh3u",
        coordinator: "ship-search-v2-utk1sl",
        channel: "rstack-code",
      },
    },
    {
      name: "a worker under a sub-coordinator checks in under the root-most coordinator",
      thread: worker,
      ancestors: [coordinator, { id: "thread-plain", title: "Plain" }, rootCoordinator],
      projectTitle: null,
      settings: auto,
      expected: {
        handle: "fix-flaky-search-test-38fh3u",
        coordinator: "release-planning-t0bo6c",
        channel: "threads",
      },
    },
    {
      name: "a root coordinator checks in under itself",
      thread: coordinator,
      ancestors: [],
      projectTitle: "rstack Code",
      settings: auto,
      expected: {
        handle: "ship-search-v2-utk1sl",
        coordinator: "ship-search-v2-utk1sl",
        channel: "rstack-code",
      },
    },
    {
      name: "untitled threads and odd ids still get a valid handle; the setting names the channel",
      thread: { id: "thread:mcp:ns:key:0", title: "" },
      ancestors: [],
      projectTitle: "rstack Code",
      settings: { boardChannel: "prs/search", boardAutoIdentity: true },
      expected: { handle: "thread-9aukh3", channel: "prs/search" },
    },
    {
      name: "accents fold and long titles are cut",
      thread: { id: "thread-sub", title: "Café: ÜBER long title that keeps going and going" },
      ancestors: [],
      projectTitle: "Ünïcode ✨ Project",
      settings: auto,
      expected: { handle: "cafe-uber-long-title-tha-ahfzx2", channel: "unicode-project" },
    },
    {
      name: "automatic identity off leaves the handle to the board",
      thread: worker,
      ancestors: [coordinator],
      projectTitle: "rstack Code",
      settings: { boardChannel: "", boardAutoIdentity: false },
      expected: { channel: "rstack-code" },
    },
  ])("$name", ({ thread, ancestors, projectTitle, settings, expected }) => {
    expect(
      deriveBoardIdentity({ thread, ancestors, projectTitle, environmentId: "env-1", settings }),
    ).toEqual({ ...expected, labels: { t3: thread.id, env: "env-1" } });
  });
});
