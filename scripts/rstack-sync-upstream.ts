#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A git driver run by hand and by rstack-upstream-sync.yml.
// rstack-code: merges upstream T3 Code into the fork with fixed path rules, then gates the result.
// The scheduled workflow and a person finishing a merge by hand run this same file.
//
//   node scripts/rstack-sync-upstream.ts merge [--ref main] [--dry-run]   merge, apply rules, commit
//   node scripts/rstack-sync-upstream.ts continue                          after resolving conflicts
//   node scripts/rstack-sync-upstream.ts gate                              checks for the merge commit
//
// Path rules (see docs/operations/rstack-fork.md#upstream-sync):
//   .github/workflows/**   always the fork's version; upstream additions are never added
//   pnpm-lock.yaml         upstream's version, then regenerated
//   i18n catalogs          merged key by key, then en.json regenerated
//   mobile theme outputs   upstream's version, then regenerated
//   agentContextBudget     upstream's sizes plus the fork's growth, then checked by its test
// Any other conflict stops for a person.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export type PathRule =
  | "fork-workflow"
  | "lockfile"
  | "i18n-catalog"
  | "mobile-generated"
  | "context-budget";

const WORKFLOWS = ".github/workflows";
const I18N_CATALOG = /^apps\/(?:web|mobile|desktop)\/src\/i18n\/translations\/[^/]+\.json$/u;
// Files apps/mobile/scripts/generate-uniwind-themes.mts writes.
const MOBILE_GENERATED = new Set([
  "apps/mobile/generated-uniwind-themes.css",
  "apps/mobile/generated-uniwind-theme-names.json",
  "apps/mobile/generated-uniwind-default-theme-variables.json",
  "apps/mobile/clerk-theme.json",
]);
const CONTEXT_BUDGET = "apps/server/src/provider/agentContextBudget.json";
const CONTEXT_BUDGET_TEST = "apps/server/src/provider/AgentContextBudget.test.ts";

export function pathRule(file: string): PathRule | undefined {
  if (file.startsWith(`${WORKFLOWS}/`)) return "fork-workflow";
  if (file === "pnpm-lock.yaml") return "lockfile";
  if (I18N_CATALOG.test(file)) return "i18n-catalog";
  if (MOBILE_GENERATED.has(file)) return "mobile-generated";
  if (file === CONTEXT_BUDGET) return "context-budget";
  return undefined;
}

type Catalog = Record<string, unknown>;

/** Three-way merge of flat catalogs: a key changed on one side takes that side's value. */
export function mergeCatalogs(base: Catalog, ours: Catalog, theirs: Catalog) {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  const merged: Catalog = {};
  const conflicts: string[] = [];
  // Upstream's key order first, then keys only the fork has.
  const keys = [...new Set([...Object.keys(theirs), ...Object.keys(ours)])];
  for (const key of keys) {
    const inBase = Object.hasOwn(base, key);
    const inOurs = Object.hasOwn(ours, key);
    const inTheirs = Object.hasOwn(theirs, key);
    const oursChanged = inOurs !== inBase || (inOurs && !same(ours[key], base[key]));
    const theirsChanged = inTheirs !== inBase || (inTheirs && !same(theirs[key], base[key]));
    let pick: "ours" | "theirs";
    if (!oursChanged) pick = "theirs";
    else if (!theirsChanged) pick = "ours";
    else if (inOurs === inTheirs && (!inOurs || same(ours[key], theirs[key]))) pick = "theirs";
    else {
      conflicts.push(key);
      continue;
    }
    const side = pick === "ours" ? ours : theirs;
    if (Object.hasOwn(side, key)) merged[key] = side[key];
  }
  return { merged, conflicts };
}

/**
 * Byte counts of text both sides edited: when the text itself merged cleanly, the merged size is
 * upstream's plus the fork's growth. The budget test then confirms the exact values.
 */
