# Workspaces and repositories

A **repository** is the project you work on: for GitHub, its `owner/repo`
identity. Checkouts, clones and worktrees are storage used by the Runner, not
separate repository choices.
A **workspace** is a named working area containing one or several repository
worktrees, with multiple independent conversations attached to that work. A named
empty workspace is also available for planning before any repository is needed.

GitHub App installation and the GitHub CLI are **not prerequisites** for local
repository setup. Git itself supplies branches and worktrees. The optional
GitHub API connection supplies repository discovery/import and issue/PR lists.

## Create or extend a workspace

1. Open **New workspace** and search by organization or repository name. The
   shared catalog includes registered sources, saved local scans and cached
   GitHub discovery. The same catalog appears in Settings → Repositories.
2. Select repositories. Selection does not clone or register anything. Previously
   selected repositories remain visible as removable chips while filtering.
3. Accept or edit the workspace name, then choose **Create workspace**. The Runner
   prepares only the selected sources and creates their worktrees. Progress is
   streamed; errors preserve the selection and request identity for retry.
4. Use a workspace's **Add repositories…** action to open the same picker with an
   explicit destination. Existing members are marked **In workspace**.
   Conversations and existing worktrees remain in place.

**Connections & folders** expands inside the picker: connect GitHub or choose a
folder to discover existing checkouts. There is no registration/import step and
no second repository browser in GitHub settings. Folder scans are explicit and
saved; reopening a picker does not rescan the filesystem. An empty workspace is
an explicit secondary choice. Naming policy remains configurable in Agents &
workspaces, outside the creation flow; the immutable disk slug is independent.

Discovery never clones. GitHub metadata survives closing windows and Runner
restarts. Local and remote observations of the same normalized `owner/repo` merge
into one choice; prepared sources take precedence over local candidates, then
remote-only entries. Forks remain distinct. A failed or incomplete GitHub refresh
retains the last complete snapshot and reports the source error. A changed GitHub
identity does not expose another account's cached remote discovery.

Repository selection is keyed by logical identity. The Runner resolves checkout
paths and revalidates remote identity during preparation. The default base is
`HEAD`; existing checkout contents and branches are not changed. Default folder
names use the repository name, adding a numeric suffix only for collisions.
Explicit folder names still require uniqueness. Successful source preparations
remain reusable after a later failure; retrying the same request does not clone
again or create another workspace.

## Catalog boundaries and configuration

`repositorycatalog.Source` discovers metadata; `repositorycatalog.Store` persists
complete provider snapshots; `Cache` separates refresh synchronization from reads.
The Runner merges this with existing local discovery and repository registration.
`PrepareWorkspace` owns source preparation and collection provisioning. The shared
React catalog reader/picker owns filtering and selection only. Existing low-level
RPCs remain available for compatibility, but the UI no longer chains imports.

Runner JSON configuration may contain:

```json
{"repositoryCatalog":{"autoRefresh":true,"refreshSeconds":300,"maxPages":1000,"githubEnabled":true}}
```

These are the defaults. `autoRefresh: false` makes GitHub refresh explicit;
`githubEnabled: false` disables GitHub discovery without disabling local sources.
`maxPages` bounds each pagination sequence. A limit or provider failure is an
incomplete refresh, never a successful partial catalog. Remote discovery is also
bounded by a 90-second timeout. Metadata lives in `repository-catalog.json` under
the resolved Runner state directory; credentials remain in the existing private
connection store and never enter the catalog. Automatic refresh occurs while a
repository browser is open, at most at its configured freshness interval.

The Runner resolves one source checkout or bare repository behind that identity.
Git can resolve this source outside a scanned folder through a linked worktree.
Already registered sources take precedence; existing workspace IDs and worktree
ownership remain valid when older registrations refer to multiple clones.
GitHub import reuses an already registered source for the same GitHub project.
Older location-based caches retain their chosen folders but require an explicit
refresh. The normalization reads origin configuration without a network request;
unknown SSH aliases and GitHub Enterprise hosts are not guessed. Renames across
old and new remote names cannot be reconciled offline by this identity model.

It skips descendant symlinks, hidden folders, dependencies and build output, and
stops descending when it finds a Git checkout or bare source. Each scan is bounded
by one minute, 10,000 directories, six subdirectory levels and 512 candidates;
partial results report limits and skipped folders. Up to 16 search roots are
retained in the isolated Runner state. Failed scans retain previous results.

Registration performs local Git inspection only. It neither contacts a remote
nor reads, copies or changes authentication. It preserves the source checkout's
files, current branch, Git configuration and permissions. Workspace creation
adds separate worktrees and new branches through the existing Runner manager;
uncommitted changes in the source are not copied into the new worktrees.

