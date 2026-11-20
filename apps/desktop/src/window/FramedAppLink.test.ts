import { describe, expect, it } from "vite-plus/test";

import { framedAppThreadLink } from "./FramedAppLink.ts";

const board = "http://localhost:4477/#/c/artemis/";
const link = "rstackcode://threads/env-1/thread-1";

describe("framedAppThreadLink", () => {
  it.each([
    { name: "a board link in a framed loopback page", input: {}, opened: link },
    {
      name: "the development channel's scheme",
      input: { url: "rstackcode-dev://threads/env-1/thread-1" },
      opened: "rstackcode-dev://threads/env-1/thread-1",
    },
    { name: "the app's own frame", input: { isMainFrame: true }, opened: null },
    {
      name: "a page from another host",
      input: { initiatorUrl: "https://example.com/" },
      opened: null,
    },
    { name: "no initiating page", input: { initiatorUrl: undefined }, opened: null },
    { name: "a prompt link", input: { url: `${link}?prompt=rm` }, opened: null },
    { name: "a new-thread link", input: { url: "rstackcode://new" }, opened: null },
    { name: "a web link", input: { url: "http://localhost:4477/" }, opened: null },
  ])("$name", ({ input, opened }) => {
    expect(
      framedAppThreadLink({ url: link, isMainFrame: false, initiatorUrl: board, ...input }),
    ).toBe(opened);
  });
});
