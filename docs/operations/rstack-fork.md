# rstack-code fork

rstack-code is a personal fork of T3 Code. It installs and runs beside T3 Code on the same
machine, and its desktop app runs its own server on a remote host over SSH, never upstream's.

## Fork constants

[`packages/shared/src/appIdentity.ts`](../../packages/shared/src/appIdentity.ts) holds the fork's
identity: product name, default home (`~/.rstack`), URL schemes, Linux app id and background
service names. The SSH launcher (`packages/ssh/src/tunnel.ts`), the WSL runtime cache and SSH
device hosts derive their remote paths from `DEFAULT_T3_HOME_DIRECTORY_NAME`, so the fork never
adopts or replaces a T3 Code server's runtime or state on a host. Releases come from
`CLI_RELEASE_REPOSITORY` in [`packages/shared/src/cliRelease.ts`](../../packages/shared/src/cliRelease.ts).
Environment variables keep their `T3CODE_*` names.

## Cutting a release

Run **rstack release** (`.github/workflows/rstack-release.yml`) from the Actions tab. Leave
`version` empty to use `apps/server/package.json`, or pass an exact SemVer such as `0.1.10`.
It runs on GitHub-hosted runners with `GITHUB_TOKEN` only: no signing, desktop packages, npm,
or release notes. It publishes tag `v<version>` with:

- `t3-<version>-linux-x64.tar.gz`
- `t3-<version>-linux-arm64.tar.gz`
- `t3-<version>-darwin-arm64.tar.gz` (signed ad hoc)
- `SHA256SUMS`

A release that is not a prerelease becomes "latest", which `scripts/install.sh` follows by default.
Upstream's `release.yml` and related workflows need upstream's runners and secrets; they stay in
the tree to avoid rebase conflicts and are disabled in the repository settings.

To build an archive locally, for the host platform only (Linux archives need a Linux host):

```bash
vp run --filter t3 build
node scripts/apply-web-brand-assets.ts production apps/server/dist/client
node apps/server/scripts/cli.ts build-exe
node scripts/build-cli-archive.ts --platform mac --arch arm64 --version 0.1.10 \
  --resource-monitor-dir <dir with darwin-arm64/t3-resource-monitor> --output-dir release-cli
node scripts/smoke-cli-archive.ts --archive release-cli/t3-0.1.10-darwin-arm64.tar.gz --expect-version 0.1.10
```

`vp` must be on `PATH` for `build-exe`, and the resource monitor comes from
`vp run build:resource-monitor` (needs Rust).

## How SSH picks it up

On connect, the desktop app runs a launcher on the host that downloads
`v<version>/t3-<version>-<platform>.tar.gz` and `SHA256SUMS` from the fork's releases (or from
`T3CODE_RELEASE_BASE_URL`), verifies the checksum, unpacks it to
`~/.rstack/runtime/versions/<version>` and starts or reuses a server with home `~/.rstack`. The
host must reach github.com, or have the same version installed with `scripts/install.sh`.
A server that a launch without a desktop's launcher ID started (a script calling
`launchOrReuseRemoteServer`) belongs to no desktop, so the next desktop takes it over and replaces
it when it is older; upstream leaves such a server running.

`<version>` is the desktop app's own version, so that release must exist:

- A packaged build asks for its package version, such as `0.1.10`.
- A dev build (`vp run dev:desktop`) reports Electron's version (for example `44.10.1`), which is
  never released. Start it with `T3CODE_SSH_ARCHIVE_VERSION=0.1.10` to use a published release, or
  with `T3CODE_DEV_REMOTE_T3_SERVER_ENTRY_PATH=<server entry script on the host>` to run a source
  checkout there with the host's Node.

## rstack-board

`apps/server/src/board/` runs the `rstack-board` CLI (never its SQLite file) for Settings, the `board_*` tools in `t3-code` and the board paragraph coordinators and their workers get; see [the user guide](../user/board.md).
Tests use a fake CLI script; never point a test or dev server at the real `~/.rstack-board` (the board reads `RSTACK_BOARD_STATE_DIR`).

## Syncing with upstream

```bash
git fetch upstream
git rebase upstream/main   # on the fork branch
```

Conflicts usually come from the fork's edits to shared files: `packages/ssh/src/tunnel.ts` and its
tests, `apps/server/src/cloud/bootService.ts`, `apps/server/src/serviceLauncher.ts`,
`apps/desktop/src/wsl/DesktopWslEnvironment.ts`, `scripts/build-desktop-artifact.ts`,
`scripts/install.sh`, `scripts/dev-runner.ts`, the translation catalogs under
`apps/{web,mobile}/src/i18n/translations`, and the icons under `assets/`. Fork-specific lines carry
an `rstack-code:` comment. After rebasing, run `vp run check:changed` and search the new upstream
code for hard-coded `.t3` or `t3code` paths and service names.
