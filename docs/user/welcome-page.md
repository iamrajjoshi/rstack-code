# Welcome page

The Welcome page runs on a fresh local installation to help you verify an agent, optionally import existing projects and conversations, and connect the mobile app. Only one ready agent is required to start.

- Reopen it anytime from **Settings → About → Welcome page → Open**.
- Hosted `app.t3.codes` skips this page and prompts you to sign in to T3 Connect and run `t3 connect` on your computer instead.

## Agents

T3 Code lists detected agents first (ready ones on top), followed by **Add more agents** for all other supported providers:

- **Turn on**: Enables a disabled provider and checks its install and sign-in status.
- **Claude Code**: **Install** or **Sign in** opens a setup terminal using the vendor's installer (so **Update now** keeps working in Settings).
- **Codex**: **Set up** offers ChatGPT sign-in or your existing Codex CLI.
- **Outdated or other agents**: **Update** or selecting the agent opens its page in **Settings → Providers**. **Browse** opens the ACP Registry.
- **Desktop CLI**: Click **Add to PATH** if the `t3` command isn't yet on your shell `PATH`.

Click **Start** once at least one agent is ready, or **Start without an agent** to enter the app immediately (checked projects still import).

## Phone

Select **Set up** to scan the QR code for iOS or Android, then sign in to T3 Connect on both devices. If T3 Connect is unavailable or disabled by policy, pair with a code from **Settings → Sharing & access**.

## Projects and conversation import

T3 Code scans directories used by Claude Code, Codex, and Pi (turn on Pi under **Add more agents** to include Pi sessions).

- Git repositories active in the last 30 days with at least three conversations are pre-selected (excluding already-added projects, Codex scratch directories, and `Downloads`). Use **Review all** to customize the selection.
- Conversations active in the last 30 days are imported so you can continue them in T3 Code.

### Import limits

Conversation import is best-effort:

<<<<<<< HEAD
Conversation import is best effort. T3 Code keeps the first user prompt and the
newest remaining visible user and assistant messages, with 200 messages total.
It omits tool activity and attachments. For Codex, it omits generated setup
context only when a canonical user event and a valid shared turn ID identify the
same user turn. Ambiguous legacy or response-only context stays in the imported
conversation so T3 Code does not remove user text. For Claude, slash commands
and `!` shell commands appear as you typed them; their output, background task
notifications and interruption markers are left out, and a conversation that
only ran commands such as `/clear`, with no reply, is skipped. It reads one
conversation at a time and skips files larger than 4 GiB. It also skips a conversation when the
message text and metadata it keeps need more than 32 MiB of memory. Tool output
does not count toward that limit. It skips a conversation with more than 100,000
records every time, so opening the page again does not import it. It ignores
malformed records and conversations with no messages, such as a session opened
in an editor but never used. It skips unreadable or unparseable conversations.

Each import attempt reads up to 100 conversations and 4 GiB per project.
Conversations with no messages count toward the 4 GiB but not the 100. To
continue a large batch, open the Welcome page again and pick the project in
**Review all**. Completed conversations are not imported again. You can continue
without the remaining history.

You can start without importing. While an import runs, T3 Code stays on the
Welcome page. If you quit, open the Welcome page again from **Settings → About**; the
projects you started stay checked.

### Importing from the command line

`t3 claude-sessions import <project>` runs the same import for one project, given
its id or folder, while T3 Code is running. Add `--all-history` to import every
conversation in one go instead of the last 30 days, 100 at a time. The per-file
limits above still apply.

### Claude desktop app session trees

Imported conversations arrive as separate, settled threads. If you worked in the
Claude desktop app, where one session spawns others, you can restore that tree
afterwards: workers nest under the session that started them, sessions that
started workers become coordinators, threads take the desktop app's titles, and
sessions you had not archived there become active again. Archived ones stay
settled.

1. On the Mac with the desktop app, run
   `t3 claude-sessions export --output claude-sessions.json`. The file lists session
   ids, titles, folders and parents; it holds no messages.
2. Copy the file to the machine that runs T3 Code.
3. Import the projects first, then run
   `t3 claude-sessions apply claude-sessions.json --dry-run` to see the counts, and
   again without `--dry-run` to apply them.

Only threads the import created change. A title you renamed in T3 Code stays.
Threads the file does not list keep their state unless you add
`--unsettle-unlisted`. Running `apply` again changes nothing new, so run it again
after importing more history. A worker whose parent was not imported stays at the
top level; the next `apply` after that parent is imported nests it.
=======
- Keeps the first user prompt and the most recent visible user/assistant messages (up to 200 messages total), omitting tool activity and attachments.
- Skips malformed/empty sessions, files over 4 GiB, sessions over 32 MiB of kept text/metadata, or sessions with over 100,000 records.
- Each import pass reads up to 100 conversations and 4 GiB per project. Reopen the Welcome page and select the project in **Review all** to continue importing a larger batch; already-imported conversations are skipped.
>>>>>>> ee99fee188b9097a574ad805e004e10871e9b083