Repeating registration through another clone or worktree of the same GitHub
repository returns the existing library entry. Local repositories without a
recognized GitHub origin use their canonical Git common directory instead. The library persists across Runner restarts. A checkout needs an
initial commit; subfolders and `.git` paths are rejected rather than silently
registering a parent repository.

New workspace folders use a unique three-word petname generated once. The display
name can be edited in its sidebar row with **Rename workspace** (Enter to save,
Escape to cancel). The editor retains its original workspace identity if selection
changes, without changing its folder, member
paths or branches. Existing workspace folders remain in place. Double-clicking a
repository selects it while retaining other selections; checkboxes support
multi-repository selection. The name field opens focused, its suggestion selected so
typing replaces it. The suggested display name follows selected repository
names (`api`, `api + web`, or `authority +4` for more, never a run-on list) until
the user types a custom name. The branch follows the name (`Login fix` →
`feature/login-fix`) and is shown under it; **Edit branch** overrides it. Deselecting
and reselecting updates an automatic suggestion. **Settings → Agents & workspaces**
sets whether suggestions use repository names or a memorable generated name.
Renaming later never renames the fixed disk slug or branches. A workspace still
named by a generated petname shows a quiet **Name it** chip on its card: one
click opens the inline rename with a suggestion from its repositories.

Every workspace card has the same four lines, and so the same height, selected
or not, whatever it holds:

1. its name;
2. one repository line (the owner once, the first names and `+N`; the full list
   is the tooltip and the repository dialog), or "No repositories" with **Add…**;
3. its git line: the branch (`+N` when repositories differ), then uncommitted
   files (●), commits not pushed (↑), pushed commits not pulled (↓), commits
   behind the default branch (⇣), and the pull request with a dot for its
   checks. The tooltip spells it out per repository. The Runner's
   `ListWorkspaceGitSummaries` reads local Git only (no fetch) for every
   workspace in one request; pull requests come from what GetPullRequest last
   read, refreshed in the background for pushed branches. Windows poll it every
   20 seconds while visible, on focus, and shortly after a turn or a commit;
4. the conversation it speaks for (one needing you, else one at work, else the
   newest; `+N` counts the others): one mark, its title, then the live status
   and elapsed time. The title gives way first, then the status's words; the
   time is never cut. Provider, model and account are the tooltip.

**Peek.** Alt-click a peekable row, press Space on it (like Quick Look), or
choose **Peek** in its context menu to see the item live over the current page
without navigating: a conversation (its latest messages, status, a message box
and Stop turn; a workspace row peeks the conversation it speaks for), a
process (facts, its output, Stop behind a confirmation), a command's output,
an artifact, a mission task, or a file in Files. In the peek ← and → step
through the rows around it, ⌘↵ (Ctrl+Enter) opens it here, Space or Esc
closes it and focus returns to the row last shown. The overlay moves by its
header and resizes from its corner. A sub-agent card peeks in the
conversation's own floating sub-agent panel. Rows opt in with `data-peek`
(`peekProps` in `peek-model.ts`); the overlay is `Peek.tsx`.

Example workspace:

```text
gently-bright-otter/
  api/    # branch: feature/gently-bright-otter
  web/    # branch: feature/gently-bright-otter
```

## Sessions, windows and modules

**New session** exposes account and permission choices directly, with model,
gateway and additional context under an expandable section. **Quick start** starts
once from an explicit click using the last successful provider/account/model/gateway
selection for this workspace. Choices are shared by its panels/windows. A refresh
never starts an execution. One-off permissions, context, and rotation pools are not
remembered; Runner defaults apply unless chosen explicitly in New session. Quick start pauses for account selection if its saved profile is unavailable.
With no saved choice, setup suggests a configured managed account, then the first
profile of that provider. In-flight or resumed sessions are not changed.

All sessions in one workspace use the same working folder, branches and files.
They retain independent transcripts, provider identities, commands and continuation
chains. Use different workspaces when changes need separate files/branches.
The Runner tracks each attached execution, including commands that outlive an
agent. Closing one session does not release another session's ownership.

**Open workspace window** opens the whole workspace in a native window that can
be moved to another screen. It retains the workspace while allowing conversation
switches. Closing the window does not end sessions. Each workspace has its own
saved pages, panel arrangement and drafts; changing another workspace does not
replace them. The main window and that workspace's window use its saved layout.

The shared surface accepts a registry of trusted, build-time `PanelModule`s.
Modules receive the selected workspace ID, view target and Runner context.
Chat, repository navigation, output, sessions and application assistants use that
same interface. Unknown saved modules retain their configuration. This is a UI
extension seam, not a downloadable plugin sandbox or an orchestration scheduler.
Future orchestration modules must call Runner-owned execution APIs; window
lifecycle and layout must never own agent lifecycle.

