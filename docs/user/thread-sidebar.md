# Working with threads

Use a separate thread for each task. Choose **New worktree** when a task needs its own Git branch and working directory; threads sharing a checkout share its branch, so T3 Code blocks branch switches while one is running.

## Start a thread

- **Web and desktop**: **New thread** opens the project picker when you have multiple open projects (unless the sidebar is filtered to one project). `Shift`-click to start in the current project. To reuse an existing worktree, choose **New thread in this worktree** from the branch toolbar.
- **Mobile**: **New thread** uses the current, filtered, or last-opened project. Disable **Settings → General → Use last project** to pick every time.
- **Defaults**: New threads inherit your last model and mode unless the project sets its own model default.

### Start without a project

Threads don't require a project. Pick **No project** (or press `mod+alt+n` on web/desktop) to start a scratch thread in `~/.t3/scratch/<date>-<slug>-<id>`.

- Deleting a scratch thread leaves its folder on disk.
- Git branch, worktree, and diff controls are hidden (and scratch threads are unavailable if your T3 data directory itself is inside a Git repo).
- Choose **Turn into project** from the thread menu to promote the folder into a real project in place, then **Initialize Git** if needed.

### Start in the background and multi-model runs

- **Background start** (web/desktop): Press `Cmd+Enter` (macOS) or `Ctrl+Enter` (Windows/Linux) in a new thread to submit it and immediately open another draft with the same workspace mode and base branch.
- **Same prompt, multiple models** (web/desktop, Git projects): `Shift`-click models in a new thread's model picker to select several. Sending starts a separate thread and worktree for each model.

## Sidebar layout and organization

- **Resize or hide** (web/desktop): Drag the sidebar's right edge past its minimum width to hide it; hover the left window edge and click or drag the handle to bring it back.
- **Drop files onto a thread** (web/desktop): Drag files from your computer onto any thread row to open it and attach them to its composer.
- **Pin and reorder**: Pin a thread from its menu (on web and desktop, also from the pin button that appears when you hover or focus its card), or drag threads between **Pinned**, **Active**, and **Settled** (or drag out of **Snoozed** to wake). On mobile, use **Arrange threads** or **Move up / Move down** in the thread menu. Custom order syncs across devices (requires an up-to-date server).
- **Undo** (web/desktop): Unpinning, settling, snoozing, archiving, or discarding a draft shows a 5-second **Undo** toast (`mod+z`).
- **Titles**: Choose **Regenerate title** from a thread's menu, or customize title style in **Settings → Threads → Text generation → Thread title instructions** (global or per-project).

### Working section (beta)

Enabled by default (**Settings → General → Working section**, per device). Unpinned threads that are actively running—or waiting on subagents, watched PRs, or monitors—collapse into a **Working** section below Active, and return to the top of Active when they finish, fail, or need input.

While enabled, Active is sorted by most recent return (manual reordering is paused until you turn it off).

### Group threads by project (beta)

Enable **Settings → Labs → Boring sidebar (group by project)** on web/desktop (per device) to group active threads into collapsible project folders. Pinned threads stay above; Snoozed and Settled stay below. In this mode, the Working section and sidebar drag-reordering are disabled (dragging a thread onto the composer still works).

<<<<<<< HEAD
### Coordinators and threads

