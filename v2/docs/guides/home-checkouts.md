# Home checkouts

A workspace is temporary: its repositories are git worktrees named after the
task, and they go when the workspace does. Some things need a place that
stays: signing in to a tool (`acme login`), a dev server you keep running
(`make playground`), setting up a tool once, trying a module by hand. That
place is a repository's **home checkout**: your own regular clone, at a stable
path such as `~/lazybox/repos/acme/api`, outside every workspace.

- [Give a repository a home](#give-a-repository-a-home)
- [Open it](#open-it)
- [Run what an agent hands back](#run-what-an-agent-hands-back)
- [What agents know](#what-agents-know)
- [From the command line](#from-the-command-line)
- [What Lazybox never does there](#what-lazybox-never-does-there)

## Give a repository a home

Open **Settings → Repositories → Home checkouts**, or a workspace's
repositories (the **N repositories** button above the sidebar). Each
repository shows its home, its branch and how many files you changed, or:

- **Create at `~/lazybox/repos/<owner>/<name>`**: a regular clone of the
  repository, on its default branch, whose `origin` is the real remote. It is
  made from Lazybox's own copy on this computer, so it needs no network and
  little disk: Git hard-links the objects it can.
- **Use an existing folder…**: a checkout of the repository you already have,
  wherever it is. Lazybox checks it is that repository's checkout (its top
  folder), and changes nothing in it.

A repository you added from a folder on this computer already has a home: that
folder. **Forget this home** (in the row's ⋯ menu) only stops Lazybox using
the folder; no file changes.

## Open it

In a workspace's repositories, **Open in terminal** starts a shell in the home
in the workspace’s Terminal panel and gives it
the keyboard. The row's ⋯ menu also opens it in Finder or your editor (choose
which in **Settings → Repositories → Editor**) and copies its path.

The Terminal panel's directory list has every home of the workspace's
repositories, and **Home folder (~)**, beside the workspace's own folders.
A shell there still belongs to the workspace: `make playground 2>&1 | lazybox
log` typed in it shows in this workspace’s console ([send your terminal’s output to Lazybox](run-your-app.md#send-your-terminals-output-to-lazybox)), and deleting the workspace
closes it.

Lazybox is not a terminal emulator: the panel is a plain shell for these
moments. For long sessions, **Open in Terminal** opens your own terminal app.

## Run what an agent hands back

When an agent ends its turn with something only you can run, its last
message gets one button per command:

- **Run in api home `make playground`** opens a shell in the api home and
  runs it.
- **Run in your home folder `gcloud auth application-default login`**: a
  login that belongs to no repository runs in your home folder.
- **Create api home and run** when the repository has no home yet: it clones
  one first.

A one-line command runs at once, in a shell that has the keyboard, so a login
can ask its questions. A script of several lines, or one with something to
fill in (`<your-token>`), is typed at the prompt for you to review; press
Return to run it.

Agents are told to write these as "run in the home checkout of api:
`make playground`", which Lazybox reads for certain. Other wording is read on
a best-effort basis: a command the message plainly hands to you ("run …
yourself", "you'll need to run …", a login). A command the agent says it ran
is never offered, nor one for later (`make stop` when done). Every code
block's **Run** menu (its ⌄) also has **Run in … home** and **Run in your
home folder**.

## What agents know

A new conversation is told each of its repositories' home checkout, and that
it is yours: read-only for the agent, which may read it and run read-only
commands there, but never edits, commits, resets, pulls or switches branches
in it. `lazybox workspace repos` and `lazybox repos` show the homes to an
agent too. An agent can never create, change or open one.

## From the command line

```sh
lazybox repos                          # every repository, its home, branch and changes
cd "$(lazybox repo home api)"          # the path alone, for scripts
lazybox repo home api --create         # clone one at the suggested place (--path P for another)
lazybox repo home api --adopt ~/src/api
lazybox repo home api --forget         # no file changes
```

## What Lazybox never does there

- It never deletes a home: not when you forget it, not when you remove the
  repository, not when a workspace goes.
- No workspace operation reaches it. Workspaces stay worktrees of Lazybox's
  own copy; a home is a separate clone, so an agent's branch never appears in
  it and its branch is yours.
- Its `origin` is the real remote, used with your own Git credentials.
  Lazybox's GitHub token never goes in it.
- Paths are local to the Runner's computer; nothing about a home is shared or
  reachable from another device.

The design is in [WORKSPACES.md](../../WORKSPACES.md#home-checkouts).
