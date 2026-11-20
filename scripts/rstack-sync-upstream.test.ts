// @effect-diagnostics nodeBuiltinImport:off - Drives the sync script against a throwaway git repository.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { mergeCatalogs, mergeSizes, pathRule, type SyncReport } from "./rstack-sync-upstream.ts";

const SCRIPT = NodePath.join(import.meta.dirname, "rstack-sync-upstream.ts");

it.each([
  [".github/workflows/ci.yml", "fork-workflow"],
  [".github/workflows/rstack-release.yml", "fork-workflow"],
  [".github/actions/setup-ci-deps/action.yml", undefined],
  [".github/scripts/ci-changes.cjs", undefined],
  ["pnpm-lock.yaml", "lockfile"],
  ["apps/web/src/i18n/translations/pt-BR.json", "i18n-catalog"],
  ["apps/desktop/src/i18n/translations/en.json", "i18n-catalog"],
  ["apps/web/src/i18n/messages.ts", undefined],
  ["apps/mobile/generated-uniwind-themes.css", "mobile-generated"],
  ["apps/mobile/uniwind-types.d.ts", undefined],
  ["apps/server/src/provider/agentContextBudget.json", "context-budget"],
  ["apps/server/src/orchestration-v2/Orchestrator.ts", undefined],
])("pathRule(%s) is %s", (file, rule) => {
  expect(pathRule(file)).toBe(rule);
});

describe("mergeCatalogs", () => {
  it("keeps both sides' additions and upstream's removals", () => {
    const base = { a: "A", gone: "G", edited: "E" };
    const ours = { a: "A", gone: "G", edited: "E", fork: "F" };
    const theirs = { a: "A", edited: "E2", upstream: "U" };
    expect(mergeCatalogs(base, ours, theirs)).toEqual({
      merged: { a: "A", edited: "E2", upstream: "U", fork: "F" },
      conflicts: [],
    });
  });

  it("reports a key both sides changed differently", () => {
    const result = mergeCatalogs({ k: "x" }, { k: "fork" }, { k: "upstream" });
    expect(result.conflicts).toEqual(["k"]);
  });

  it("accepts the same change on both sides, including JSX entries", () => {
    const jsx = [{ c: "Hi" }];
    expect(mergeCatalogs({}, { k: jsx }, { k: [{ c: "Hi" }] })).toEqual({
      merged: { k: jsx },
      conflicts: [],
    });
  });
});

it("adds the fork's growth to upstream's measured sizes", () => {
  expect(mergeSizes({ a: 100, b: 10 }, { a: 130, b: 10, c: 5 }, { a: 90, b: 12 })).toEqual({
    a: 120,
    b: 12,
    c: 5,
  });
});

const sh = (cwd: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const write = (cwd: string, file: string, content: string) => {
  NodeFS.mkdirSync(NodePath.dirname(NodePath.join(cwd, file)), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(cwd, file), content);
};
const catalog = (entries: Record<string, string>) => `${JSON.stringify(entries, null, 2)}\n`;
const CATALOG = "apps/web/src/i18n/translations/de.json";

it("applies the path rules and leaves only real conflicts", () => {
  const repo = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "rstack-sync-"));
  try {
    sh(repo, "init", "--quiet", "--initial-branch=main");
    sh(repo, "config", "user.email", "test@example.com");
    sh(repo, "config", "user.name", "test");
    write(repo, ".github/workflows/ci.yml", "base\n");
    write(repo, ".github/workflows/old.yml", "base\n");
    write(repo, ".github/actions/setup/action.yml", "base\n");
    write(repo, "apps/server/package.json", '{ "version": "0.1.10" }\n');
    write(repo, "pnpm-lock.yaml", "base\n");
    write(repo, CATALOG, catalog({ a: "A" }));
    write(repo, "src.ts", "base\n");
    sh(repo, "add", "--all");
    sh(repo, "commit", "--quiet", "-m", "base");

    sh(repo, "switch", "--quiet", "-c", "upstream");
    write(repo, ".github/workflows/ci.yml", "upstream\n");
    NodeFS.rmSync(NodePath.join(repo, ".github/workflows/old.yml"));
    write(repo, ".github/workflows/new.yml", "upstream\n");
    write(repo, ".github/actions/setup/action.yml", "upstream\n");
    write(repo, "apps/server/package.json", '{ "version": "0.1.11" }\n');
    write(repo, "pnpm-lock.yaml", "upstream\n");
    write(repo, CATALOG, catalog({ a: "A", u: "U" }));
    write(repo, "src.ts", "upstream\n");
    sh(repo, "add", "--all");
    sh(repo, "commit", "--quiet", "-m", "upstream");

    sh(repo, "switch", "--quiet", "main");
    write(repo, ".github/workflows/rstack-release.yml", "fork\n");
    write(repo, "pnpm-lock.yaml", "fork\n");
    write(repo, CATALOG, catalog({ a: "A", f: "F" }));
    write(repo, "src.ts", "fork\n");
    sh(repo, "add", "--all");
    sh(repo, "commit", "--quiet", "-m", "fork");
    const forkTip = sh(repo, "rev-parse", "HEAD");

    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [SCRIPT, "merge", "--remote", ".", "--ref", "upstream", "--on-conflict", "commit"],
      { cwd: repo, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(1);
    const report: SyncReport = JSON.parse(
      NodeFS.readFileSync(NodePath.join(repo, ".git/rstack-sync.json"), "utf8"),
    );

    expect(report.status).toBe("conflicts");
    expect(report.upstreamVersion).toBe("0.1.11");
    expect(report.conflicts).toEqual([
      { path: "src.ts", forkCommits: [expect.stringMatching(/ fork$/u)] },
    ]);
    expect(report.autoResolved).toEqual([
      { path: CATALOG, rule: "i18n-catalog" },
      { path: "pnpm-lock.yaml", rule: "lockfile" },
    ]);
    expect(report.workflowsKeptOut).toEqual({
      changed: [".github/workflows/ci.yml", ".github/workflows/old.yml"],
      added: [".github/workflows/new.yml"],
    });

    // The committed attempt never changes a workflow file, and takes upstream's other automation.
    expect(sh(repo, "diff", "--name-only", forkTip, "HEAD", "--", ".github/workflows")).toBe("");
    expect(sh(repo, "show", "HEAD:.github/actions/setup/action.yml")).toBe("upstream");
    expect(sh(repo, "show", "HEAD:pnpm-lock.yaml")).toBe("upstream");
    expect(JSON.parse(sh(repo, "show", `HEAD:${CATALOG}`))).toEqual({ a: "A", u: "U", f: "F" });
    expect(sh(repo, "show", "HEAD:src.ts")).toContain("<<<<<<<");
  } finally {
    NodeFS.rmSync(repo, { recursive: true, force: true });
  }
});
