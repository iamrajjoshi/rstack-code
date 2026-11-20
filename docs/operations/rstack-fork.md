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

The upstream sync releases every merge it pushes (see [Upstream sync](#upstream-sync)). To release
by hand, run **rstack release** (`.github/workflows/rstack-release.yml`) from the Actions tab.
Leave `version` empty to get the next [fork version](#versions). It runs on GitHub-hosted runners
with `GITHUB_TOKEN` only: no npm or release notes. It publishes tag `v<version>` with:

- `t3-<version>-linux-x64.tar.gz`
- `t3-<version>-linux-arm64.tar.gz`
- `t3-<version>-darwin-arm64.tar.gz` (signed ad hoc)
- `SHA256SUMS`
- with `desktop` on (always on for sync releases): `T3-Code-<version>-arm64.dmg`, the `.zip`,
  their `.blockmap`s and `latest-mac.yml`, the app's update feed. Signed and notarized when the
  [signing secrets](#macos-signing) exist, ad hoc otherwise.

A release that is not a prerelease becomes "latest", which `scripts/install.sh` and the desktop
updater follow. Upstream's `release.yml` and related workflows need upstream's runners and
secrets; they stay in the tree and are disabled in the repository settings.

### Versions

Upstream publishes plain `X.Y.Z`, so the fork cannot reuse its numbers, and a suffix does not work
either: `0.1.11-rstack.1` sorts below `0.1.11` and below the hand-picked `0.1.14` already
installed, and build metadata (`+rstack.1`) is ignored in comparisons and rejected by the SSH
launcher. [`scripts/rstack-version.ts`](../../scripts/rstack-version.ts) instead maps upstream
`M.m.p` and fork build `n` to `M.(m*1000+p).n`, taking `n` one past the highest tag on that line:

| Upstream (`apps/server/package.json`) | Existing tags            | Next       |
| ------------------------------------- | ------------------------ | ---------- |
| `0.1.11`                              | `v0.1.10` … `v0.1.14`    | `0.1011.0` |
| `0.1.11`                              | `v0.1011.0`, `v0.1011.1` | `0.1011.2` |
| `0.2.0`                               | `v0.1012.3`              | `0.2000.0` |

Every result is a plain SemVer that the SSH launcher, `packages/shared/src/semver.ts`,
electron-builder and `latest-mac.yml` accept, and it sorts above every earlier one, so a newer
desktop always replaces an older managed server. The script refuses a version that would not sort
above every existing tag.

### macOS signing

The desktop job reuses upstream's inputs. Without all of them it builds ad hoc, never failing the
release. With them, `scripts/build-desktop-artifact.ts --signed` signs with the Developer ID
certificate (hardened runtime, entitlements generated from the provisioning profile) and
electron-builder notarizes with the App Store Connect API key, which needs no Apple ID password or
two-factor prompt.

That script requires a provisioning profile for any signed macOS build, because it always writes
the passkey Associated Domains entitlement. In the Apple Developer portal:

1. Identifiers: register the explicit App ID `com.iamrajjoshi.rstackcode` with the Associated
   Domains capability.
2. Certificates: a **Developer ID Application** certificate, installed in your login keychain.
3. Profiles: a **Developer ID** provisioning profile for that App ID and certificate.
4. App Store Connect, Users and Access, Integrations: an API key with Developer access. Download
   `AuthKey_<KEY ID>.p8` (only offered once) and note the Issuer ID.

`CLERK_PASSKEY_RP_DOMAINS` is a domain you control, written as `webcredentials:<domain>`. In-app
browser passkeys only work when that domain serves an `apple-app-site-association` naming
`<TEAM ID>.com.iamrajjoshi.rstackcode`; signing works either way.

Export the certificate: Keychain Access, login keychain, My Certificates, expand
"Developer ID Application: … (<TEAM ID>)" so its private key is included, Export, `.p12`, with a
password. Then write each value to a file and set it. Never paste a value on the command line:

```bash
base64 -i developer-id.p12 -o developer-id.p12.b64
base64 -i rstack.provisionprofile -o rstack.provisionprofile.b64
R=iamrajjoshi/rstack-code
gh secret set CSC_LINK --repo "$R" < developer-id.p12.b64
gh secret set CSC_KEY_PASSWORD --repo "$R" < p12-password.txt
gh secret set APPLE_API_KEY --repo "$R" < AuthKey_KEYID.p8
gh secret set APPLE_API_KEY_ID --repo "$R" < api-key-id.txt
gh secret set APPLE_API_ISSUER --repo "$R" < api-issuer-id.txt
gh secret set MACOS_PROVISIONING_PROFILE --repo "$R" < rstack.provisionprofile.b64
gh variable set APPLE_TEAM_ID --repo "$R" < team-id.txt
gh variable set CLERK_PASSKEY_RP_DOMAINS --repo "$R" < rp-domain.txt
rm developer-id.p12.b64 p12-password.txt api-key-id.txt api-issuer-id.txt
```

`APPLE_TEAM_ID` and `CLERK_PASSKEY_RP_DOMAINS` are repository variables, as upstream has them.
The CLI archives stay ad hoc.

For a local signed build with the certificate already in your login keychain:

```bash
export T3CODE_DESKTOP_SIGNED=true
export CSC_NAME="Developer ID Application: <Name> (<TEAM ID>)"
export APPLE_API_KEY=~/keys/AuthKey_<KEY ID>.p8 APPLE_API_KEY_ID=<KEY ID> APPLE_API_ISSUER=<Issuer ID>
export T3CODE_APPLE_TEAM_ID=<TEAM ID> T3CODE_MACOS_PROVISIONING_PROFILE=~/keys/rstack.provisionprofile
export T3CODE_CLERK_PASSKEY_RP_DOMAINS=<domain>
node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --build-version <released version>
```

Build a version that is already released: the desktop asks hosts for the server archive of exactly
its own version.

### Desktop updates

The app's updater (electron-updater) reads `latest-mac.yml` from the latest release and hands the
`.zip` to Squirrel.Mac, which installs it only if the new app satisfies the running app's code
signing designated requirement (`Squirrel.framework`: "Code signature at URL … did not pass
validation"):

- An ad hoc app's requirement is its own code hash, which no other build matches. It shows the
  update but cannot install it.
- A Developer ID app's requirement is its bundle id and team, which every later signed build
  matches, so signed releases install themselves.
- The first signed release cannot replace an ad hoc install for the same reason: install it once
  by hand. macOS may ask again for permissions such as camera or screen recording.

To install a release by hand (quit the app first):

```bash
v=0.1011.0 d="$(mktemp -d)"; gh release download "v$v" --repo iamrajjoshi/rstack-code --pattern '*.dmg' --dir "$d" && hdiutil attach -nobrowse -quiet -mountpoint "$d/mnt" "$d"/*.dmg && ditto "$d"/mnt/*.app "/Applications/rstack code (Beta).app" && hdiutil detach -quiet "$d/mnt"
```

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

`apps/server/src/board/` runs the `rstack-board` CLI (never its SQLite file) for Settings, the `board_*` tools in `t3-code`, the board paragraph coordinators and their workers get, the reply reactor (follows `tail --json`; forwards only the person's writes, deduped by command receipts keyed on the board message id) and the worker status reactor; see [the user guide](../user/board.md).
Tests use a fake CLI script; never point a test or dev server at the real `~/.rstack-board` (the board reads `RSTACK_BOARD_STATE_DIR`).

<<<<<<< ours

## Claude desktop session trees

`t3 claude-sessions` (`apps/server/src/cli/claudeSessions.ts`) exports the Claude desktop app's
session metadata to a manifest on the Mac and applies it on the server through the internal
`thread.lineage.set` command plus the usual metadata and unsettle commands; see
[the user guide](../user/welcome-page.md#claude-desktop-app-session-trees). Tests use synthetic
fixtures; never commit real desktop metadata.

## Syncing with upstream

||||||| base

## Syncing with upstream

=======

## Upstream sync

**rstack upstream sync** (`.github/workflows/rstack-upstream-sync.yml`) runs every 6 hours and on
demand (inputs: upstream `ref`, `dry_run`, `release`). When `main` already contains upstream it
stops after the fetch. Otherwise it runs
[`scripts/rstack-sync-upstream.ts`](../../scripts/rstack-sync-upstream.ts), which you also run
locally:

1. **Merge, never rebase.** `main` is shared and released, so it is never force-pushed. A merge
   keeps fork commits as they are, and each sync only resolves what changed since the last one.
2. **Path rules.** `.github/workflows/**` always keeps the fork's version, and new upstream
   workflow files are never added, so nothing upstream adds can become an active workflow and the
   merge never changes workflow files. Other upstream automation (`.github/actions`,
   `.github/scripts`) is taken, since `rstack-release.yml` and `check:changed` use it.
   `pnpm-lock.yaml` takes upstream's copy and is regenerated (`vp install --lockfile-only`). The
   i18n catalogs merge key by key and `i18n:generate` rewrites each `en.json`. The mobile theme
   outputs are regenerated (`vp run --filter @t3tools/mobile generate`).
   `agentContextBudget.json` takes upstream's sizes plus the fork's growth, and its test confirms
   them. Any other conflict stops the run.
3. **Gate.** `vp run check:changed <upstream commit>` (format, lint, knip, typecheck of affected
   packages and their dependents, and the tests beside every file the fork changes), plus
   `i18n:check` and the agent context budget test. `icons:check` needs macOS tools and is left out.
4. **Push and release.** Only when the gate passes: a fast-forward push to `main` (and to
   `raj--rstack--fork-setup` while it still equals the old `main`), then **rstack release** with
   the desktop app at the next fork version.

When the merge conflicts or the gate fails, `main` stays as it was. The attempt goes to
`rstack-sync/<upstream sha>` (for conflicts, the merge with the rules applied and the remaining
conflict markers committed; never merge that branch), and one open issue, **Upstream sync needs
attention** (label `rstack-sync`), lists the range, each conflicted file with the fork commits
that touch it, failing checks, and the commands to finish. Later runs update that issue, and the
first sync that succeeds closes it. To finish by hand:

> > > > > > > theirs

```bash
git switch main && git pull --ff-only
node scripts/rstack-sync-upstream.ts merge --ref <upstream sha>   # same rules; stops at real conflicts
# resolve and git add the listed files
node scripts/rstack-sync-upstream.ts continue                    # regenerates, commits, runs the gate
git push origin HEAD:main
```

The next scheduled run releases it. Fork-specific lines carry an `rstack-code:` comment; after a
hand merge, search new upstream code for hard-coded `.t3` or `t3code` paths and service names.

Repository settings: Actions enabled; Settings, Actions, General, Workflow permissions set to
**Read and write**. The run opens issues, not pull requests, so "Allow GitHub Actions to create
and approve pull requests" can stay off. Keep `rstack-upstream-sync.yml` and `rstack-release.yml`
enabled and upstream's workflows disabled.

GitHub may refuse a `GITHUB_TOKEN` push whose new upstream commits change workflow files, even
though the merge result does not. If a run fails at **Push main** with a `workflows` permission
error, add a fine-grained token for this repository only, with Contents and Workflows write, as
secret `RSTACK_SYNC_TOKEN` (`gh secret set RSTACK_SYNC_TOKEN --repo iamrajjoshi/rstack-code <
token.txt`); the checkout uses it when present.

GitHub disables a schedule after 60 days without repository activity. Successful syncs push to
`main` several times a week, so this only happens while the attention issue sits unresolved; the
run warns after 45 days without a change to `main`. GitHub emails before disabling it, and
`gh workflow enable rstack-upstream-sync.yml --repo iamrajjoshi/rstack-code` turns it back on.
