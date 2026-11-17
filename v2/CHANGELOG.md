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
continue on lines indented by two spaces. A big section groups its items under
`### Group` lines (every item then belongs to one); the release notes and
What's new show the groups as headings.

Dated sections keep landing at the top after a version's section is written.
The next version's release collects them: its notes run from its own section
down to the previous version. To release a version whose section is already
written, fold the dated sections above it into it first: `make -C v2 release`
refuses a version with dated sections above its own, which its notes would
leave out.

## [0.1.0-pre.1] - 2026-11-17 · The first prerelease

### Install and updates

- **A Mac app with everything inside** Download the disk image, open it and drag Lazybox to Applications. It brings its Runner, the Claude worker, Node and Claude Code: you only sign in.
- **Agents keep working when the window is closed** The first launch sets up the Runner, a background service that starts when you log in. Quit Lazybox and your agents keep going.
- **The lazybox command** Setup links lazybox into your PATH with completions, no password needed. If an older Lazybox installed by Homebrew comes first on your PATH, setup says so and offers to remove it, showing you brew uninstall lazybox first. lazybox doctor checks the service, versions, agents' sign-in and your PATH, and names the fix.
- **Updates you choose** The header says when a version is out and what changed. Install and restart moves the app and its Runner together without stopping agents; skip a version or be reminded later.
- **A Codex account in your browser** Settings → Subscriptions → Add subscription → Codex signs in on ChatGPT's page and continues by itself; a one-time code is there for another device.
- **Help, in the app** Help → Documentation opens the guides offline, with search; a first-run welcome shows the five keys that matter. Help → Send feedback writes a report you read first, and uploads nothing.
- **Codex, tested** Lazybox is tested with Codex 0.164 to 0.169; another version says so in one line at the start of a conversation instead of failing silently.
- **ACP agents are a preview** Gemini CLI, Goose and the other ACP agents are marked Preview in New conversation and Settings, and Settings → Agents says when an installed agent does not take the flag Lazybox starts it with. An agent's own commands, such as /compact, are in the / menu.

### Workspaces and tabs

- **Conversations are tabs** A workspace opens with its conversations as tabs, most recent first. A click brings one forward, ⌘-click opens one behind, and a tab you close stays closed. Prefer one preview tab? Settings → Chat.
- **Split, move, put back** Drag a tab to split, or right-click for Open beside, below or in a new window. Put back in main window (⇧⌘D) returns a panel exactly where it was.
- **Panels from the keyboard** ⌥⌘ and an arrow moves between panels, ⌃1 to ⌃9 pick a tab, ⌘T opens a conversation in the group you are in, and ⌃⌥⇧Esc puts back the default layout and shortcuts.
- **Sides you can resize** Drag the divider inside Changes, Artifacts, Settings and Documentation, or Tab to it and use the arrows; drag a list all the way in to fold it away.
- **Git state at a glance** Workspace rows show the branch, ahead and behind, uncommitted changes and the pull request's checks. Alt-click or Space peeks at a conversation, command or file.
- **Side-by-side diff** Changes shows a split diff with word-level highlights; n and p jump between hunks, and review comments work in both views.
- **Steadier panels and dialogs** A workspace whose saved pages cannot be read still opens, on the default layout, with a notice. Menus close on a click outside or Esc without closing what is under them, dialogs give the focus back, and red buttons read right in light mode.
- **Keys go where you look** With two conversations side by side, y, a or n answers the one you last used; ⌘\ and ⌥⌘←/→ belong to the editor only while you type in it. In the Inbox, a click outside keeps the note you are writing, and j and k stop on tasks and plans waiting for you.
- **New work starts from today's main** Adding a repository to a workspace (New task, Add repository, Start from an issue, lazybox new) first fetches its default branch from origin and starts the workspace's branch there, never from a stale copy or another branch; your checkout is not touched. Offline, it starts from the last main Lazybox knows and says so. A branch you chose to continue starts where you said.
- **New task in the header** The header's main button is New task ⌘N: repositories, an agent and what to do, in one sheet. The chat icon beside it starts a conversation in the workspace you are in (⇧⌘N), and the welcome's second step is Start a task.
- **Tabs behind stay out of the way** A conversation in a tab behind another no longer holds a live connection; it catches up the moment you bring it forward. In a browser window with many tabs, a review's card and the window's other reads no longer wait behind them.
- **Tidier agent rows** A conversation whose sub-agents are listed under it no longer repeats their count on its own line, and a sub-agent panel says Ended without a report once.
- **A clearer Missions board** The mission picker is a menu with each mission's progress, a working task leads with Open conversation, and the process reads One agent per task.

### Chat and Send now

