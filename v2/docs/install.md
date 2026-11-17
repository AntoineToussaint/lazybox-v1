# Install Lazybox

Lazybox is a Mac app (Apple Silicon, macOS 13.5 or later). It brings everything
it runs: its background service (the **Runner**), the Claude worker and the
Node that runs it, Claude Code, and the `lazybox` command. Claude Code only
needs you to sign in: the account your `claude` command already uses, or one
you add in Settings → Subscriptions. Codex, if you use it, is installed and
signed in as usual. You also need `git`.

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
ID or notarized. macOS refuses to open it the first time (*"Lazybox" Not
Opened* or *Apple could not verify "Lazybox" is free of malware…*). On macOS
15 and later, Control-click → **Open** no longer gets past this. Instead:

1. Open Lazybox from Applications once, and choose **Done** when macOS refuses.
2. Open **System Settings → Privacy & Security**, scroll to **Security**, and
   choose **Open Anyway** next to *"Lazybox" was blocked…*. Confirm with your
   password or Touch ID.
3. Open Lazybox again and choose **Open Anyway** (or **Open**). macOS does not
   ask again for this copy.

Or, in a terminal, remove the quarantine macOS put on the download, then open
Lazybox as usual:

```sh
xattr -dr com.apple.quarantine /Applications/Lazybox.app
```

A new unsigned release installed from a disk image or with Homebrew asks
again. Signed releases open without asking.

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

Lazybox offers updates and never forces one. **Settings → Updates** (or
**Help → Check for updates…**) is where you decide:

- **Check automatically** (on by default) asks for a new version when
  Lazybox opens and every six hours after. A check downloads one small file
  (`latest.json` from the `v2-updates` release on GitHub) and sends nothing
  about you. Turn it off and Lazybox looks only when you choose **Check now**.
- When a version is out, the header shows one quiet line, **Lazybox x.y.z ·
  Update…**, and Settings → Updates says so. Nothing is downloaded yet.
- **Update…** shows what changed since your version, then:
  - **Install and restart** downloads the update, checks it against the
    signing key built into your copy of Lazybox (a download that does not
    match is refused and nothing changes), replaces the app, moves the Runner
    to the same version and reopens your windows where they were.
  - **Remind me later** hides it for a day (the × on the header line does the
    same).
  - **Skip this version** never offers that version again; the next one is
    offered as usual. **Stop skipping** in Settings → Updates undoes it.

**Running agents keep running.** Before you confirm, the dialog says how many
agents are running. Installing replaces the app on disk while every running
program keeps its own copy, then restarts only the Runner: the old one
detaches from its agents, commands and terminals, and the new one picks them
back up within seconds (see [session hosts](../SESSION_HOSTS.md)). Output
they write meanwhile is kept, and an approval that is waiting stays waiting.
If the new version could not take an agent over, that agent stops and its
conversation resumes from where it was.

After the restart, **What's new** opens once with "Updated to Lazybox
x.y.z". If an install did not finish, the next launch says so instead:
Lazybox is still on the version you had, and nothing else changed.

The app, its Runner and the `lazybox` command are one release. Settings →
Updates shows the three versions; if the Runner is on another version than
the app, it says why and offers **Move the Runner now** (`lazybox service
install`; agents keep running). Lazybox also does this by itself the next
time it starts.

Homebrew installs update the same way (the cask is marked `auto_updates`);
`brew upgrade --greedy --cask lazybox-v2` also works.

| Message in Settings → Updates | What it means |
| --- | --- |
| *Lazybox could not reach GitHub* | No network, or GitHub is unreachable. Nothing to do; it tries again later. |
| *No update information is published* | The feed does not exist yet (no release has been published), or GitHub answered without it. |
| *The download is not signed with Lazybox's key* | The update was refused before anything was replaced. Try again later; if it keeps happening, send feedback. |
| *Lazybox cannot replace itself where it is installed* | The app is somewhere it cannot write (not in Applications, or another user's copy). Move it to Applications, or install from the disk image. |

## Send feedback

**Help → Send feedback…** writes a report you read before it goes anywhere.
Lazybox has no telemetry and uploads nothing.

- **What happened**, in your words.
- **A screenshot of this window** (ticked when available): the window as it
  was when you chose Send feedback.
- **Diagnostics** (ticked): the app and Runner versions, macOS, and the last
  200 lines of the Runner's log. Tokens, keys and passwords are removed,
  e-mail addresses too, and paths in your home folder read `~`.
- **The open conversation** (not ticked): its title, agent, model, state and
  last error. Its messages are never included.

The right side shows exactly what will be shared. Then:

- **Save to file** writes `feedback.md` (and `screenshot.png`) to a new
  folder in Downloads, *Lazybox feedback <date and time>*.
- **Copy** puts the report on the clipboard.
- **Open a GitHub issue…** saves the report, then opens a new issue on
  [AntoineToussaint/lazybox](https://github.com/AntoineToussaint/lazybox/issues)
  in your browser, filled in with it. Read it, attach the saved files if you
  like, and post it yourself.

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
| Versions differ in Settings → Updates | **Move the Runner now** there, or quit and reopen Lazybox: it moves the Runner to its own version. Or `lazybox service install`. Agents keep running. |
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

The installed app is separate from the [Dev and Working environments](../ENVIRONMENTS.md)
used to develop Lazybox: its own app identity (`ai.lazybox.app`), state,
Runner and launchd job. `lazybox runners` lists every Runner the CLI can
reach; with several, it uses the installed one, then Working.