export function mergeSizes(
  base: Record<string, number>,
  ours: Record<string, number>,
  theirs: Record<string, number>,
) {
  const merged: Record<string, number> = {};
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours)])) {
    merged[key] = (theirs[key] ?? base[key] ?? 0) + (ours[key] ?? 0) - (base[key] ?? 0);
  }
  return merged;
}

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
}

export interface SyncReport {
  status: "up-to-date" | "merged" | "conflicts" | "dry-run";
  upstreamRef: string;
  target: string;
  forkTip: string;
  mergeBase: string;
  commits: number;
  upstreamVersion: string;
  conflicts: Array<{ path: string; forkCommits: string[]; detail?: string }>;
  autoResolved: Array<{ path: string; rule: PathRule }>;
  workflowsKeptOut: { changed: string[]; added: string[] };
  mergeCommit?: string;
  checks?: CheckResult[];
}

const run = (command: string, args: ReadonlyArray<string>, allowFail = false) => {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
};
const git = (...args: string[]) => run("git", ["-c", "core.quotePath=false", ...args]).stdout;
const gitOk = (...args: string[]) => run("git", ["-c", "core.quotePath=false", ...args], true).ok;
const lines = (text: string) => text.split("\n").filter((line) => line.length > 0);
const short = (sha: string) => sha.slice(0, 10);

