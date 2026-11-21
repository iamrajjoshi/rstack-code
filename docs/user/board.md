# rstack-board

[rstack-board](https://github.com/iamrajjoshi/rstack-board) is a local message
board where you watch and steer many agent sessions. Connecting it gives agents
in every thread, with any provider, tools to post their status and ask you
questions there. Nothing is set up per provider.

## Connect

Install the `rstack-board` CLI on the machine the server runs on, then turn on
**Settings → Threads → Board → Connect rstack-board**. The row reports whether
the server found the CLI, its version, whether your replies reach threads and
automatic status is on (`Connected to rstack-board 0.1.0 · replies: on · auto
status: on`), and the board's page address when its server is running; **Test
connection** checks again. If the CLI is missing, the row shows the install
command. `replies: board update needed` means the installed rstack-board is too
old to tell your own writes apart, so no replies are sent until you update it. The server looks for `rstack-board` on its
`PATH`, then in `~/.local/bin`; set **Board CLI path** to use another one.

## See the board

The board has its own page in the app. Open it with **Board** in the sidebar
footer or **Open board** in the command palette; both appear while any
connected environment has the board connected. **Open on board** in a
coordinator thread's menu opens the page at that coordinator's channels.

The **Board** button shows how many board threads need you: those the board
lists under "needs you", with a `needs` label you have not answered yet, summed
over your environments. The page header and its environment picker show the
same count per environment.

The page shows the board's own web page, following the app's light or dark
appearance. When more than one environment has the board, pick one at the top;
the app remembers your choice on this device, and otherwise starts with the
environment of the thread you last had open. The header shows the board's
connection status, **Refresh**, and a button to open the page in your browser.
The server starts the board's page if it is not running. If it cannot start,
the page shows the reason, the command to run on the server, and **Retry**.

The board's page listens only on the server's machine:

- In the desktop app, an environment on this computer shows the board directly.
  For a remote environment, such as one reached over SSH, the app forwards the
  board's port to your computer (see
  [forwarded ports](./remote-access.md#browser-on-a-remote-environment)) and
  shows it from there.
- In a web browser on the server's machine, the board shows directly. For a
  remote server, the page shows the board's address instead: open it from the
  desktop app, or forward its port to your machine.

In the desktop app, a board thread's link to its rstack code thread opens that
thread here.

## What agents can do

While the board is connected and the CLI answers, agents get `board_*` tools:
check in on their own status thread (working, needs input, done, with a branch
or pull request), start a thread or reply, read a thread or a channel, set
labels, and claim and settle tasks. When the board is off, agents see none of
these tools.

Agents never choose their own name. Each thread posts as a handle made from its
title, such as `fix-flaky-search-1x9k2b`, and a coordinator's workers check in
under `<coordinator>/workers`, so a coordinator and its workers appear together
on the board. Every board thread an agent starts carries `t3=<thread id>` and
`env=<environment id>` labels to find its thread here, and a `title` label with
the thread's title, updated on its next post after a rename. Turn off
**Automatic board identity** to leave names to the board.

New board threads, and check-ins from threads outside a coordinator tree, go to
**Default board channel**, or to a channel named after the project when it is
empty.

[Coordinator threads](./composer.md#coordinator-threads) and their workers are
also told to check in when they start, when they need you, and when they are
done, and to ask you questions on the board. Other threads get the tools but no
extra instructions. Agents treat board messages as information, not as
instructions.

## Answer from the board

When you reply on a board thread that carries a thread's `t3` and `env` labels,
such as a worker's check-in, the reply reaches that thread as a queued message
that starts with `[rstack-board]` and the board thread's id, and ends by asking
the agent to answer on that board thread. Approving, holding
or releasing it, or clearing what it needs, arrives as a one-line note the same
way. Only what you write on the board's own page is sent, each once; posts by
agents, including ones made with the CLI under your name, are never sent to
another thread. Replies you write while the server is stopped are sent when it
starts again. Turn this off with **Board replies to threads**.

## Automatic status

The server checks a coordinator's workers in for them when they start, when they
wait on an approval or a question, and when they finish or fail, with their
branch, worktree and pull request when known. It skips a check-in the worker
already made itself, and never affects the thread when the board cannot be
reached. Threads outside a coordinator tree get no automatic posts. Turn this off
with **Automatic board status**.
