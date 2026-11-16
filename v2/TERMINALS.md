# Workspace terminals

A terminal is your login shell, running on the Runner, in a workspace: at its
root or in one of its repositories. It is for you, not for agents: agents run
managed commands (`lazybox_command`), and no agent tool can open, read or type
into a terminal.

## Use it

- **Terminal** in the workspace header shows the page's **Terminal** panel and
  puts the keyboard in it. With no panel, it docks one on the right of the work
  (or where you last docked a terminal). It starts a shell in the workspace
  root only when none is running; otherwise it focuses the running one. It
  never adds a second panel.
- The panel header moves it like any other panel (see
  [Arrange panels](WORKSPACES.md#arrange-panels)). Its **×** closes the
  *panel*: shells keep running and re-attach when the panel comes back.
- In the panel, pick a directory (**Workspace root** or a repository) and press
  **New terminal** for another shell. Tabs switch between them; a tab's **×**
  closes that shell (it hangs up the shell, as closing a terminal window does).
- **Page actions (⋯) → Show panel → Terminal**, or **Customize page → Add
  panel**, also add it. Opening or restoring the panel never starts a shell; it
  shows the workspace's running terminals.
- A reload, another window, or a Runner restart re-attaches to the same shell
  and shows its recent output.

The shell gets the workspace through `LAZYBOX_V2_COLLECTION_ID` but no Runner
endpoint: anything started in it, such as an agent CLI run by hand, would
otherwise inherit the owner's authority over the Runner. To use the `lazybox`
CLI from the shell, pass `--endpoint` explicitly.

## How it works

```
Panel (xterm.js)  ──WatchTerminal (stream, by byte offset)──┐
                  ──WriteTerminal / ResizeTerminal (unary)──┤
Runner            terminals.Manager: bounded scrollback per terminal, a record per
                  │ running terminal in <state>/terminals/
Session host      one per terminal, in <state>/terminal-hosts/
                  │ owns the pseudo-terminal and its own bounded scrollback
Login shell       session leader, the terminal as its controlling terminal
```

- RPCs: `OpenTerminal`, `ListTerminals`, `WatchTerminal`, `WriteTerminal`,
  `ResizeTerminal`, `CloseTerminal` (`services/runner/proto/api.proto`). They are
  only reachable through the Runner's authenticated API, like every other RPC.
- The directory is resolved on the Runner and must stay inside the workspace
  after symbolic links are resolved; `..`, absolute paths and links out of the
  workspace are refused.
- The shell is `$SHELL` if it names an executable, else `/bin/zsh`, else
  `/bin/sh`, started as a login shell (`argv[0]` is `-zsh`).
- The environment is the Runner's (that is, yours) minus Runner configuration and
  service wiring: every inherited `LAZYBOX_V2_*`, every `CODEFLY*` (including
  Codefly's scoped auth secret), the launching terminal's identity
  (`TERM_PROGRAM`, …), `PWD`, `OLDPWD`, `SHLVL` and `CLAUDECODE`. It adds
  `TERM=xterm-256color`, `COLORTERM=truecolor` and `LAZYBOX_V2_COLLECTION_ID`,
  never `LAZYBOX_V2_ENDPOINT`. Credentials a managed account profile injects for
  agents are never added.
- `OpenTerminal` takes a request key: a retried request returns the shell it
  already started instead of starting a second one.
- Deleting a workspace hangs up its terminals before its files are removed.

### Surviving a Runner restart

A terminal runs in its own [session host](SESSION_HOSTS.md), exactly like agents
and managed commands, so a Runner restart, crash or upgrade does not reach the
shell. `Bench.Detach` leaves terminals running; the next Runner re-attaches them
when it opens (records in `<state>/terminals/`). `Bench.Close` and ephemeral test
Runners hang them up. A host with no Runner attached for 24 hours stops its shell
(`DefaultOrphanAfter`).

Terminal output is a view, not evidence: it is not journalled, and nothing is
recorded "exactly once". When a Runner attaches, the host acknowledges everything
it has read and sends its scrollback in the welcome; live output continues from
that offset, so each byte is shown once. Offsets are the host's byte count, so a
client can resume its stream across a Runner restart.

### Lifetime of the shell's processes

The shell is not under `processguard`: an interactive shell puts each job in its
own process group, which a group kill cannot reach. Its lifetime is bound the way
a terminal window binds it:

- **Close** sends SIGHUP to the shell's process group (the shell passes it on to
  its jobs), then SIGKILL after 2 seconds if the shell is still there. The shell
  is signalled only while it has not been reaped, so a reused PID is never hit.
- **Host exit** (killed, orphaned, or its directory deleted) closes the terminal,
  which hangs up the shell.
- After the shell exits, output still in the terminal is delivered; a background
  job that keeps the terminal open is not waited for longer than a second.

A process that ignores SIGHUP and left the shell's session (`nohup`, `setsid`,
`disown`) keeps running, as it would after closing any terminal.

The session host ignores SIGHUP, SIGINT and SIGPIPE, and an ignored signal stays
ignored across `exec`. A terminal host therefore handles those signals itself
before starting the shell, so the shell and its programs start with the default
dispositions and Ctrl-C works. `TestTerminalHostRunsAnInteractiveProgram` fails
without this.

## Limits

- At most 16 running terminals per Runner (`maxLiveTerminals` in the Runner
  config). Exited terminals stay listed until closed.
- Scrollback: the last 1 MiB of output per terminal, on the Runner and in the
  host. The panel keeps 5,000 lines.
- Input is at most 64 KiB per request; the panel splits larger pastes.
- Workspaces only: there is no terminal for an empty-workspace session or an
  arbitrary directory.
- A machine reboot ends every terminal.
- After a rollback to a release without terminals, running shells are not
  shown; their hosts stop them after the 24-hour orphan limit.
- Not verified yet: a live Runner restart in Dev with a terminal open (the
  restart path is covered by `TestTerminalOutlivesTheRunner`, which detaches and
  re-opens the manager in one process); the Tauri desktop window (the panel is
  tested in WebKit and Chromium through Playwright).

## Tests

| Command (from `v2/`) | What it covers |
| --- | --- |
| `cd services/runner/code && go test ./internal/sessionhost -run Terminal` | PTY mode: controlling terminal, size, default signals, input, resize, exit code, hang-up, bounded scrollback handed over once |
| `cd services/runner/code && go test ./internal/runner/terminals` | A real `/bin/sh`: input, cwd, environment, resize (`stty size`), exit, re-attachment after detach, close, directory confinement |
| `cd services/runner/code && go test ./internal/transport -run Terminal` | RPCs against a real workspace: refused directories, request-key retry, environment, close |
| `npm run test:terminal` | The panel against the fake Runner in WebKit (`TEST_CHROMIUM=1` for Chromium) |
