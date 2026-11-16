# Several Runners in one window

Status: design, with the first step shipped (2026-11-16). herdr shows the
spaces and agents of several machines in one sidebar, grouped by machine
([audit P2-2](audits/2026-11-16/herdr-gui.md#p2--later-or-strategic)).
Lazybox's equivalent is one window that lists several Runners — Dev and
Working on this machine, and Runners on other machines — and groups
workspaces and agents by Runner.

## What exists

- Every Runner is independent: its own state, credentials and endpoint file.
  The desktop app is bound to one Runner per launch (`--endpoint`), follows it
  across restarts, and keeps per-Runner view state (`viewRoot` is derived from
  the Runner's authority).
- A Runner can already be reached from another device, safely: the device
  gateway serves paired devices over Tailscale with scoped, revocable device
  credentials ([remote control](REMOTE.md)). It never accepts the owner's
  bearer and never listens on the LAN.

## Step 1 (shipped): the CLI knows every Runner

- The Dev and Working launchers record a locator per environment in
  `~/.config/lazybox/runners/<name>.json` (`scripts/user-config.mjs`): the
  path of its private endpoint file, never a credential.
- `lazybox runners` lists them with their state (running or not);
  `--runner NAME` (or `LAZYBOX_RUNNER`) picks one; `lazybox ls --all` lists the
  workspaces, conversations and agents of every running Runner, grouped by
  Runner — the sidebar this design asks for, in text.

## Step 2: local Runners in one window

The desktop host reads the same locators and offers a **Runner switcher** at
the top of the sidebar (Dev · Working), then a **grouped sidebar**: one
collapsible section per Runner, its workspaces under it, its attention counts
on its header.

- **One connection per Runner.** `RunnerProvider` becomes keyed by Runner:
  each section has its own `RunnerLink` (its own bearer, renewal, restart
  following). Nothing mixes credentials: a conversation is always addressed as
  (Runner, id), and a panel bound to a conversation keeps its Runner in its
  binding (`ViewTarget.runner`).
- **View state** is already per Runner authority; layouts gain a `runner` field
  in targets, defaulting to the window's original Runner so saved layouts load
  unchanged.
- **Attention** sums across Runners for the dock badge and notifications; the
  inbox groups by Runner when more than one is connected.
- **Native host:** `runner_bootstrap` returns a list; each endpoint is
  validated as today (loopback origin, owner-only file). A Runner that is not
  running is shown greyed with "Not running — start it with `make -C v2 dev`".

Effort: L. Owners: the layout upgrade (dockview) and the sidebar's Agents
section must take a `runner` dimension first; do this after they land.

## Step 3: Runners on other machines

A remote Runner is reached through **its device gateway**, as a phone reaches
it — never with its owner bearer, which must not leave its machine.

- **Pairing:** Settings → Runners → *Add a Runner on another machine* shows
  the same QR/one-time code flow as a phone, but the desktop pairs itself as a
  device with a non-extractable key (the Tauri host keeps it in the macOS
  Keychain). Grants are chosen at pairing (read, respond, start).
- **Transport:** Tailscale, as for phones (REMOTE.md's decision). The desktop's
  native HTTP client is allowed exactly the paired gateway's `https://*.ts.net`
  origin.
- **What a remote section can do** is what its grants allow; everything else
  (settings, files, terminals, processes) is greyed with "Not available on a
  remote Runner". Extending the device allowlist (files, diffs) is a separate,
  explicit decision with its own threat model update.
- **CLI:** `lazybox --runner work-laptop` uses a device credential stored by
  `lazybox pair <code>`, with the same grants.

Effort: L, after step 2. Open questions: a desktop's device key lifetime and
rotation; whether a remote Runner may push notifications through the local
one (no — each Runner notifies its own windows).

## Not doing

- Proxying one Runner through another: each Runner stays the only authority
  over its machine.
- Sharing the owner bearer between machines, or a LAN listener.
