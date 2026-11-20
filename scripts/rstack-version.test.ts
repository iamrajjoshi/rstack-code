import { compareSemverVersions } from "@t3tools/shared/semver";
import { describe, expect, it } from "vite-plus/test";

import { describeForkVersion, nextForkVersion } from "./rstack-version.ts";

// The SSH launcher's runtime directory check (packages/ssh/src/tunnel.ts) and the release workflow.
const EXACT_ARCHIVE_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

// What the fork had published by hand, plus upstream tags that forked repositories inherit.
const PUBLISHED = [
  "v0.1.9",
  "v0.1.10",
  "v0.1.11",
  "v0.1.12",
  "v0.1.13",
  "v0.1.14",
  "v0.1.9-preview.20261111.4511",
];

describe("nextForkVersion", () => {
  it.each([
    ["first build of an upstream version", "0.1.11", PUBLISHED, "0.1011.0"],
    [
      "next build of the same upstream version",
      "0.1.11",
      [...PUBLISHED, "v0.1011.0", "v0.1011.1"],
      "0.1011.2",
    ],
    ["newer upstream patch resets the build", "0.1.12", [...PUBLISHED, "v0.1011.4"], "0.1012.0"],
    ["newer upstream minor", "0.2.0", [...PUBLISHED, "v0.1012.3"], "0.2000.0"],
    ["newer upstream major", "1.0.3", ["v0.2000.7"], "1.3.0"],
    ["prerelease on main maps to its core", "0.1.12-nightly.20261120.5009", [], "0.1012.0"],
  ])("%s", (_name, upstream, existing, expected) => {
    expect(nextForkVersion(upstream, existing)).toBe(expected);
  });

  it("orders every step above the last, including the hand-picked v0.1.14", () => {
    const sequence = [
      "0.1.14",
      "0.1010.0",
      "0.1011.0",
      "0.1011.1",
      "0.1012.0",
      "0.2000.0",
      "1.3.0",
    ];
    for (const [index, version] of sequence.entries()) {
      expect(version).toMatch(EXACT_ARCHIVE_VERSION);
      if (index > 0)
        expect(compareSemverVersions(version, sequence[index - 1]!)).toBeGreaterThan(0);
    }
  });

  it("refuses a version that would not sort above an existing one", () => {
    expect(() => nextForkVersion("0.1.11", ["v0.1012.0"])).toThrow(/would not sort above/u);
  });

  it("refuses an upstream patch the encoding cannot hold", () => {
    expect(() => nextForkVersion("0.1.1000", [])).toThrow(/does not fit/u);
  });
});

it("describes fork versions", () => {
  expect(describeForkVersion("0.1011.2")).toBe("upstream 0.1.11, fork build 2");
  expect(describeForkVersion("0.1.13")).toBeUndefined();
});