const vpBin = () => (NodeFS.existsSync("node_modules/.bin/vp") ? "node_modules/.bin/vp" : "vp");
const vp = (...args: string[]) => {
  console.log(`> vp ${args.join(" ")}`);
  const result = NodeChildProcess.spawnSync(vpBin(), args, { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status === 0;
};

const statePath = () => git("rev-parse", "--git-path", "rstack-sync.json");
const saveState = (report: SyncReport, reportPath?: string) => {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  NodeFS.writeFileSync(statePath(), text);
  if (reportPath) NodeFS.writeFileSync(reportPath, text);
};
const loadState = (): SyncReport => JSON.parse(NodeFS.readFileSync(statePath(), "utf8"));

const upstreamVersionAt = (rev: string) =>
  JSON.parse(git("show", `${rev}:apps/server/package.json`)).version as string;

const unmergedPaths = () => [...new Set(lines(git("diff", "--name-only", "--diff-filter=U")))];

/** Puts every workflow file back to the fork's version: kept, restored, or never added. */
function restoreForkWorkflows() {
  const inHead = new Set(lines(git("ls-tree", "-r", "--name-only", "HEAD", "--", WORKFLOWS)));
  const inIndex = new Set(lines(git("ls-files", "--", WORKFLOWS)));
  for (const file of new Set([...inHead, ...inIndex])) {
    if (inHead.has(file)) {
      git("checkout", "HEAD", "--", file);
    } else {
      git("rm", "--cached", "--force", "--quiet", "--", file);
      NodeFS.rmSync(file, { force: true });
    }
  }
  if (!gitOk("diff", "--cached", "--quiet", "HEAD", "--", WORKFLOWS)) {
    throw new Error(`Refusing to continue: the merge still changes ${WORKFLOWS}.`);
  }
}

function applyConflictRules(report: SyncReport) {
  for (const file of unmergedPaths()) {
    const rule = pathRule(file);
    if (rule === "fork-workflow") continue;
    if (rule === "lockfile" || rule === "mobile-generated") {
      if (!gitOk("checkout", "--theirs", "--", file)) continue;
      git("add", "--", file);
      report.autoResolved.push({ path: file, rule });
    } else if (rule === "i18n-catalog" || rule === "context-budget") {
      const stage = (n: number) => {
        const result = run("git", ["show", `:${n}:${file}`], true);
        return result.ok ? (JSON.parse(result.stdout) as Catalog) : undefined;
      };
      const [base, ours, theirs] = [stage(1), stage(2), stage(3)];
      if (!base || !ours || !theirs) continue;
      if (rule === "context-budget") {
        const sizes = (catalog: Catalog) => catalog as Record<string, number>;
        const merged = mergeSizes(sizes(base), sizes(ours), sizes(theirs));
        NodeFS.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
        git("add", "--", file);
        report.autoResolved.push({ path: file, rule });
        continue;
      }
      const { merged, conflicts } = mergeCatalogs(base, ours, theirs);
      if (conflicts.length > 0) {
        report.conflicts.push({
          path: file,
          forkCommits: [],
          detail: `keys changed on both sides: ${conflicts.slice(0, 20).join(", ")}`,
        });
        continue;
      }
      NodeFS.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
      git("add", "--", file);
      report.autoResolved.push({ path: file, rule });
    }
  }
}

function recordConflicts(report: SyncReport) {
  const detailed = new Map(report.conflicts.map((conflict) => [conflict.path, conflict.detail]));
  report.conflicts = unmergedPaths().map((file) => {
    const detail = detailed.get(file);
    return {
      path: file,
      forkCommits: lines(
        git("log", "--oneline", `${report.target}..${report.forkTip}`, "--", file),
      ),
      ...(detail ? { detail } : {}),
    };
  });
}

/** Rebuilds generated files from the merged sources instead of trusting either side's copy. */
function regenerate() {
  const steps: Array<[string, string[]]> = [
    ["lockfile", ["install", "--lockfile-only", "--ignore-scripts", "--no-frozen-lockfile"]],
    ["install", ["install", "--frozen-lockfile"]],
    ["web i18n", ["run", "--filter", "@t3tools/web", "i18n:generate"]],
    ["mobile i18n", ["run", "--filter", "@t3tools/mobile", "i18n:generate"]],
    ["desktop i18n", ["run", "--filter", "@t3tools/desktop", "i18n:generate"]],
    ["mobile themes", ["run", "--filter", "@t3tools/mobile", "generate"]],
  ];
  for (const [name, args] of steps) {
    if (!vp(...args)) throw new Error(`Regenerating ${name} failed.`);
  }
  const generated = lines(git("status", "--porcelain", "--untracked-files=all"))
    .map((line) => line.slice(3))
    .filter((file) => {
      const rule = pathRule(file);
      return rule === "i18n-catalog" || rule === "mobile-generated" || rule === "context-budget";
    });
  if (generated.length > 0 && !vp("fmt", "--no-error-on-unmatched-pattern", ...generated)) {
    throw new Error("Formatting generated files failed.");
  }
  git("add", "--all");
}

function commitMerge(report: SyncReport) {
  restoreForkWorkflows();
  regenerate();
  restoreForkWorkflows();
  git(
    "commit",
    "--quiet",
    "--no-verify",
    "-m",
    `:wrench: chore[upstream]: merge pingdotgg/t3code ${short(report.target)} (upstream ${report.upstreamVersion})`,
  );
  report.status = "merged";
  report.mergeCommit = git("rev-parse", "HEAD");
}

function merge(options: Options) {
  if (lines(git("status", "--porcelain", "--untracked-files=no")).length > 0) {
    throw new Error("The working tree has uncommitted changes.");
  }
  if (gitOk("rev-parse", "--verify", "--quiet", "MERGE_HEAD")) {
    throw new Error(
      "A merge is already in progress. Finish it with `continue` or run `git merge --abort`.",
    );
  }
  git("fetch", "--quiet", "--no-tags", options.remote, options.ref);
  const target = git("rev-parse", "FETCH_HEAD^{commit}");
  const forkTip = git("rev-parse", "HEAD");
  const mergeBase = git("merge-base", "HEAD", target);
  const report: SyncReport = {
    status: "up-to-date",
    upstreamRef: options.ref,
    target,
    forkTip,
    mergeBase,
    commits: Number(git("rev-list", "--count", `HEAD..${target}`)),
    upstreamVersion: upstreamVersionAt(target),
    conflicts: [],
    autoResolved: [],
    workflowsKeptOut: {
      changed: lines(
        git(
          "diff",
          "--name-only",
          "--no-renames",
          "--diff-filter=MD",
          mergeBase,
          target,
          "--",
          WORKFLOWS,
        ),
      ),
      added: lines(
        git(
          "diff",
          "--name-only",
          "--no-renames",
          "--diff-filter=A",
          mergeBase,
          target,
          "--",
          WORKFLOWS,
        ),
      ),
    },
  };
  if (report.commits === 0) {
    console.log(`Up to date with ${options.remote} ${options.ref} (${short(target)}).`);
    saveState(report, options.report);
    return report;
  }

  console.log(`Merging ${report.commits} upstream commits ${short(mergeBase)}..${short(target)}.`);
  run("git", ["merge", "--no-ff", "--no-commit", "--no-verify", target], true);
  if (!gitOk("rev-parse", "--verify", "--quiet", "MERGE_HEAD")) {
    throw new Error("git merge did not start; see its output above.");
  }
  restoreForkWorkflows();
  applyConflictRules(report);
  recordConflicts(report);

  if (options.dryRun) {
    report.status = report.conflicts.length > 0 ? "conflicts" : "dry-run";
    git("merge", "--abort");
  } else if (report.conflicts.length > 0) {
    report.status = "conflicts";
    if (options.onConflict === "commit") {
      // Only for the rstack-sync/<sha> branch: rules applied, real conflicts left with markers.
      git("add", "--all");
      git(
        "commit",
        "--quiet",
        "--no-verify",
        "-m",
        `rstack-sync: unresolved merge of ${short(target)}`,
      );
      report.mergeCommit = git("rev-parse", "HEAD");
    }
  } else {
    commitMerge(report);
  }
  saveState(report, options.report);
  printReport(report);
  return report;
}

function continueMerge(options: Options) {
  const report = loadState();
  if (!gitOk("rev-parse", "--verify", "--quiet", "MERGE_HEAD")) {
    throw new Error("No merge in progress. Start one with `merge`.");
  }
  if (unmergedPaths().length > 0) {
    recordConflicts(report);
    printReport(report);
    throw new Error("Resolve and `git add` the files above first.");
  }
  report.conflicts = [];
  commitMerge(report);
  saveState(report, options.report);
  printReport(report);
  return gate(options);
}

function gate(options: Options) {
  const report = loadState();
  // check:changed against the upstream commit covers exactly what the fork changes on top of it.
  const checks: Array<[string, string[]]> = [
    ["check:changed", ["run", "check:changed", report.target]],
    ["i18n:check", ["run", "i18n:check"]],
    ["agent context budget", ["test", "run", CONTEXT_BUDGET_TEST]],
  ];
  report.checks = checks.map(([name, args]) => ({ name, ok: vp(...args) }));
  saveState(report, options.report);
  const failed = report.checks.filter((check) => !check.ok).map((check) => check.name);
  console.log(failed.length === 0 ? "Gate passed." : `Gate failed: ${failed.join(", ")}.`);
  return failed.length === 0;
}

function printReport(report: SyncReport) {
  console.log(`\nStatus: ${report.status}`);
  for (const entry of report.autoResolved)
    console.log(`  resolved by rule (${entry.rule}): ${entry.path}`);
  if (report.workflowsKeptOut.added.length > 0) {
    console.log(`  upstream workflows not added: ${report.workflowsKeptOut.added.join(", ")}`);
  }
  for (const conflict of report.conflicts) {
    console.log(`  CONFLICT ${conflict.path}${conflict.detail ? ` (${conflict.detail})` : ""}`);
    for (const commit of conflict.forkCommits) console.log(`      ${commit}`);
  }
}

export function renderIssueBody(report: SyncReport, context: { runUrl: string; branch?: string }) {
  const range = `${short(report.mergeBase)}..${short(report.target)}`;
  const out = [
    `The scheduled upstream sync could not update \`main\`. Run: ${context.runUrl}`,
    "",
    `- Upstream range: \`${range}\` (${report.commits} commits, upstream version ${report.upstreamVersion})`,
    `- Fork tip: \`${short(report.forkTip)}\``,
  ];
  if (context.branch) out.push(`- Attempt pushed to \`${context.branch}\``);
  if (report.conflicts.length > 0) {
    out.push("", "### Conflicts", "");
    for (const conflict of report.conflicts) {
      out.push(`- \`${conflict.path}\`${conflict.detail ? ` (${conflict.detail})` : ""}`);
      for (const commit of conflict.forkCommits.slice(0, 10)) out.push(`  - ${commit}`);
    }
  }
  const failed = (report.checks ?? []).filter((check) => !check.ok);
  if (failed.length > 0) {
    out.push("", "### Failing checks", "");
    for (const check of failed) out.push(`- \`${check.name}\`: logs at ${context.runUrl}`);
  }
  out.push(
    "",
    "### Finish locally",
    "",
    "```bash",
    "git switch main && git pull --ff-only",
    "git remote get-url upstream || git remote add upstream https://github.com/pingdotgg/t3code.git",
    "vp i",
    `node scripts/rstack-sync-upstream.ts merge --ref ${report.target}`,
    "# resolve the files listed, git add them, then:",
    "node scripts/rstack-sync-upstream.ts continue",
    "git push origin HEAD:main",
    "```",
    "",
    "The next scheduled run after `main` contains this upstream commit closes this issue.",
  );
  return out.join("\n");
}

export function renderSummary(report: SyncReport, pushed: string) {
  const range = `\`${short(report.mergeBase)}..${short(report.target)}\``;
  if (report.status === "up-to-date") {
    return `### Upstream sync\n\nUp to date with upstream \`${report.upstreamRef}\` (\`${short(report.target)}\`). Nothing released.`;
  }
  const failed = (report.checks ?? []).filter((check) => !check.ok).map((check) => check.name);
  return [
    "### Upstream sync",
    "",
    `- Range: ${range}, ${report.commits} commits, upstream version ${report.upstreamVersion}`,
    `- Result: ${report.status}${failed.length > 0 ? `, failing checks: ${failed.join(", ")}` : ""}`,
    `- Resolved by rule: ${report.autoResolved.length}, conflicts: ${report.conflicts.length}`,
    `- Upstream workflows kept out: ${report.workflowsKeptOut.changed.length} changed, ${report.workflowsKeptOut.added.length} added`,
    `- Pushed: ${pushed}`,
  ].join("\n");
}

interface Options {
  readonly ref: string;
  readonly remote: string;
  readonly dryRun: boolean;
  readonly onConflict: "leave" | "commit";
  readonly report?: string;
}

function main(argv: ReadonlyArray<string>) {
  const [command = "", ...args] = argv;
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const reportOption = option("--report");
  const options: Options = {
    ref: option("--ref") ?? "main",
    remote: option("--remote") ?? "upstream",
    dryRun: args.includes("--dry-run"),
    onConflict: option("--on-conflict") === "commit" ? "commit" : "leave",
    ...(reportOption ? { report: NodePath.resolve(reportOption) } : {}),
  };
  switch (command) {
    case "merge": {
      const report = merge(options);
      return report.status !== "conflicts";
    }
    case "continue":
      return continueMerge(options);
    case "gate":
      return gate(options);
    case "issue-body":
    case "summary": {
      const report: SyncReport = JSON.parse(
        NodeFS.readFileSync(option("--from") ?? statePath(), "utf8"),
      );
      console.log(
        command === "summary"
          ? renderSummary(report, option("--pushed") ?? "no")
          : renderIssueBody(report, {
              runUrl: option("--run-url") ?? "",
              ...(option("--branch") ? { branch: option("--branch")! } : {}),
            }),
      );
      return true;
    }
    default:
      console.error(
        "Usage: rstack-sync-upstream.ts merge|continue|gate|issue-body|summary [options]",
      );
      return false;
  }
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)) ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