- **Send now** While the agent works, ↵ queues your message and ⌘↵ sends it now: the current step stops and your message is the next turn. A queued message shows once, above the message box.
- **Who answers, and how full the context is** Under your message: the agent and model, and a context meter that turns amber at 60% and red at 85%. /model lists the models you can switch to.
- **Attachments are boxes** Files, images, PDFs and big pastes sit above the message as boxes you preview, reorder and remove. Claude, Codex and ACP agents all receive them.
- **A quieter conversation** What Lazybox tells an agent is one event line, a restart is a small mark, background work is counted, and the usage popover breaks down what tokens cost.
- **Long conversations open at once** The latest turns show first; earlier ones load behind them.
- **Command output stays on what you read** A new run never takes over the one you are reading; newer runs are offered in the panel's header.
- **Servers go to the background** A dev server an agent starts moves to the background once it is up, with its port and Stop in Command output and Processes.
- **Diagrams that render, or say why** A Mermaid diagram that cannot be drawn names the reason, and one that failed for a passing reason renders again by itself.
- **An agent that runs agents** /orchestrate lets one conversation start and drive agents for a mission: a plan you approve, a budget, and limits you set. The missions board shows their work as it happens.
- **Steer Claude mid-turn** A queued message has Steer for Claude, as for Codex: the agent reads it after the step it is on, without stopping. ⌘↵ still stops and sends.
- **Keyboard all the way** ⌘K commands keep your draft, the model under the message box opens /model from the keyboard, a restart asks in a card Enter confirms, and the Enter that confirms Japanese, Chinese or Korean input no longer sends.
- **A steadier conversation** No false Reconnecting when nothing is happening; text added while a message sends is kept; past 256 sub-agents the oldest finished ones make room; dismissed failures stay dismissed; typing in a long conversation no longer rescans it.
- **Compactions shown, errors in words** Codex's context compaction is one quiet line, as Claude's is, and a failure says what happened instead of raw connection errors.
- **Fewer debug details** The ⋯ menu names the subscription only when Lazybox knows it and a gateway only when it is not the direct one; New conversation shows Gateway only when the Runner has another; a question card shows the raw request only when Lazybox could not read the question.

### Review

- **Review from the chat** Review in the conversation's header, /review or ⌘K: another agent reviews the workspace's changes, read-only, in a tab beside the conversation.
- **The other agent reviews** Codex reviews Claude's work and Claude reviews Codex's, or choose a reviewer in Settings → Agents & workspaces.
- **Clean means clean** A review with majors still open says so, and Send findings puts them in the author's message box for you to send.
- **One review at a time** Review in the header and /review start through one launcher, so a double start never runs two reviews of the same work.

### Pull requests and issues

- **Every pull request tracked** The pull requests your agents open, push or link are tracked, with a pill in the header and one badge per sidebar row: checks failed, changes requested or ready to merge.
- **A Pull requests panel** Needs you, Waiting on others, Merged this week. Send the failing checks or the review comments to the agent in one click, always after your confirmation.
- **Start from an issue** Paste an issue's link into New task, or pick from your issues: the workspace is named after it, and you can read exactly what the agent gets.
- **Light on GitHub** Open pull requests are checked about every minute while Lazybox has your focus; an unchanged one costs nothing against GitHub's rate limit.

### Artifacts

- **Versioned artifacts** Track a plan or a report from a message, a file or an agent; each update is a version you can compare with the last.
- **Found from anywhere** A card in the conversation, a count in the chat header, ⌘K across every workspace, and All workspaces in the Artifacts panel.
- **Track the file an agent names** Right-click a Markdown file named in a message and choose Track as artifact: it stays in sync with the file.
- **Beside a chat in its own window** In a chat moved to its own window, an artifact's Open or Compare shows it beside the chat in that window; Esc closes it, Open in main window moves it.
- **Artifacts use the room** One title, the kind named once in the toolbar, a smaller header with author, date, version and reading time on one line, and a text column that takes the room there is. The outline shows from 900 px of reader, else On this page; nothing scrolls sideways down to 360 px.

### Voice

- **Hold Right ⌥ to talk** Hold it and speak, tap it twice to keep listening, once to stop. Pick another key in Settings → Voice.
- **Pauses are fine** What you said before a pause stays in the message box, and ⌘↵ waits for your last words before sending.

### Phone

- **Your conversations on your phone** Pair a phone by QR code over Tailscale to follow and answer your conversations, and follow a command's output live.
- **Notifications** Your phone tells you when an agent asks a question, waits for approval or fails, even with Lazybox closed. Choose the kinds and quiet hours.
- **Answer from the Inbox** Allow, deny or answer a question from its row, with a few seconds to undo; swipe for more.
- **Pairing offers what the phone can do** Pairing no longer offers Start conversations, which the phone has no screen for yet; a phone already paired with it keeps it.

### Extensions

- **Panels you add** An extension is a panel you write in HTML, JavaScript and CSS. It runs in a sandbox and does only what you allow, which Lazybox shows you in words first; the Agent board and the Cost dashboard are examples.
- **Hooks for pull requests** pr.opened, pr.checks-passed, pr.approved and pr.merged join the events your hooks can react to.
- **A cost dashboard you read at a glance** The Cost dashboard example shows a period's spend against the one before, tokens and the cache hit rate, a chart per day stacked by model, and where it went by model, workspace and conversation. Extensions read hourly usage with lazybox.usage.read({series: true}).

### Runner reliability

- **Agents outlive the Runner** Restarting or updating the Runner leaves agents, commands and terminals running; the new Runner picks them back up within seconds, and an approval that was waiting stays waiting.
- **Back after your Mac restarts** A conversation whose agent was running keeps its checkpoints, commands and queued messages, and resumes the agent's own session with your next message.
- **Said plainly when something is off** No network, a Runner on another version than the app, an update that did not finish: one sentence each, with the fix.

### Security

- **On this Mac only** The Runner answers only on loopback, to a credential in a file only you can read.
- **Updates are signed** An update installs only when it matches the key built into your copy of Lazybox; anything else is refused before anything changes.
- **GitHub text is information** An issue's text reaches the agent quoted as content from GitHub, not as instructions to follow.
- **An orchestrator never answers for you** It never approves, passes a gate or accepts a task, and its agents never get more permission than it has.
- **Feedback without secrets** A feedback report removes tokens, keys, passwords and e-mail addresses, and shows your home folder as ~.
- **Allow exactly what is asked** When Codex asks for the network or a folder outside its sandbox, the card names it and Allow grants just that, for the turn or the conversation. What you always allow in a Claude conversation outlives its agent; the session menu lists it, and × removes it.
