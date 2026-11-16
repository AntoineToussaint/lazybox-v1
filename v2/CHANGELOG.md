# Lazybox changelog

What changed for people using Lazybox, newest first. This file is the one
source for the release notes: the GitHub release of a version shows its
section (and the dated sections below it, up to the previous version), and
the app's **What's new** shows every section a person has not seen yet
(`packages/surfaces/src/release-notes.ts` is generated from it by
`node scripts/release/changelog.mjs --write`; `make -C v2 release` refuses
a changelog and app notes that disagree).

Each section is `## [id] - date · title`, where id is a released version
(`0.1.0`) or, for notes shipped to Dev and Working between releases, the date
and a counter (`2026-11-16.3`). An id never changes once shipped. Each item is
one line `- **What** body`, saying what a person can now do; a long item may
continue on lines indented by two spaces.

## [2026-11-17.2] - 2026-11-17 · Put windows back where they came from

- **Put back in main window** A chat in its own window and a panel group opened in a new window now lead with a labelled Put back in main window button (or ⇧⌘D, or Window → Put Back in Main Window): the panel returns exactly where it was, and the main window comes forward on it.
- **Closing a window puts it back** Closing a chat's window or a panel's window returns its panel to the main window; nothing is lost, even when the window closed while the main window was not open.
- **In other windows** A quiet strip under the header lists what is open in other windows, with Show, Put back and Put all back; the command palette has Put all windows back and Put … back in main window for each.
- **The sidebar keeps its width** Switching to a workspace whose page has no panel docked beside the sidebar (all closed, floating or in other windows) no longer stretches the sidebar across the page: an empty area with the page's options takes the rest.

## [2026-11-17.1] - 2026-11-17 · Servers never hold up a conversation

- **Servers go to the background** When an agent starts a dev server or a watcher with lazybox run, it moves to the background once it is up (after 20 seconds, when it listens on a port or looks like a server): the agent carries on, the server keeps running, and it shows in Command output and Processes with its port and Stop.
- **Move to background** The live bar offers it for a server the agent is still waiting on; Processes and the console stop it like any command.
- **Run a server from a code block** Run asks the agent to start it in the background, Run myself starts it there; the block shows its port with Open preview and Stop, and uses the workspace's action when one runs the same command.
- **Queued messages you can act on** A message you send while the agent works waits above the message box: Send now stops the current step and sends it next, and Codex conversations can Steer it into the running turn.

## [0.1.0] - 2026-11-17 · Install Lazybox like any Mac app

- **A real installer** Download the disk image, drag Lazybox to Applications and open it, or brew install --cask lazybox-v2 from the lazybox tap. Nothing else to install: the app brings its Runner, the Claude worker and the Node it runs on.
- **Agents keep working when the window is closed** On first launch Lazybox asks once to set up its background service, the Runner. It starts when you log in, keeps your agents running when you quit the app, and an update restarts it without stopping them.
- **The lazybox command, everywhere** Lazybox offers to put lazybox on your PATH with shell completions, no administrator password needed. lazybox doctor checks the service, versions, providers, GitHub and disk space and says what to do about anything wrong; lazybox service and lazybox uninstall manage the rest.
- **The documentation, in the app** Help → Documentation opens the guides and references offline, with search; links between pages and Back work as in a browser.
- **Updates that explain themselves** When a new version is out, the header says so. Read what's new, then Restart to update: the app and its Runner move to the new version together, and Settings → About shows the one version they share.

## [2026-11-16.3] - 2026-11-16 · See more without leaving your place

- **Git state on workspace rows** Each workspace shows its branch, how far it is ahead of or behind its upstream and the default branch, uncommitted changes, and its pull request with a checks dot. The agent line shows what the conversation is doing instead of the model name.
- **Peek** Alt-click a conversation, sub-agent, command, artifact or file, or press Space on a focused row, to look at it over the current page. ⌘Enter opens it, ←/→ peeks the next one, Esc closes.
- **Side-by-side diff** Changes can show a split diff with word-level highlights and collapsed unchanged lines. n and p jump between hunks, and you can tick files as viewed. Review comments work in both views.
- **Welcome and Help** A first-run welcome shows how to connect a subscription, add a repository and the five keys that matter. Reopen it, these notes or your shortcuts from Help (?) in the header.

## [2026-11-16.2] - 2026-11-16 · Watch the work as it happens

- **One live bar for the running turn** Sub-agents and background commands are visible while they run, and you can stop any of them.
- **Links open in your browser** Clicking a web link in the desktop app opens it in your default browser.
- **Zoom** ⌘= / ⌘- / ⌘0 zoom the desktop app.

## [2026-11-16.1] - 2026-11-16 · Missions, artifacts and your phone

- **Missions** An event log per mission, a board derived from it, and acceptance from the inbox.
- **Artifacts** Track plans and reports as versioned artifacts, from a message, a file or an agent.
- **Control your Runner from your phone** Pair a phone by QR code over Tailscale to follow and answer your conversations.
- **Settings** A Settings sidebar, a real pricing table, and when a limited subscription is back.
