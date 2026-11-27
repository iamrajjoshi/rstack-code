# Triage an issue

Let your own coding agent investigate a T3 Code problem—reading local logs/state, inspecting the source for your installed version, checking known issues, and helping draft a GitHub issue. The agent always asks before applying fixes or posting anything.

## In the app

Open the command palette (`Cmd/Ctrl+K`) and run **Triage an issue**. A no-project thread opens on the active machine with the triage playbook attached—pick any provider, describe the problem, and send.

## In a terminal

If the app won't start or in-app triage fails, run:

```sh
<<<<<<< HEAD
t3 triage
```

It starts Claude Code, Codex, or Antigravity in your terminal with the same
instructions. If more than one is installed, it asks which to use. You can also
choose explicitly:

```sh
t3 triage --agent antigravity
t3 triage --agent codex
=======
npx t3 triage
# Or choose a specific CLI agent and model:
npx t3 triage --agent codex --model <model-id>
npx t3 triage --agent antigravity
>>>>>>> 186f6aac5740f2662e6fa2e2d4a66ad39caa6410
```

Supports Claude Code, Codex, and standalone Antigravity (`agy` on `PATH` with its own sign-in; T3's managed ACP runtime does not include the standalone terminal CLI).