**Run** in the header starts the workspace's default action (a dev server, say)
from its repositories' committed `.lazybox/workspace.yaml`; **Actions** and
**Preview** panels list, control and show them. Each workspace gets its own
block of ports, setup runs after its worktrees are created and an archive
script before it is deleted, all once you approved the scripts. See
[WORKSPACE_RUNTIME.md](WORKSPACE_RUNTIME.md).

**Terminal** in the header opens your login shell in the workspace, on the
Runner, in a Terminal panel docked beside the work; the panel can also open one
in a repository. The shell keeps running when the window closes or the Runner
restarts. See [TERMINALS.md](TERMINALS.md).

### Arrange panels

Every panel with a header (command output, terminal, changes, Ask Lazybox,
usage, sessions) arranges itself from that header, without Customize page:

- **⋯ → Dock left / right / top / bottom** moves the panel to that edge of the
  page's content area, shown, at about a third of it (a terminal on a side
  takes 40%, for columns). The workspace list stays at the page edge. The
  current edge is marked and disabled. The menu is keyboard-reachable (Enter
  or ↓ opens it, arrows move, Escape closes) and focus follows the moved panel.
- **Dragging the header** shows the four edge zones over the content area;
  release on one to dock there. Escape, or a release away from the edges,
  cancels. Not on touch or phone layouts.
- **Clicking the title** collapses the panel to its header (or, beside another
  panel, to a narrow vertical tab) and back.
- **×** closes the panel. A closed panel comes back from **Page actions (⋯) →
  Show panel**. The workspace list and the conversation panel have no panel
  header and do not close: they are what the page is for, and the other panels
  dock around them (Customize page still rearranges them).

The edge you last docked each kind of panel at is remembered per person, across
workspaces: a terminal you moved left opens left next time. Arrangements are
saved in the page layout like any other change; layouts saved before docking
load unchanged. Moving or closing a panel never reloads the others: each panel
renders once and the layout moves it. On a phone, panels show one at a time
from the panel switcher; docking is hidden and **×** remains.

A conversation shows in at most one chat panel per page. Choosing a
conversation reuses the page's chat panel, including one brought back from its
own window (pinned to its conversation); **Bring back** removes the returning
panel when the page already shows that conversation; and saved pages with
duplicate chat panels are repaired when they load.

### Agent telemetry and workspace accounting

The Runner now owns a streaming metering gateway, a SQLite usage ledger and
provider-neutral context snapshots. The **Usage & cost** module can be added to
any workspace page; chat has a compact context/usage disclosure. Select
**Metered · track workspace cost** in a new session's gateway options. Direct
sessions retain provider-reported observations where supported.