On web and desktop, a [coordinator thread](./composer.md#coordinator-threads) shows the
coordinator icon on its row. While at least one coordinator is in the active list, the list
splits into **Coordinators** above **Threads**, each in its usual order. Click a group's header
to fold it; the sidebar remembers each group's state. Use the pen button on **Coordinators** to
start a draft that is already a coordinator. Turning the role on or off moves the thread between
the groups. Drag reorders a thread within its own group. Pinned, Working, Snoozed, and Settled
keep their places and hold both kinds. Worker threads stay nested under their coordinator. With
the project-grouped sidebar, coordinators come first in each folder instead. Turn the groups off
with **Settings → General → Group coordinators**. Each device keeps its own choice.

### Sections

On web and desktop, make your own sections to organize threads. Use the **New section** button
next to the sidebar's filter, or **Move to section → New section…** in a thread's menu. A new
section starts in rename mode; type a name and press Enter.

Sections sit below Pinned and above Coordinators and Threads, in your order. Drag a thread under a
section's header to move it in, or use **Move to section** in its menu; drop it under **Threads**
or choose **Remove from section** to take it out. Drag within a section to reorder it. Click a
header to fold it; a folded section shows its count and a dot when a thread inside needs you.
Right-click a header to rename, move it up or down, or delete it. Drag a header to reorder
sections. Deleting a section moves its threads back to **Threads** and asks first if it has any.

A thread remembers its section while it is pinned, working, snoozed, or settled, and shows in
those places as usual; it returns to its section when it comes back to the active list. A
coordinator keeps its workers nested under it inside a section. Sections and their threads are
saved on each machine and appear on your other devices. With threads from several machines, a
section shows them all; moving a thread into a section adds that section to the thread's machine.
Folding is kept per device. The project-grouped sidebar and the mobile app show threads in their
usual places and keep their sections for later.

## Settle finished work
=======
## Settle, snooze, and archive
>>>>>>> 7fa73d3ef339fb88b4a4f59bd710b43e2cbaff1a

| Action      | When to use          | Effect                                                                                                                                         |
| ----------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Settle**  | Task is done for now | Moves to **Settled**; stays searchable; any new message reactivates it. Closes idle terminals (and stops actions with `stopOnSettle: true`).   |
| **Snooze**  | Defer until later    | Hides until wake time (thread keeps working in the background). Wakes early on approvals, questions, errors, or new messages.                  |
| **Archive** | Out of the way       | Leaves sidebar and search; lives in **Settings → Archive**. Refuses new messages (including from agents and scheduled tasks) until unarchived. |

> Tip: If a scheduled task targets a thread, settle it instead of archiving—archiving causes scheduled runs to fail.

### Settlement rules and hooks

- **Automatic settlement**: By default, environments settle threads after 7 days of inactivity or when their linked PR merges/closes (even while your apps are closed). Active work, pending questions/approvals, and waited-on background work block auto-settlement. Configure rules in **Settings → Threads** (per environment or **All environments**), including **Keep threads with a PR**.
- **Per-thread override**: Open a thread's menu → **Auto-settle behavior → Never** to exempt a single thread.
- **Drag-to-settle** (web/desktop): Press and drag down/up from a thread's **Settle**, **Un-settle**, or **Wake** button to act on a contiguous range (`Esc` cancels).
- **Offline settle/snooze**: Queues locally (**Pending** / **Waiting to sync**) and syncs on reconnect; remote changes take precedence if the thread changed in the meantime.
- **Worktree cleanup on settle**: Enable **Run in the thread's worktree when the thread settles** on a project action (or `"runOnSettle": true` in `t3.json`), e.g. `cargo clean`, to reclaim disk space automatically in worktree threads.

### Snooze options

Customize presets in **Settings → Threads → Snooze options** (durations like `3 hours` or times like `9:00 PM tomorrow`), or pick **Snooze → Custom…** for an exact date/time or duration. **Snooze → Indefinitely** keeps a thread snoozed until you wake it (it still wakes early on approvals, questions, errors, or new messages). Choose **Wake thread** to bring a thread back early.

## Link a pull request

The server automatically links open PRs matching an unsettled thread's branch. On web/desktop, right-click any PR link in a thread and choose **Link to thread** or **Unlink from thread** to override it. Linked PRs participate in auto-settlement.

## Find and reference work

- **Command palette** (`Cmd/Ctrl+K`): Searches threads across connected environments by title, branch, PR, project, and message contents (use `"exact phrase"` for exact matches). On mobile, use the thread list search (or `Cmd+K` on iPad with a keyboard).
- **Copy reference**: Copies the linked PR URL if one exists, otherwise a thread link that pastes into any composer as a thread chip. Use **Copy → Thread** (or **Copy thread** on mobile) to force a thread link, or **Thread ID** for scripts and the `t3` CLI.

## Usage limits, subagents, and thread details

<<<<<<< HEAD
## Inspect agent work

**Limited** means the provider stopped on a usage or rate limit. The conversation
keeps the provider's explanation. Retry after the limit resets, or switch to
another provider instance.
Press **Resume** in an empty composer to continue a limited or interrupted turn
manually when the provider supports native continuation, or send a message to continue.
Do this when the provider reports no reset time, because nothing continues the turn on its own.
Queued messages stay saved while the limit blocks the thread. They run after
the continuation finishes. If the queue was held by a restart, resume it then.

When the provider reports a reset time, choose **Resume at reset** to schedule a
continuation. You can cancel it from the thread. Enable **Resume after
usage limits** in **Settings → Threads** to schedule limit stops by default.
The environment must be running when the reset arrives; it resumes overdue
continuations after a restart. Stopping the thread, sending a new message,
archiving, or settling it prevents a pending continuation from starting.

Choose **Snooze until reset** to hide the thread until its allowance returns.
Snooze and auto-resume are independent: snooze alone wakes the thread without
sending a message; enabling both wakes and continues it. **Wake now** cancels
the snooze. Enable **Snooze until limits reset** in thread behavior settings to
snooze limit stops by default. Providers without a reset time offer manual
retry and the normal snooze choices.

On web and desktop, use **Agents** to follow work delegated to subagents. Click
a subagent there or on its conversation card to open it in the right panel,
beside the thread you are in. See
[Open a thread beside the one you are in](#open-a-thread-beside-the-one-you-are-in).
The sidebar also lists a thread's subagents, and tasks it delegated to linked
environments, under its row: active ones and the five most recently finished,
with **Show more** for the rest. Search finds them under their parent too.
On mobile, open a subagent from its conversation card or **Agents**. On iOS
layouts with an inspector, its thread opens beside the parent. Maximize it to
fill the screen; close the full-screen view to return to the parent and inspector.
Stop on a thread also stops the subagents it delegated to.
Before archiving the parent, wait for its delegated tasks to finish or cancel them.

Subagent threads started by the agent can't take messages; message the parent
thread instead. When such a subagent needs an approval or an answer, the parent
thread asks for it.

Expand a tool call in the conversation to see its full command and output.
Summaries shorten shell wrappers and can still describe the latest call after it
finishes; the call's own result shows its status.

On web and desktop, the thread details card lists the local servers that the
thread's terminals or its Claude agent started, with their ports. Not every one
serves a web page. A server the agent started stays listed after the agent's
turn ends.
Select a server to open it in the browser panel. **Stop** ends the server's job
and keeps the agent, the terminal, and T3 Code running. Stop needs terminal
access to the environment and is not available on Windows.

To choose what the thread details card shows, right-click the card or open
**Settings → Appearance → Thread details**. Hidden rows keep their keyboard
shortcuts, such as Open in editor and project scripts. **Reset to default** brings
back the standard rows.
=======
- **Usage limits**: When a provider hits a rate/usage limit (**Limited**), press **Resume** in an empty composer after reset (or send a message). If the provider reports a reset time, choose **Resume at reset** or **Snooze until reset**—or enable defaults in **Settings → Threads** (**Resume after usage limits** / **Snooze until limits reset**).
- **Subagents**: Follow delegated work from the conversation card or **Agents**. Stopping a parent thread also stops its delegated subagents. Subagents started internally by the provider are read-only; message the parent thread instead.
- **Running dev servers** (web/desktop): The thread details card lists local servers started by the thread's terminals or Claude agent with their ports. Click one to open it in the browser panel, or **Stop** to end it (macOS/Linux only).
- **Customize thread details**: Right-click the thread details card or open **Settings → Appearance → Thread details** to show/hide rows.
>>>>>>> 7fa73d3ef339fb88b4a4f59bd710b43e2cbaff1a

## Open a thread beside the one you are in

On web and desktop, subagents, side chats, and [threads on linked machines](./remote-access.md#read-a-linked-machines-threads) open as a tab in the right panel by default so your main thread stays visible.

- Hold `Cmd`/`Ctrl` while clicking (or middle-click) to open in the main view instead.
- Change the default in **Settings → Chat → Open subagents and side chats in**.
- From a right-panel tab, choose **Open in main view** to promote it.
- On mobile, they open in the inspector where available, or full screen otherwise.

## Side chats

Ask a quick side question about a thread without polluting its history. A side chat starts with the parent thread's context, folder, model, and permissions while the parent keeps working.

- **Start** (web/desktop): Send `/side <question>` or `/btw <question>`, or choose **Side chat** from the right panel's **+** menu.
- **Find later**: Listed under **Side chats** in thread details (web/desktop) or above the composer (mobile); hidden from the main sidebar.
- **Bring results back**: Click **Add to chat** in the side chat, or `@`-mention its title in the parent composer (not readable by external OpenCode servers).
- **Lifecycle**: Closing an unused side chat deletes it. Deleting or archiving the parent thread deletes or archives its side chats.
