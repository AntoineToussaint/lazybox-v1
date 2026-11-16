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
