# Install Lazybox

Lazybox is a Mac app (Apple Silicon, macOS 12 or later). It brings everything
it runs: its background service (the **Runner**), the Claude worker and the
Node that runs it, and the `lazybox` command. You need the agents you want to
use signed in as usual (Claude Code, Codex), and `git`.

## Install

**Disk image.** Download `Lazybox_<version>_aarch64.dmg` from the
[releases](https://github.com/AntoineToussaint/lazybox/releases) (the ones
named *Lazybox x.y.z*), open it, and drag **Lazybox** onto **Applications**.
Eject the disk image, then open Lazybox from Applications.

**Homebrew.**

```sh
brew install --cask AntoineToussaint/lazybox/lazybox-v2
```

Open Lazybox from Applications once afterwards: the first launch sets up the
Runner (below).

### Unsigned builds

A release whose title says *(unsigned)* is not signed with an Apple Developer
ID. macOS refuses to open it the first time ("Apple could not verify…"):
Control-click Lazybox in Applications, choose **Open**, then **Open** again.
Or, in a terminal:

```sh
xattr -dr com.apple.quarantine /Applications/Lazybox.app
```

Signed releases open without asking.

## First run

The first time Lazybox opens it explains, once, what it needs to set up:

- **The Runner**, a per-user background service (a launchd agent,
  `~/Library/LaunchAgents/ai.lazybox.runner.plist`). Your agents run in it, so
  they **keep working when you close the window or quit Lazybox**. It starts
  when you log in, answers only on this Mac (loopback), and keeps its data in
  `~/Library/Application Support/Lazybox`.
- **The `lazybox` command** (optional, ticked by default): a link in
  `/usr/local/bin` when you can write there without a password, otherwise in
  `~/.local/bin`, plus completions for your shell. If that directory is not
  on your PATH, Lazybox says which line to add.

Choose **Set up Lazybox**; when it says the Runner is running, **Open
Lazybox**. Closing the window instead quits without changing anything, and
the next launch asks again.

If Lazybox was opened straight from the disk image or Downloads, it asks you
to move it to Applications first: macOS runs such a copy from a temporary
location a background service must not point at.

Where things are:

| What | Where |
| --- | --- |
| Runner state, conversations, subscriptions | `~/Library/Application Support/Lazybox/state` |
| Runner settings (`runner.config.json`) | `~/Library/Application Support/Lazybox/` |
| Workspaces' git worktrees | `~/Library/Application Support/Lazybox/workspaces` |
| Runner log | `~/Library/Logs/Lazybox/runner.log` |
| Your actions and hooks, CLI Runner list | `~/.config/lazybox/` (shared with Dev and Working) |

## Updates

Lazybox checks for a new version every few hours. When one is out, the header
shows **Lazybox x.y.z · What's new · Restart to update**. Restarting installs
the new app (its download is checked against the signing key the app was
built with), moves the Runner service to the same version and reopens your
windows. **Running agents, commands and terminals keep running**: the new
Runner re-attaches them (see [session hosts](SESSION_HOSTS.md)).

**Not now** (×) hides the notice until the next version. Settings → **About**
shows the version the app, the Runner and the CLI share, checks for updates
on demand and lists what changed. After an update, **What's new** opens once
on its own.

Homebrew installs update the same way (the cask is marked `auto_updates`);
`brew upgrade --greedy --cask lazybox-v2` also works.

## The `lazybox` command

Everything the app does is also a command; `lazybox` with no arguments lists
them. For the installation itself:

```sh
lazybox --version                # the release; app, CLI and Runner match
lazybox doctor                   # check everything, with the fix for anything wrong
lazybox service status           # is the Runner installed, running, answering
lazybox service logs [-f]        # the Runner's log
lazybox service restart          # a fresh Runner; agents keep running
lazybox service stop | start     # stop until the next login, or start now
lazybox link                     # put lazybox on PATH (+ completions), again
```

`lazybox service install` is what the first run does; it also repairs a
service, refreshes the PATH agents get (read from your login shell), and moves
the service to the release it belongs to. `lazybox service plan` prints the
launchd job it would write.

From your own terminal, `lazybox run -- <command>` and `cmd | lazybox log`
find the Runner by themselves and publish to the workspace you are in (run
them inside a workspace's folder or worktree), or to `--collection <name>`.

## Troubleshooting

Start with:

```sh
lazybox doctor
```

It checks the release, the service, the endpoint, that app, CLI and Runner
are the same version, the bundled Node and Claude worker, Claude Code, Codex,
`git` and `gh` on the PATH agents get, your GitHub connection and free disk
space, and prints the fix next to anything that is not right. The app's setup
window runs the same checks (**Run diagnostics**) when it cannot reach the
Runner.

| Symptom | What to do |
| --- | --- |
| "Lazybox can't reach its Runner" | **Start the Runner**; if it stops again, **Show log** (or `lazybox service logs`). |
| An agent cannot find `codex`, `gh`, `npm`… | The Runner's PATH comes from your login shell when the service was installed. Fix your shell's PATH, then `lazybox service install`. |
| `lazybox` runs something else | Another `lazybox` (for example the V1 TUI) comes first on PATH. `lazybox doctor` names it; `lazybox link --dir <earlier directory>`. |
| Versions differ in Settings → About | Quit and reopen Lazybox: it moves the Runner to its own version. Or `lazybox service install`. |
| macOS will not open the app | An unsigned build: see [Unsigned builds](#unsigned-builds). |

Logs: `~/Library/Logs/Lazybox/runner.log` (the Runner),
`~/Library/Application Support/Lazybox/state/hosts/*/host.log` (each agent's
session host).

## Uninstall

```sh
lazybox uninstall --dry-run     # what would be removed
lazybox uninstall               # the service, the CLI link, completions
lazybox uninstall --remove-data # also conversations, subscriptions, workspaces, logs (asks first)
```

Then drag Lazybox from Applications to the Trash (or
`brew uninstall --cask lazybox-v2`; `brew uninstall --zap` also deletes your
data). Without `--remove-data` your conversations and settings stay, so a
reinstall picks up where you left off. `--remove-data` deletes the
workspaces' worktrees too: anything uncommitted or unpushed in them is lost,
which is why it asks.

Agents still running when the service is removed stop by themselves within a
day, or are re-attached if you install again before then.

## Dev and Working

The installed app is separate from the [Dev and Working environments](ENVIRONMENTS.md)
used to develop Lazybox: its own app identity (`ai.lazybox.app`), state,
Runner and launchd job. `lazybox runners` lists every Runner the CLI can
reach; with several, it uses the installed one, then Working.
