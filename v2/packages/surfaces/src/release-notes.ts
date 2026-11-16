import type { Release } from './onboarding-model';

/**
 * The release notes bundled with the app, newest first. "What's new" shows
 * the releases newer than the last one this person saw (onboarding-model.ts).
 *
 * Generated from v2/CHANGELOG.md by `node scripts/release/changelog.mjs --write`:
 * edit the changelog, not this file.
 */
export const releaseNotes: readonly Release[] = [
  {
    id: '2026-11-17.6',
    date: '2026-11-17',
    title: 'Let an agent run agents, within limits you set',
    items: [
      { title: 'An orchestrator', body: 'Type /orchestrate (or ⌘K, Let this conversation run agents…) to let one conversation start and drive agents for a mission: how many at once, their permission (never above its own), their subscriptions and a budget. Its header shows Orchestrator 2/3; click it for its agents and Revoke.' },
      { title: 'Only the agents it started', body: 'It messages, waits on and stops only its own agents (lazybox agents spawn, send, wait, watch, stop). It never approves, answers for you, passes a gate or accepts a task: its agents ask you, and you accept their work.' },
      { title: 'Messages read as theirs', body: 'A message between an orchestrator and its agent is an event from that agent, opening to exactly what was sent, with Open to go to it. An agent\'s header leads back to its orchestrator, and the board shows who started each task.' },
      { title: 'Approve the plan first', body: 'The orchestrator proposes its split (tasks, paths, order, estimate); you approve it once, with a $ cap and how many agents at once, on one sheet that flags paths two tasks would both change. It starts only the plan\'s tasks.' },
      { title: 'A budget that holds', body: 'Each agent reserves its estimate against the cap; past it, new agents pause and the board asks you to raise it. Every task shows what it cost against its estimate.' },
    ],
  },
  {
    id: '2026-11-17.5',
    date: '2026-11-17',
    title: 'Panels from the keyboard',
    items: [
      { title: 'Move between panels with arrows', body: '⌥⌘ and an arrow moves the focus to the panel group on that side; a ring shows where you are, and a screen reader says it. ⌥⇧⌘ and an arrow moves the panel into that group, or swaps two panels, and ⌃⌘ and an arrow moves the group\'s edge (held down, it keeps going, faster).' },
      { title: 'Tabs by number', body: '⌃1 to ⌃8 bring a tab of the group you are in to the front, and ⌃9 the last one; ⌘1 to ⌘9 still go to workspaces.' },
      { title: 'A + on every group', body: 'The + after a group\'s tabs (or ⌘T) starts a conversation that shows in that group, or opens any panel there.' },
      { title: 'Maximized stays maximized', body: 'While a panel is maximized, moving the focus, ⌘J, ⌘] and opening a conversation keep it maximized and show the new one.' },
      { title: 'One key to get back', body: '⌃⌥⇧Esc puts back the default layout and the default shortcuts at once, with Undo; it is the one shortcut that cannot be changed.' },
      { title: 'Split beside, fixed', body: '⌘\\ on a panel that shares its group now splits it out at once, and on a lone panel the panel you pick opens beside it.' },
    ],
  },
  {
    id: '2026-11-17.4',
    date: '2026-11-17',
    title: 'Your phone tells you, and you answer from the Inbox',
    items: [
      { title: 'Notifications on your phone', body: 'Turn them on in the phone\'s Inbox and it tells you when an agent asks a question, waits for approval or fails, even with Lazybox closed. Choose the kinds, set quiet hours, send a test; a tap opens the conversation, ready to answer. On an iPhone, add Lazybox to the Home Screen first (iOS 16.4 or later); the phone shows how.' },
      { title: 'Answer from the Inbox row', body: 'Allow or Deny an approval, or tap a question\'s option, without opening the conversation. Undo stays a few seconds before the answer goes, and a command flagged as risky asks first, on the row and in the conversation.' },
      { title: 'Swipe the phone\'s Inbox', body: 'Right to allow or pin, left to mark read or stop a turn; a long press or ⋯ shows every action, and pulling down refreshes.' },
      { title: 'Follow a command from the phone', body: 'The commands an agent runs are listed under the conversation\'s title; tap one to follow its output live.' },
      { title: 'Which phones are notified', body: 'Settings → Devices shows each phone\'s notifications and can send it a test.' },
    ],
  },
  {
    id: '2026-11-17.3',
    date: '2026-11-17',
    title: 'A quieter, clearer conversation',
    items: [
      { title: 'Lazybox\'s messages are events, not yours', body: 'What Lazybox tells an agent (a repository you added, review findings, a question from the other agent, a mission task) is one line with an icon, such as Added authority to this workspace with its branch, the path on hover and to copy; it opens to exactly what the agent received. Never a You message.' },
      { title: 'Restarts stay quiet', body: 'A Runner restart that interrupted nothing is a small mark, not a line per restart; one that left something uncertain says so in one line.' },
      { title: 'Background work counted right', body: 'The background work list counts sub-agents and commands apart (2 sub-agents · 17 commands · 0 running · 1 failed), shows the newest first, folds older finished ones, and names a command by what the agent said it does, whole.' },
      { title: 'What your tokens cost, part by part', body: 'The usage popover shows input, cache read, cache write and output with their tokens and cost, how much input the cache served, and for usage without a price, which model and why.' },
    ],
  },
  {
    id: '2026-11-17.2',
    date: '2026-11-17',
    title: 'Put windows back where they came from',
    items: [
      { title: 'Put back in main window', body: 'A chat in its own window and a panel group opened in a new window now lead with a labelled Put back in main window button (or ⇧⌘D, or Window → Put Back in Main Window): the panel returns exactly where it was, and the main window comes forward on it.' },
      { title: 'Closing a window puts it back', body: 'Closing a chat\'s window or a panel\'s window returns its panel to the main window; nothing is lost, even when the window closed while the main window was not open.' },
      { title: 'In other windows', body: 'A quiet strip under the header lists what is open in other windows, with Show, Put back and Put all back; the command palette has Put all windows back and Put … back in main window for each.' },
      { title: 'The sidebar keeps its width', body: 'Switching to a workspace whose page has no panel docked beside the sidebar (all closed, floating or in other windows) no longer stretches the sidebar across the page: an empty area with the page\'s options takes the rest.' },
    ],
  },
  {
    id: '2026-11-17.1',
    date: '2026-11-17',
    title: 'Servers never hold up a conversation',
    items: [
      { title: 'Servers go to the background', body: 'When an agent starts a dev server or a watcher with lazybox run, it moves to the background once it is up (after 20 seconds, when it listens on a port or looks like a server): the agent carries on, the server keeps running, and it shows in Command output and Processes with its port and Stop.' },
      { title: 'Move to background', body: 'The live bar offers it for a server the agent is still waiting on; Processes and the console stop it like any command.' },
      { title: 'Run a server from a code block', body: 'Run asks the agent to start it in the background, Run myself starts it there; the block shows its port with Open preview and Stop, and uses the workspace\'s action when one runs the same command.' },
      { title: 'Queued messages you can act on', body: 'A message you send while the agent works waits above the message box: Send now stops the current step and sends it next, and Codex conversations can Steer it into the running turn.' },
    ],
  },
  {
    id: '0.1.0',
    date: '2026-11-17',
    title: 'Install Lazybox like any Mac app',
    items: [
      { title: 'A real installer', body: 'Download the disk image, drag Lazybox to Applications and open it, or brew install --cask lazybox-v2 from the lazybox tap. Nothing else to install: the app brings its Runner, the Claude worker and the Node it runs on.' },
      { title: 'Agents keep working when the window is closed', body: 'On first launch Lazybox asks once to set up its background service, the Runner. It starts when you log in, keeps your agents running when you quit the app, and an update restarts it without stopping them.' },
      { title: 'The lazybox command, everywhere', body: 'Lazybox offers to put lazybox on your PATH with shell completions, no administrator password needed. lazybox doctor checks the service, versions, providers, GitHub and disk space and says what to do about anything wrong; lazybox service and lazybox uninstall manage the rest.' },
      { title: 'The documentation, in the app', body: 'Help → Documentation opens the guides and references offline, with search; links between pages and Back work as in a browser.' },
      { title: 'Updates that explain themselves', body: 'When a new version is out, the header says so. Read what\'s new, then Restart to update: the app and its Runner move to the new version together, and Settings → About shows the one version they share.' },
    ],
  },
  {
    id: '2026-11-16.3',
    date: '2026-11-16',
    title: 'See more without leaving your place',
    items: [
      { title: 'Git state on workspace rows', body: 'Each workspace shows its branch, how far it is ahead of or behind its upstream and the default branch, uncommitted changes, and its pull request with a checks dot. The agent line shows what the conversation is doing instead of the model name.' },
      { title: 'Peek', body: 'Alt-click a conversation, sub-agent, command, artifact or file, or press Space on a focused row, to look at it over the current page. ⌘Enter opens it, ←/→ peeks the next one, Esc closes.' },
      { title: 'Side-by-side diff', body: 'Changes can show a split diff with word-level highlights and collapsed unchanged lines. n and p jump between hunks, and you can tick files as viewed. Review comments work in both views.' },
      { title: 'Welcome and Help', body: 'A first-run welcome shows how to connect a subscription, add a repository and the five keys that matter. Reopen it, these notes or your shortcuts from Help (?) in the header.' },
    ],
  },
  {
    id: '2026-11-16.2',
    date: '2026-11-16',
    title: 'Watch the work as it happens',
    items: [
      { title: 'One live bar for the running turn', body: 'Sub-agents and background commands are visible while they run, and you can stop any of them.' },
      { title: 'Links open in your browser', body: 'Clicking a web link in the desktop app opens it in your default browser.' },
      { title: 'Zoom', body: '⌘= / ⌘- / ⌘0 zoom the desktop app.' },
    ],
  },
  {
    id: '2026-11-16.1',
    date: '2026-11-16',
    title: 'Missions, artifacts and your phone',
    items: [
      { title: 'Missions', body: 'An event log per mission, a board derived from it, and acceptance from the inbox.' },
      { title: 'Artifacts', body: 'Track plans and reports as versioned artifacts, from a message, a file or an agent.' },
      { title: 'Control your Runner from your phone', body: 'Pair a phone by QR code over Tailscale to follow and answer your conversations.' },
      { title: 'Settings', body: 'A Settings sidebar, a real pricing table, and when a limited subscription is back.' },
    ],
  },
];
