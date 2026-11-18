# Lazybox V2 — handoff (2026-11-18)

State at the end of the 2026-11-17 coordinator session. Every agent stopped at
the weekly usage limit (resets **2026-11-21 07:00 Europe/Paris**). Nothing is lost:
unfinished work is committed as `wip(v2): …` on its branch.

## Where things are

| Thing | Where |
| --- | --- |
| Main development branch (Dev runs it) | `feat/v2-command-output` in this monorepo (`v2/`), pushed to `AntoineToussaint/lazybox-v1` |
| **Public preview repo** | https://github.com/AntoineToussaint/lazybox: two commits, made with `make -C v2 export-repo`. **CI is green** (UI gates on Linux; Go and desktop on macOS) |
| The Hub | `~/development/lazybox-hub`: a local repo with **no remote**; branch `feat/hub-mvp` |
| Designs | `v2/MOBILE_CLOUD_HUB.md` (iPhone, cloud, Hub), `v2/REMOTE_RUNNERS.md` (other computers; the Hub link in §12), `v2/audits/2026-11-17-competitive/README.md` (where we stand), `v2/CLAUDE_COMPLIANCE.md` |
| Real-agent evidence | `v2/RUNTIME_EVIDENCE.md`, "Real Claude and Codex before the first preview" (all passed, 2026-11-17) |

## How to publish an update to the public repo

The public repo has normal history now, so never force-push it.

```sh
D=/private/tmp/claude-501/lazybox-public   # or a fresh clone of AntoineToussaint/lazybox
make -C v2 export-repo DEST=$D REF=feat/v2-command-output
cd $D && rm -rf node_modules && git add -A && git commit -m "…" && git push origin main
```

The export fails if it finds the employer's name, and `scripts/export-check.mjs`
checks every command and link in the README and contributor docs. Push with the
personal account's token: `GH_TOKEN=$(gh auth token --user AntoineToussaint)`.

## In flight: resume these first (each branch has an agent worktree under `.claude/worktrees/`)

1. **iPhone app:** `feat/v2-iphone-app` (worktree `agent-a23eb66e081c18a92`).
   - **Done:**
     - shared phone view-models in client-core;
     - an Expo app in `v2/apps/mobile` (pair, inbox, live conversation, allow/deny/answer, Send and Send now);
     - the iOS simulator runtime downloaded.
   - **WIP, unverified:** the simulator end-to-end (`scripts/test-mobile-simulator.mjs`), the fixture `scripts/mobile-fixture.mjs`, a Go `simulator_test.go`, the README and the docs.
   - **Next:**
     - finish and verify the simulator run **headless**: never open Simulator.app or React Native DevTools on the person's screen; that happened once and they disliked it;
     - record the spike results in MOBILE_CLOUD_HUB.md;
     - rebase and merge.
   - Push, Live Activities and TestFlight need the paid Apple Developer account.
2. **Remote P0a, Linux Runner:** `feat/v2-linux-runner` (worktree `agent-a9d2c2d2eb1d532ba`).
   - **Done, 4 commits:** builds and tests on Linux; a systemd scope per session host; a systemd user service; Linux release tarballs.
   - **WIP:** the Linux CI job, the export rewrite and the docs.
   - **Next:**
     - verify on an OrbStack Ubuntu VM (`lazybox-test-*`) that the outlive-restart test passes **on Linux**;
     - check that the CI job runs;
     - merge.
3. **Remote P0b, owner link over SSH:** `feat/v2-runner-link` (worktree `agent-aa6e42924c6aef8c5`).
   - **Done:** Noise IK owner link, stdio serve, `lazybox remote add/ls/rm`.
   - **WIP:** the desktop "Add a computer…" UI, the grouped sidebar, the CLI reference and `docs/guides/remote-computers.md`.
   - **Next:**
     - finish the UI;
     - end-to-end over SSH: localhost, or OrbStack once P0a is in;
     - merge after P0a.

To resume, open the worktree and continue from its last commit and REMOTE_RUNNERS.md P0. Always rebase onto `feat/v2-command-output` before merging, and expect conflicts in `CHANGELOG.md` and the generated `release-notes.ts` (regenerate with `node scripts/release/changelog.mjs --write`) and in the generated proto code (run `make generate`).

## Paused: the Hub (`~/development/lazybox-hub`, `feat/hub-mvp`)
- **What it is:** a Codefly workspace composing `codefly-dev/module-saas-starter` (pinned 0.0.118, not forked) plus a `hub` module, a Go service with its own Postgres.
- **Built and tested (17 cases, in-memory and Postgres):** the Runner directory, enrolment tokens, signed heartbeats, device introductions. The Hub stores public keys only and can't admit a device on its own.
- **Not done:**
  - running under Codefly;
  - audit wired to the starter;
  - push, the relay and managed VMs;
  - the Lazybox side (`lazybox hub enrol`; design in REMOTE_RUNNERS.md §12).
- **Upstream gaps in the starter:** listed in its HUB.md.
- **Priority:** the person said **remote and iPhone first, the Hub after**.

## The person's open decisions
- **The Hub:** hosting (Kubernetes for the starter, Fly.io for relay and push), the domain (`hub.lazybox.ai`, which becomes the passkey domain), an Apple push key (Developer account, $99/year), preview pricing, and amending decision C17.
- **Remote design §11** (14 items): the recommendations are written there, notably per-device keys, the system OpenSSH, and never bundling Claude Code on hosts.
- **`AntoineToussaint/lazybox-v1` is public and still contains internal/employer names.** Making it private erases its 6 stars and detaches its 5 forks. Not done; it needs the person's explicit go.
- **Claude:** whether to bundle Claude Code in signed releases (recommendation: no, until Anthropic confirms), and whether to send the five questions in CLAUDE_COMPLIANCE.md to Anthropic.
- **Licence:** LICENSE is proprietary. The README's "Preview terms" let people build, install and evaluate. Choosing a real licence is the person's.

## Housekeeping
- **Backup:** a private backup of Dev's settings and the shared account store, **including credentials**, was taken before the Claude-compliance migration: `/private/tmp/claude-501/-Users-antoine-development-lazybox-v2/7d99cd35-4404-47a3-9781-b400f27c5aa3/scratchpad/dev-state-backup-1648` (306 MB). Delete it once the person confirms their Claude accounts and switching still work in Dev.
- **About 23 agent worktrees** remain under `.claude/worktrees/`. Most are for branches already merged, left with rebase residue. Remove a worktree only after checking `git -C <wt> log feat/v2-command-output..HEAD` is empty and its status is clean.
- **Dev:** SIGINT the `scripts/environments.mjs dev` pid, then `make dev`. After any dependency install in the main checkout, restart Dev (Vite caches).

## Rules that bit us (keep following them)
- Rebase and verify in a worktree. Only fast-forward the main checkout, which Dev watches. Batch Go merges, since each restarts Dev's Runner.
- Never run `make deps` or `npm ci` in the main checkout without restarting Dev afterwards.
- Never run broad `pkill`. Never expose a Runner beyond loopback or tailnet. Never commit secrets. Never name the employer anywhere (the exporter fails on it).
- Agents must not open windows on the person's screen (DevTools, Simulator.app, browsers).
- UX first: every change closable, movable, resizable, keyboard-reachable, quiet.
- The person's uncommitted V1 changes in the monorepo (`crates/…`, `docs/features/terminals-and-agents.md`, `docs/snippets.md`, `crates/config/src/bin/`) are theirs; never stage them.
