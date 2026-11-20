#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Runs in a release preflight with no workspace install.
// rstack-code: the fork's release version. Upstream T3 Code publishes plain X.Y.Z, so the fork
// encodes upstream's version and a fork build counter in a plain X.Y.Z of its own:
//
//   upstream M.m.p, fork build n  ->  M.(m*1000 + p).n     e.g. 0.1.11 build 2 -> 0.1011.2
//
// A suffix cannot work: `-rstack.n` sorts below the release it names (and below the fork's
// earlier hand-picked 0.1.14), and `+rstack.n` is ignored when versions compare and rejected by the SSH
// launcher. See docs/operations/rstack-fork.md#versions.
//
//   node scripts/rstack-version.ts                  next version for apps/server/package.json
//   node scripts/rstack-version.ts --upstream 0.1.11 --remote origin
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const PLAIN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const PATCH_LIMIT = 1000;

interface Plain {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function parsePlainVersion(value: string): Plain | undefined {
  const match = PLAIN.exec(value.trim().replace(/^v/u, ""));
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

const compare = (left: Plain, right: Plain) =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch;

const format = (version: Plain) => `${version.major}.${version.minor}.${version.patch}`;

/** The fork version line (major and minor) that a given upstream version maps to. */
export function forkLine(upstreamVersion: string): {
  readonly major: number;
  readonly minor: number;
} {
  // Main carries the last stable version; a prerelease there maps to its core version.
  const upstream = parsePlainVersion(upstreamVersion.trim().replace(/[-+].*$/u, ""));
  if (!upstream) throw new Error(`Upstream version '${upstreamVersion}' is not X.Y.Z.`);
  if (upstream.patch >= PATCH_LIMIT) {
    throw new Error(`Upstream patch ${upstream.patch} does not fit the fork's minor encoding.`);
  }
  return { major: upstream.major, minor: upstream.minor * PATCH_LIMIT + upstream.patch };
}

/**
 * The next fork version for an upstream version, given every version already tagged. Fails
 * rather than return a version that does not sort above all of them, since a newer desktop
 * replaces an older managed server and never the reverse.
 */
export function nextForkVersion(upstreamVersion: string, existing: Iterable<string>): string {
  const line = forkLine(upstreamVersion);
  const taken = [...existing].flatMap((value) => {
    const parsed = parsePlainVersion(value);
    return parsed ? [parsed] : [];
  });
  const build = taken
    .filter((version) => version.major === line.major && version.minor === line.minor)
    .reduce((highest, version) => Math.max(highest, version.patch + 1), 0);
  const next = { ...line, patch: build };
  const highest = taken.reduce<Plain | undefined>(
    (max, version) => (!max || compare(version, max) > 0 ? version : max),
    undefined,
  );
  if (highest && compare(next, highest) <= 0) {
    throw new Error(
      `Next fork version ${format(next)} would not sort above existing v${format(highest)}.`,
    );
  }
  return format(next);
}

/** Reads `upstream M.m.p, fork build n` back out of a fork version. */
export function describeForkVersion(version: string): string | undefined {
  const parsed = parsePlainVersion(version);
  if (!parsed || parsed.minor < PATCH_LIMIT) return undefined;
  const minor = Math.floor(parsed.minor / PATCH_LIMIT);
  const patch = parsed.minor % PATCH_LIMIT;
  return `upstream ${parsed.major}.${minor}.${patch}, fork build ${parsed.patch}`;
}

function remoteTags(remote: string): string[] {
  const output = NodeChildProcess.execFileSync(
    "git",
    ["ls-remote", "--tags", "--refs", remote, "refs/tags/v*"],
    { encoding: "utf8" },
  );
  return output
    .split("\n")
    .map((line) => line.split("\trefs/tags/")[1]?.trim() ?? "")
    .filter((tag) => tag.length > 0);
}

function main(args: ReadonlyArray<string>) {
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const upstream =
    option("--upstream") ??
    JSON.parse(
      NodeFS.readFileSync(
        NodePath.resolve(option("--root") ?? ".", "apps/server/package.json"),
        "utf8",
      ),
    ).version;
  console.log(nextForkVersion(upstream, remoteTags(option("--remote") ?? "origin")));
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