The **Processes** panel (also from **Page actions (⋯) → Show panel**) lists
every agent, managed command and terminal the Runner hosts, across workspaces,
with PID, uptime, CPU and memory: open, attach to (tmux) or stop any of them, and
clean up processes no Runner supervises. See
[the Processes panel](SESSION_HOSTS.md#see-every-hosted-process-the-processes-panel).

Records retain workspace, conversation, execution, native-process attempt and
account attribution across continuations and rotation. Workspace application
assistants retain the workspace ID too, with their existing read-only restrictions.
Forwarded child requests count toward their workspace even when the CLI supplies
no reliable child identifier; the UI explicitly marks that attribution unavailable.
See [the telemetry contract](INTERFACES.md#telemetry-and-metering) for pricing,
partial observations, persistence and supported protocol limits.

The UI uses Workspace. Existing `Collection` RPC/type names and
`.lazybox-collections` metadata remain internal historical names. Version 4
manifests retain immutable folder slugs, multiple ownership claims and repository-addition retry records;
older manifests load without moving their folders. Older binaries do not support
these manifests, so use an updated Working build after this upgrade.
The [storage and ownership contract](COLLECTIONS.md) describes those internals.

## Review and conversation continuity

**Review changes** opens a workspace page using the same module registry as chat
and output. The Changes module resolves members on the Runner, verifies their
Git registration, and shows local index/worktree status and bounded diffs. It is
also available through Customize page. Different repository failures stay
independent. GitHub API access is not required for this local inspection.
Each repository also carries its PR loop: commit, push, open a pull request,
follow its checks, send failing checks to the conversation, and merge. See
[the PR loop](GITHUB.md#the-pr-loop). Every diff takes inline review comments,
kept per workspace on the Runner and sent to a conversation as one message;
see [review comments](GITHUB.md#review-comments).

A diff reads **unified or split** (side by side; the choice is remembered for
every window of the Runner, and a pane narrower than 700px shows unified until
it is wider). Both mark the words that changed between a removed line and its
replacement, fold long unchanged runs, and count the unchanged lines between
hunks; where the diff's new side is the working file (uncommitted changes, or a
branch file with no uncommitted edits) a click shows them, read from that file
and refused if it no longer matches the diff. Comments work the same in both:
removed lines from the left, everything else from the right. Each file has a
**Viewed** box, kept per workspace in the client's preferences for this Runner
(not on the Runner) with the diff it was ticked on: a file whose diff has changed is unticked when it is next shown.
Keys in the Changes page: `n`/`p` next and previous hunk, `Shift+N`/`Shift+P`
next and previous file, `v` toggles Viewed (and moves on to the next file still
to review), `s` switches unified and split.

### Per-turn checkpoints and revert

Before each agent turn starts, and again when it ends, the Runner saves every
workspace repository's files: committed, uncommitted and untracked, but not
ignored. Each repository gets a commit under a private ref,
`refs/lazybox/checkpoints/<conversation>/turn-<n>-before` (and `-after`), whose
parent is the HEAD it was taken on; across a multi-repository workspace a
checkpoint is that set of refs. It is written through a private copy of the
index, so the repository's index, HEAD, branch and stash are never touched, and
when nothing changed the previous commit is reused (no new objects). Untracked
files over 32 MiB, past 20,000 per checkpoint, or in nested repositories are left
out and named. A turn waits for its checkpoint (bounded to two minutes); a
repository that cannot be read is reported on the turn and the turn still runs.
Assistant conversations are not checkpointed. Implementation:
`internal/runner/codecheckpoints` (unrelated to `checkpoints`, the execution
handoff).

In the conversation, each finished turn ends with a quiet marker: what it
changed (files, lines), **Show changes in this turn** and **Revert to before this
turn…**. Show changes opens the workspace's Changes page compared with that turn
(before → after; turns are also in its **Compare with** list); a chat in its own
window shows them in a dialog. Revert first previews exactly which files will be
restored, removed or put back, and says what stays: commits made since remain on
the branch (the revert shows as uncommitted changes against them), ignored
files, files too large to checkpoint, repositories added since. It is refused
while any agent in the workspace is in a turn or has a message queued. Before
writing anything the Runner saves the current files as a safety checkpoint, then
rewrites only the paths that differ and checks the result, naming any file it
could not restore. **Undo revert** (in the toast, and on the reverted turn's
marker) restores the safety checkpoint; an undo is itself undoable. The
conversation is kept, not truncated: a Runner notice records the revert, and the
agent is told with the next message (through the same path as instruction
updates) that files were reverted and must be re-read. Forking the provider
conversation at a turn is not implemented.

Each conversation keeps its latest 100 turns and 20 reverts; older ones are
pruned with their refs (`codeCheckpoints` in the Runner configuration changes
the bounds). Deleting the conversation deletes its record and every ref. The
RPCs (`ListTurnCheckpoints`, `ListTurnChanges`, `ReadTurnDiff`,
`PreviewRevertCode`, `RevertCode`, `UndoRevertCode`) are the owner's alone: an
agent's or terminal's credential cannot call them.

Conversation names belong to the durable conversation, across native resumes.
Automatic titles come from the first attempt; a follow-up after resuming does not
replace that title. Explicit renames override the automatic title.
Selecting a workspace restores its saved conversation selection; it does not
choose a different open execution from the Runner catalog. **Conversation history**
searches titles across all workspaces, including conversations retained after deletion.
Reading history never starts an execution. For a normally stopped, resumable
conversation, send the next message to continue using its saved account, model,
gateway and permissions. Uncertain process ownership still requires explicit
reconciliation. Views anchored to an earlier attempt follow its recorded successor
without creating another execution. Drafts and send identities are retained before
resuming delivery.

Chat folds streaming deltas into complete messages independently of the diagnostic
event buffer. It renders the latest 100 messages initially; **Show earlier messages**
reveals retained messages while preserving the reading position. Incoming output
only scrolls when already following the bottom; **Jump to latest** resumes following.
Replay gaps and terminal stream errors appear in the chat with **Retry conversation**.
They never masquerade as a new, empty conversation.

Chat cost totals include all execution attempts in the conversation. Context uses
the latest reported snapshot per agent; workspace cost aggregation remains separate.

Local Markdown links and inline `path:line` references open in the **Editor**
panel (a folder opens in **Files**); Alt/Option-click opens the quick-look window
instead and Cmd/Ctrl-click opens beside the current file. Before opening, the
Runner resolves what the agent wrote (`ResolveWorkspacePath`): the path as given,
then each shorter tail of it at the workspace root and under every repository
(so `scripts/x.json`, `./scripts/x.json` and an absolute path from another
checkout all find `api/scripts/x.json`), then a path-suffix match, then the file
name. Several matches open a chooser, nearest first; only a reference that names
nothing in the workspace is reported. Resolution never reads outside the
workspace: traversal is reduced to a lookup by tail and every candidate is opened
through `os.Root`, so a symlink out of the workspace never matches. Previews are
bounded to 1 MiB and report binary files explicitly. **Open file** in Changes
opens the changed path as is, without resolution.

**Files** is a tree of the workspace with its repositories at the top, folders
loaded as they are opened, file-type icons, and unsaved files marked. ↑/↓ (j/k)
move, →/← (l/h) open and close folders or step in and out, Enter opens a file
and focuses it, Space opens a preview, `*` opens sibling folders, `/` starts
**Go to file**. The active file is revealed as tabs change. Opened folders are
remembered per workspace; shown folders refresh on focus and every 12 seconds.

**Go to file** (Cmd/Ctrl+P, `]] f`, or the Files search box) is a fuzzy finder over
every file in the workspace's repositories. `SearchWorkspaceFiles` ranks on the
Runner over an index of `git ls-files --cached --others --exclude-standard` per
repository, so ignored files are left out; the index is bounded (200,000 paths,
10 s) and cached for 10 s, and results that are not regular files inside the
workspace are dropped. An empty query lists recently opened files; `name:42`
opens at line 42; Cmd/Ctrl+Enter opens beside, Alt+Enter quick-looks.

The **Editor** panel holds files in tabs, in up to four groups split right or
down (buttons on each group, Cmd/Ctrl+\ and Cmd/Ctrl+Alt+\). A single click
opens a preview tab (italic) that the next one replaces; a double click, an edit
or Enter keeps it. Tabs show an unsaved dot, reorder by drag or
Cmd/Ctrl+Alt+Shift+←/→, move between groups by drag, cycle with Cmd/Ctrl+Alt+←/→,
and close with ×, middle click or Alt+W; closing an unsaved file asks to save,
discard or cancel. Cmd/Ctrl+Alt+1…4 focuses a group. Two groups on one file share
its text with separate cursors; each remembers its place in every file. Groups,
tabs, order and recent files persist per workspace; drafts live for the window
and a page close with unsaved edits asks first. Visible files poll the Runner
every 4 seconds: a clean file takes the new disk version, an edited one shows
**Use disk version** / **Keep mine** rather than losing either. Files and the
editor dock together to the right of the conversation.

Sidebar filtering is scoped on the Runner before pagination, and continuations
retain the original creation order. Native personal views use the persistent
Runner identity and private native storage, so restarting with a new local port
or Vite origin no longer strands pages and draft keys.

## Current limits

The current UI discovers and registers existing Runner checkouts. The native
folder chooser belongs to the local desktop Runner; remote filesystem browsing
and generic clone-by-URL are not implemented in this slice. Use an existing clone, or clone using your normal Git workflow before
adding it. This does not grant a new GitHub API application access to an
organization: issues/PR API access remains a separate authorization decision.

## Dogfood interaction rules (2026-11-03)

The default page is **Work**. The unused built-in Monitor page is removed when
restoring old layouts; other customized pages and their selected conversations
are preserved. The sidebar is a workspace list with conversations nested under
only the selected workspace. Standalone conversations have an explicitly named
**Without a workspace** section, hidden when empty. Repository details describe
the selected workspace; rename and delete live in the always-visible actions menu
on each workspace row. Existing conversations precede search and new-conversation
actions. Search is explicitly scoped to conversation titles within that workspace
and is hidden for a single conversation. Counts say
`repo`/`repos` rather than displaying an unexplained number. A selected conversation
shows its account, while the conversation switcher uses titles.

The UX principles here are scope first, one visible hierarchy, and progressive
disclosure: everyday work is workspace → conversation; Git locations and technical
request metadata stay in details. New conversation belongs to the selected
workspace. Background execution is never inferred from a window's visibility.
No monitoring/dashboard workflow is added without a concrete use case.

Chat, Help and Planning share the Markdown renderer: headings, lists, tables,
inline/fenced code, JSON highlighting/copy and Mermaid diagrams. Approval cards
show the tool description and command first, with structured request metadata in
an expandable JSON view. Diffs use the same code presentation. Raw HTML remains
inert and message images do not fetch external URLs. Mermaid loads only when a
diagram is present, renders in strict mode into an SVG image, and falls back to
copyable source on invalid/incomplete input. Console logs retain exact raw text.

The chat header is one row: the conversation title (click to rename in place;
while it has none, the workspace branch leads, never the folder's generated
name, with a quiet **Name it** that suggests a title from the first message),
then agent, model, account and the live status, and on the right the context
meter, cost, **Activity** (quiet at 0), pop-out and ⋯. A session that opened
and never ran a turn reads **Ready** and takes the keyboard, not "Starting":
the Claude SDK reports `session_ready` only after the first prompt. Runner
restart dividers are left out of a conversation that is otherwise empty.

The live status moves while the agent works, in the header, the line above the
composer, sidebar rows and inbox rows alike: a turning ring and the step with
its elapsed time (`Running · Bash · 12s`, `Thinking · 4s`); waiting for you
breathes; nothing moves under reduced motion. Rows use the Runner's
`AgentActivity.phase`, `tool` and `phase_since_unix_millis`; the open chat
refines them from its journal.

Activity appears beside the composer while a turn runs: Thinking, Running a tool,
Writing, Waiting for the model, or Compacting context when the provider reports
that phase. Unknown
activity stays generic Working; no hidden reasoning is displayed. Root completion
and background-agent activity remain distinct. Connection recovery has its own
label. This transport is Connect streaming RPC, not SSE; text deltas are rendered
before stream completion.

## Delete and resource cleanup

**Workspace actions → Delete workspace** uses a confirmation button without name
typing. It previews active executions and local
files, states the detected risks, and asks explicitly before stopping sessions
or discarding changed/untracked/ignored files. Cleanup first fences new workspace
attachments, closes owned provider processes, cancels and waits for owned commands,
then removes each worktree through Git and removes the workspace folder. Source
repositories, branches (including committed work), accounts and conversation
history remain. The destructive operation is not performed when opening the dialog.

A durable deleting state supports retry after partial removal; deletion never
silently becomes success when a process, source identity, root path, or Git
registration cannot be verified. Unknown ownership after a Runner crash requires
reconciliation. External pipe producers are not Runner-owned processes and cannot
be declared stopped by cancelling a log reader. Tombstones prevent retried create
requests from resurrecting deleted workspaces. Deleted workspaces are hidden from
the workspace list, and their conversation history cannot resume into missing files.

**End session** in chat uses `StopSessionResources` to stop that provider and its
owned commands. Closing a window still only disconnects its readers. Closed agent
sessions release the concurrent execution cap; retained history does not consume
an active-session slot. The existing low-level `CloseSession` RPC still ends only
the provider, for callers deliberately keeping managed commands alive.

Each agent runs in its own [session host](SESSION_HOSTS.md) (optionally in a tmux
window you can attach to; see [hosting backends](SESSION_HOSTS.md#hosting-backends-session-hosts-default-or-tmux)). Window
reloads reattach readers to the same execution. A Runner restart re-attaches to
the same native process and to the commands it started. Only a machine reboot, or a host the Runner cannot
adopt, falls back to native conversation resume.

Context usage opens in a bounded popover so inspecting it does not displace chat.
Category colors match the segmented capacity bar; compaction reserve and free
space are separate from used context. Deferred tools are listed outside context.
Provider estimates retain their provenance; token cost is a separate disclosure,
with API-equivalent estimates distinguished from subscription allowance and bills.

### Navigation and file editing

The sidebar contains workspaces and their conversations. Repository membership is
managed from a workspace's **Manage repositories…** action or its repository count
in the header. The add dialog names the destination workspace. Renaming changes
only presentation and does not reset the Runner connection or transcript reader.
Conversation rows show provider, reported model (or an explicitly requested model, with missing reports labeled
as unknown), account label, and status. **Conversation history** searches titles across
all workspaces; it is not a full-text transcript search.

Each window caches the last 16 inactive conversation readers, retaining the
projected transcript, cursor, reading position and visible message count. Reopening
one reconnects after its cursor. Provider execution remains owned by the Runner;
this cache does not launch, resume or keep an agent process alive. Restarting the
application still reads durable Runner history.

Quick look (Alt/Option-click a file reference, or from an editor group's menu)
opens a tall, draggable, resizable surface with Markdown preview and the same
locally bundled Monaco editor; **Open in editor** moves it to a tab. Detached
chat windows, which have no editor panel, open every reference here. Monaco
starts loading when the Files or Editor panel mounts or a file link is pointed
at; a slow load shows a quiet outline after 300 ms, never a loading label.
Editing in quick look is explicit. Save compares the loaded
revision with the file on the Runner and rejects a changed file while retaining
the draft. Lazybox edits serialize per workspace manager and use a same-directory
atomic replacement with existing mode bits; external writers do not participate
in that lock. Binary, truncated, symlink and read-only files cannot be edited.
Unsaved drafts require an explicit discard before closing or refreshing.

**Delete conversation…** appears in conversation row actions and the chat session
menu. It stops and waits for owned execution when explicitly confirmed, releases
workspace ownership, removes Lazybox attempts/transcripts/uploads and retains
identity-only deletion tombstones so legacy import cannot resurrect them. Uncertain
process ownership blocks deletion. Workspace files, subscriptions, accounting,
command audit logs and the provider's own history remain. **End session** retains
conversation history; **Delete workspace** has its own file/resource check.


The chat follows its rendered content height, including delayed diagrams and
viewport changes, while the reader is at the bottom. Scrolling up suspends follow;
returning to the conversation restores that reading position. **Jump to latest**
and sending a new message resume follow. The header shows the provider-reported
main-agent model, captured from startup/context/usage events as well as the saved
session metadata. Internal account IDs such as `claude-default` are presented as
“Local CLI sign-in,” separately from the model.

Sidebar navigation shows the workspace name with its repository identities underneath. Conversations use compact title/model rows; the account is shown only when a named account is known. A closed execution is labelled Saved, not an ended conversation. Action menus remain inside their rows. Deletion initially focuses Cancel; draggable headers retain keyboard movement without a hover instruction popup.

Resuming preserves the mounted transcript and its projected messages. The successor reader inherits the predecessor’s contiguous timeline cursor and view state, then reads only the new events. An unrelated execution never inherits another conversation’s transcript.

## Compact navigation and keyboard controls

A workspace with exactly one known conversation is one sidebar entry. Clicking it
opens that saved conversation; it never starts an execution. Multiple
conversations appear as children only in the selected workspace. Repository names
stay on the workspace row. The plus icon beside its name opens a new conversation;
the row menu distinguishes deleting the conversation from deleting the workspace.
The sidebar loads one paginated history index independently of selection, merging
live execution updates and retaining its last complete history on refresh failure.

Settings → Shortcuts offers three key presets (Vim-style `]]` and `h j k l`, a
`Ctrl+b` prefix with arrow keys, and arrow keys) and editable bindings.
Space separates a sequence; `Ctrl+b` denotes a chord. The default `] ]` leaves the
composer for navigation, `] ] s` opens snippets, `] ] c` opens a new conversation,
and `] ] w` creates a workspace. In navigation, `j/k` move, `h` focuses the parent
workspace, and `l` opens the entry and focuses its composer. The `Ctrl+b` preset
uses `Ctrl+b` followed by arrows or `s/c/w`. After the prefix, a menu card lists
every next key. Settings → Shortcuts also adds your own entries to that menu: one
key sends a snippet, or inserts it when a draft is already there.
A single `]` remains draft text. IME composition and ordinary form fields are not
navigation targets. Bindings are client preferences persisted through the host's
view-state store; they do not change the Runner's permissions or agent settings.

### Vim editing

Settings → Shortcuts has two opt-in switches, applied immediately and persisted
with the other keyboard preferences: **Vim editing in the message box** and
**Vim editing in the file editor**.

The message box gets a small modal layer (`composer-vim.ts`, unit-tested in
`scripts/composer-vim.test.ts`). An empty box starts in insert mode, which is the
plain textarea: typing, IME composition, paste, attachments, snippets and the saved
draft behave exactly as without Vim, and Enter keeps the configured send key.
Esc switches to normal mode, shown by a `NORMAL` chip and a block cursor. Normal
mode supports `i a A I o O`, `h j k l w b e 0 ^ $ gg G`, `x X dd dw D cw cc C yy p P`,
operators with any of those motions (`d c y`), counts (`3w`, `2dd`, `d2w`), `u` and
Ctrl-r (one insert is one undo step), visual mode `v` with `y d c`, and Enter sends.
Cmd/Alt shortcuts stay with the browser; a paste in normal mode lands at the cursor.
Vim edits go through the same input path as typing, so the draft persists. The
leader's first key (`]` by default) is never a Vim command: `]]` opens the menu from
normal and visual mode without inserting a bracket, and from insert mode the first
`]` is text until the second removes it, as before. When a send empties the box the
next message starts in insert mode.

The Monaco file editor uses `monaco-vim` 0.4.4 (CodeMirror's Vim keymap) with a
status line for the mode, pending keys and the `:` prompt. `:w` saves through the
normal save path, `:q` closes through the unsaved-changes guard, `:q!` discards,
and `:wq`/`:x` save then close (staying open if the save fails). Esc inside the
editor always stays there: it leaves insert or visual mode and never closes the
window; Esc elsewhere in the window still closes it. While Vim is on, Monaco uses
its textarea input rather than Chromium's EditContext, which delivered keys typed
just before Esc after Vim had left insert mode (dropped or reordered text).
monaco-vim imports `monaco-editor/esm/vs/...` paths that monaco-editor 0.55+ no
longer exports; `scripts/monaco-vim-compat.mjs` is a labelled Vite stopgap mapping
them to the exported paths, wired into both app configs and the editor UI tests.
`npm run test:vim-editing` covers both surfaces in WebKit and Chromium.

## Snippets

The composer snippet icon and the configurable snippet shortcut open the same
searchable picker. Preview the exact delivered body, then **Insert** (Shift+Enter)
or **Send snippet** (Enter). Existing draft text disables immediate snippet sending;
insertion preserves it. Every confirmed send or insert counts as a use: the
last-used snippet comes first, then favorites, and **Frequent** sorts by use
count (shown as `3×`).

In the message box, ↑ in an empty box (or with the caret at its very start)
recalls sent messages like a shell: this conversation's first, then every
other's, newest first; ↓ walks back and returns the draft it replaced. In Vim
normal mode the arrows keep their Vim meaning.
The existing message/receipt and resume paths own delivery and retry identity.

The Runner's `snippets.Catalog` seam has a command adapter. The shipped
`lazybox-snippets` helper links the existing `lazybox-config` Rust library so built-in
content, profile paths, global/launch-directory overrides and skill-backed bodies
remain authoritative in one place. It is read-only. `snippetCommand` and
`snippetDirectory` in Runner configuration can select another compatible adapter
and launch-directory layer. An unconfigured adapter produces a visible error.
The native Dev launcher builds the helper; staged Working releases contain a frozen
copy covered by the source digest. No snippet is executed by the helper.
This restores catalog/preview/insertion/delivery; V1's tracker workflow badges,
artifact coordination, and broadcast/next-workflow automation are not implemented
in V2 by this change.

Repository preparation streams recognized Git transfer stages and numeric counts.
The overall progress bar is indeterminate because cloning and worktree creation
have different units; stage percentages are Git's reported values. Raw Git stderr
and credentials are never forwarded to the UI. Losing the stream cancels the
owned clone process group, and retries reuse successfully prepared repositories.

Command execution/output is supported. An interactive PTY shell with tmux-style
pane multiplexing is not yet implemented; keyboard presets do not imply one.

### Activity inspection and context evidence

The chat keeps one live phase line. **Activity** in the chat header opens tool
history; calls and results remain collapsed until requested. Claude tool results
are correlated with their call IDs; Codex items retain their start/completion
state. Sub-agent calls are attributed separately. Missing results say “Result
not reported”, never “Completed”. The client retains the latest 1,024 activity
events separately from its 80-event diagnostic tail and labels truncation.

Claude's `requesting` status means an API wait, not compaction. Only native
`compacting` displays that phase; a clear status or compact boundary clears it.
Context categories expand into provider-reported names and counts. Claude's
summary endpoint supplies estimates without per-category token-count API calls.
Tool inspection previews are bounded at the provider boundary and again in the client. No prompt bodies, tool schemas or absolute memory paths enter the context report.
Codex currently supplies window usage/capacity but no category detail; missing
categories remain unavailable. A context snapshot's observation time is visible.

Workspace rows show each repository on its own line. Right-click opens the same
workspace menu as the ellipsis; F2 starts inline rename. File links can browse
folders under the workspace, including references prefixed by its actual folder
name. File access remains confined by `os.Root`. Automatic inline-code links
require file-shaped text, so `origin/main` and `feature/example` stay plain code.

**Review changes** shows uncommitted changes. Unstaged diffs compare the index
with the working tree; staged diffs compare HEAD with the index. Untracked files
show their content. This view does not compare committed branch work with main.

Snippet search now includes the body. Favorites are saved in native view state
and can be filtered; built-ins/global/project content remains owned by V1's
catalog adapter. This is still a picker, not a create/edit/delete snippet manager.

Activity rows use provider action descriptions with tool names as secondary labels.
The newest calls appear first; search includes descriptions and tool identity, and
Running/Failed filters narrow the list. Timestamps are the Runner's recorded event
times, displayed in the viewer's local time. Elapsed time measures observed call
to result (including approval/provider waits); it updates while a call is running.
Missing timestamp pairs remain unavailable, and turn completion never substitutes
for a tool result. Older history with missing results has one explanatory note.
Commands use syntax highlighting/copy; full input JSON is a separate disclosure.
