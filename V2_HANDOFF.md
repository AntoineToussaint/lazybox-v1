# Lazybox V2 — handoff and next work (2026-11-18)

Read this first when resuming V2 work. It covers: where everything is, how to
work safely, what is done, what is open, and the ranked backlog of all next
work with enough context to start each item.

The person's priorities, in their words: **remote and iPhone first, then the
Hub** ("with hub would make us money"). UX first on every change.

---

## 1. Where things are

| Thing | Where |
| --- | --- |
| Main V2 branch (Dev runs it) | `feat/v2-command-output` in this monorepo (`v2/`). Pushed to `AntoineToussaint/lazybox-v1` (public). |
| **Public preview repo** | https://github.com/AntoineToussaint/lazybox: built from `v2/` by `make -C v2 export-repo`. CI: UI gates on Linux; Go on macOS and Linux; desktop on macOS. |
| The Hub | `~/development/lazybox-hub`: a local repo with **no remote**, branch `feat/hub-mvp`. A Codefly workspace composing `codefly-dev/module-saas-starter`. |
| Design docs | `v2/MOBILE_CLOUD_HUB.md` (iPhone, cloud, Hub), `v2/REMOTE_RUNNERS.md` (other computers; Hub link in §12; P0 status), `v2/CLAUDE_COMPLIANCE.md`, `v2/audits/2026-11-17-competitive/README.md` (scorecard and kill list), `v2/PROJECTS_AND_INTEGRATIONS.md`. |
| Real-agent evidence | `v2/RUNTIME_EVIDENCE.md`, "Real Claude and Codex before the first preview" (2026-11-17: Claude Code 2.1.326 and Codex 0.169.0 passed everything, including surviving a Runner restart). |
| iPhone app | `v2/apps/mobile` (Expo); how to run it is in `v2/apps/mobile/README.md`. Simulator end-to-end: `npm run test:mobile-simulator` (by hand on a Mac; not CI). |
| Memory notes | `~/.claude/projects/-Users-antoine-development-lazybox/memory/` (the index is `MEMORY.md`). |

## 2. How to work here (rules that bit us)

- **Dev watches the main checkout.** Rebase, resolve and verify in a git worktree, and only fast-forward the main checkout. Batch Go merges, since each one restarts Dev's Runner (agents survive it).
- **Dependencies:** after a dependency change in the main checkout, `make deps`, then restart Dev. To restart: SIGINT the `scripts/environments.mjs dev` pid, then `make dev`. Vite caches failed imports.
- **Usual rebase conflicts:**
  - `CHANGELOG.md` and the generated `packages/surfaces/src/release-notes.ts`: regenerate with `node scripts/release/changelog.mjs --write`.
  - Generated proto code: `make generate`, then `make check-generated`.
  - `package.json` test lists and `scripts/fixtures/runner-ui.mjs`: union both sides.
  - Every npm `test:*` script must be in `scripts/release-gates.json`, as a gate or under `external`, or `release-gates.test.mjs` fails.
- **Changelog:** fold entries into the top `[0.1.0-pre.1]` section; never add a new dated section. `make release` refuses unfolded dated sections.
- **Check before merging:** `make fmt-check` (gofmt), `go vet ./...` and also `GOOS=linux go vet ./...`, `npm run typecheck`, `npm run test:client`, the touched UI suites (`npm run test:<suite>`), and `node --test scripts/release-gates.test.mjs`.
- **Never:**
  - broad `pkill`;
  - expose a Runner beyond loopback or tailnet;
  - commit secrets;
  - name the employer anywhere (the exporter fails on it);
  - stage the person's uncommitted V1 changes (`crates/…`, `docs/features/terminals-and-agents.md`, `docs/snippets.md`, `crates/config/src/bin/`);
  - let agents open windows on the person's screen (Simulator.app, RN DevTools, browsers).
- **Commits:** always on a branch, with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Pushing to GitHub:** with the personal account's token, without switching gh's global account:
  `GH_TOKEN=$(gh auth token --user AntoineToussaint) git -c credential.helper= -c "credential.helper=!f() { echo username=x-access-token; echo password=\$GH_TOKEN; }; f" push …`
- **Publishing to the public repo** (it has history now, so never force-push it):
  ```sh
  D=/private/tmp/claude-501/lazybox-public   # or a fresh clone of AntoineToussaint/lazybox
  make -C v2 export-repo DEST=$D REF=feat/v2-command-output
  cd $D && rm -rf node_modules && git add -A && git commit -m "…" && git push origin main
  ```
  Then watch CI (`gh run list -R AntoineToussaint/lazybox`).

## 3. Done in this stretch (all merged on `feat/v2-command-output`)

- **Public preview:**
  - `make install` / `update` / `uninstall` from a clone;
  - README, CONTRIBUTING and `docs/testers.md`;
  - preview terms;
  - CI simplified (UI on Linux).
- **Remote:**
  - **P0a, Linux Runner:** systemd user service, a systemd scope per agent, so agents survive a Runner restart; verified on Ubuntu (OrbStack). Linux tarballs; Linux CI job.
  - **P0b, owner link over SSH:** Noise IK; per-client keys; `lazybox remote add/ls/rm`; `lazybox link …`; desktop "Add a computer…"; sidebar grouped by machine; verified over real ssh to Linux.
- **iPhone:** an Expo app with pairing, the Inbox, a live conversation, Allow/Deny/answer, and Send/Queue/Send now/Stop. Verified on the simulator against the fixture and the real device gateway. Spike results are in MOBILE_CLOUD_HUB.md.
- **The Hub:** paused at a tested core (Runner directory, enrolment, heartbeats, introductions; public keys only).
- **Claude compliance:**
  - API-key mode;
  - Lazybox-offered Claude sign-in gated off for new installs;
  - token import refused;
  - automatic switching moved to an opt-in "Subscription rotation" extension;
  - existing setups carried over with a notice.
- **Subscriptions:**
  - switching reaches accounts signed in after a conversation started, by hand and automatically;
  - grouped by provider everywhere;
  - the header chip opens the switcher.
- **Workspaces:**
  - home checkouts;
  - Run opens a real terminal, waits for the prompt, runs once, reuses an idle shell;
  - terminal links are clickable, wrapped URLs included;
  - new workspaces start from fresh `origin/<default>`;
  - drag to reorder (⌥⇧↑/↓);
  - a rich hover card.
- **Agents:**
  - agents ask (one click) to start conversations (`lazybox conversation new`);
  - Claude steering mid-turn;
  - "Always allow" persists;
  - Codex permission accept and version notice;
  - ACP labelled Preview;
  - "Give Claude the browser" and Preview :port;
  - artifact retire/merge (`--supersedes`).
- **Polish:**
  - no text selection when resizing, through one shared drag gesture;
  - artifact viewer density;
  - the Cost dashboard;
  - keyboard-only `/model` and `/permissions`;
  - the scroll-fighting fix;
  - many red gates and races fixed.

## 4. Just merged; check in the real app

- **No separate title bar** (`e614d6f8e`, `776a0d42f`). Overlay title bar: the traffic lights sit inside each window's header, with our own drag and double-click handling, full-screen handling, and every window kind (main, workspace, chat/console/artifact, web, popped-out panels, setup).
  - It passed in fixtures and `cargo test`, but **was never run in the real window**.
  - Check:
    - centring on several macOS versions;
    - full screen in and out;
    - double-click with each System Settings choice;
    - dragging a background window;
    - popped-out panels;
    - zoom other than 100%;
    - the setup window.
  - Details are in RUNNING.md and `apps/desktop/src-tauri/src/title_bar.rs`.
- **Run in terminal** (`fix/v2-run-in-terminal`): it waits for zsh's prompt (OSC 133;B) or for output to settle. Check it with the person's powerline or p10k theme. If their theme replaces the prompt hook, the 1.5 s fallback applies.
- **Public repo:** last pushed at `e1196d2` (the remote, Linux, iPhone and fixes export plus a spelling fix). CI was running when this was written; check it's green.

## 5. Waiting on the person (decisions and accounts)

1. **Apple Developer Program** ($99/year): needed for iPhone push (APNs), TestFlight, Live Activities and a lasting bundle id (`ai.lazybox.mobile` is a placeholder), and for a notarized Mac build.
2. **Hub:** hosting (the starter targets Kubernetes; relay and push suit Fly.io), the domain (e.g. `hub.lazybox.ai`; it becomes the passkey domain, so choose once), the APNs key, preview pricing, and amending decision **C17** (Hub outside this repo).
3. **Remote design §11:** 14 choices with recommendations (REMOTE_RUNNERS.md). The key ones: Secure Enclave keys when Developer ID signed; Touch ID only for enrolling another owner.
4. **`AntoineToussaint/lazybox-v1` is public and contains internal and employer names.** Making it private erases 6 stars and detaches 5 forks. Needs an explicit go.
5. **Claude:**
   - bundle Claude Code in signed releases? (recommendation: no until Anthropic confirms);
   - send the five questions in CLAUDE_COMPLIANCE.md to Anthropic?
6. **Licence:** LICENSE is proprietary; the README's preview terms permit build and evaluate. A real licence is the person's choice.
7. **Release channel:** prereleases skip the cask and the update feed (`v2-release.yml`). Options are in RELEASING.md. Recommendation: publish the cask and feed for prereleases until 0.1.0.
8. **Updater signing key and repo secrets**, for signed DMG releases: `TAURI_SIGNING_PRIVATE_KEY`(+password) and `HOMEBREW_TAP_TOKEN`; see RELEASING.md.
9. **Retire V1's Homebrew formula in the tap:** deprecate, then disable, then remove and rename the cask; steps in the one-lazybox-command branch report and RELEASING.md.

## 6. Next work, ranked

Each item has its source; read it before starting. Effort: S, M or L.

### A. Remote (P1–P3), the top priority
1. **P1 polish and robustness (M).**
   - An askpass for SSH host-key and passphrase prompts (they currently fail with a plain message).
   - Reconnection verified across real sleep and Wi-Fi changes.
   - The desktop app driving the link agents, verified in the real app.
   - `launchctl` over SSH for Mac hosts.
   - Client keys in the Keychain or Secure Enclave (0600 files today).
   - Migrating Runners that `link up` started detached into the service.
   - Source: REMOTE_RUNNERS.md "P0b"/"P1" and the not-verified lists.
2. **"Run this task on build-box" (M):**
   - New task and New conversation offer a target machine;
   - the sidebar's "Laptop closed: work continues on <VM>" state;
   - moving a workspace between machines (design first).
3. **P2: devcontainers and cloud VMs (L).**
   - The `docker exec` socket route.
   - A provider for one cloud: the person's own provider, or Hetzner.
   - Provisioning, bootstrap, teardown and cost display.
   - Needs a real cloud account from the person.
4. **P3: the relay (L):** the end-to-end encrypted relay (V1's `crates/relay` and `crates/e2e-channel` design) as a `RunnerLink` route, self-hostable. Its hosted version is part of the Hub.
5. **Known Linux gaps:**
   - run-time verification on x64;
   - distributions other than Ubuntu;
   - `libatomic1` for the bundled Node (doctor names it);
   - containers need `--init`;
   - the flaky Codex test `TestResolvedRequestIsNotReplayedAfterReattach` under `-race` on Linux (about 45%; fails on base too). Fix it, or the Linux CI job will flake.

### B. iPhone (next steps, with Apple account items marked)
1. **A real iPhone over the tailnet (S, person):** pair, the Inbox, Allow, Send now; camera QR; multi-hour streams; cellular.
2. **Push and notification actions (M, needs Apple):** APNs through the Runner or the Hub; end-to-end encrypted payloads; Allow/Deny from the notification. Design in MOBILE_CLOUD_HUB §2–3.
3. **The rest of the MVP screens (M):**
   - diff review (read-only, then comments);
   - starting a conversation (the "start" grant exists, the screen doesn't);
   - the PR list and merge;
   - plan approval.
   
   These are also the phone gaps the e2e audit called out.
4. **Device key in the Secure Enclave (S2), Live Activities for running turns (S3), Shortcuts/App Intents (M).**
5. **TestFlight (S, needs Apple):** the bundle id, icons, privacy strings, the App Store guideline 4.2.7 review notes.
6. **ESLint for `apps/mobile`, and an offline cache (S).**

### C. The Hub (after remote and iPhone)
- **Source:** `~/development/lazybox-hub` HUB.md "Status and next steps", plus the six upstream gaps it lists in the SaaS starter.
1. **Run it under Codefly locally (S–M):** the pinned starter; the person face through the starter's gateway; audit wired to the starter's `EmitAuditEvent`.
2. **The Lazybox side (M):**
   - a Runner Hub identity key;
   - `lazybox hub enrol <token>`;
   - a heartbeat loop;
   - a `hub` Directory in `RunnerLink`;
   - handling introductions.
   
   Design: REMOTE_RUNNERS.md §12.
3. **Push routing (M), the relay (L) and managed VMs (L).** These are the paid features.
4. **Accounts and billing UX (M)**, once hosting and pricing are decided.

### D. Product gaps from the audits (e2e audit 2026-11-17; competitive kill list)
1. **Orchestration merge train (M):** landing parallel agents' PRs in `merge_after` order; a Verifying/Landing column. ORCHESTRATION.md "slice 3".
2. **An other-provider verifier as a mission rule (M):** "trusted done", the strongest differentiator per the audit.
3. **PR autopilot (M):** opt-in auto-fix of CI failures and review comments, merge when green; publish review comments as a GitHub PR review.
4. **Projects, Phase 1 (M):** saved repository sets, project defaults, sidebar grouping. PROJECTS_AND_INTEGRATIONS.md.
5. **Intake integrations (M):** Linear and Slack, plus "assign to Lazybox" triggers and scheduled runs (phases 3–4 of the same doc).
6. **The Changes panel (S–M):** discard or stage by hunk and file, with undo.
7. **Best-of-N attempts (M):** "Try with N agents" on New task, with a side-by-side diff comparison.
8. **ACP agents (M):** run `TestRealACPAgent` with Gemini, Goose and OpenCode; map questions; `mcpServers`; fix the cost double count after resume. Then drop "Preview".
9. **Codex:** steer and compaction verified with a real app-server; the permissions request seen for real.
10. **Two-subscription rotation and keychain isolation, verified with real accounts; cost reconciled per provider (S, person).**
11. **OpenTelemetry export (S, low priority).**
12. **Windows and Linux desktop builds (L):** the Runner is on Linux now; the desktop app isn't.

### E. Release engineering
1. **A signed and notarized DMG**, plus the cask and update feed: needs items 1, 7 and 8 in §5.
2. **The codefly modules' licences:** `codefly-dev/core` and `sdk-go` are "all rights reserved" (the person's own). Relicense before a broadly distributed binary.
3. **Before each export:** the full UI gate set on a Mac (`make stage` / `node scripts/release-gates.mjs run ui`). CI covers Linux only.
4. **Docs screenshots refresh:** e.g. `docs/images/welcome.webp` still shows the old welcome.

## 7. Housekeeping

- **Backup to delete:** `/private/tmp/claude-501/-Users-antoine-development-lazybox-v2/7d99cd35-4404-47a3-9781-b400f27c5aa3/scratchpad/dev-state-backup-1648` (306 MB) is a private backup of Dev's settings and shared account store **including credentials**, taken before the Claude-compliance migration. Delete it once the person confirms their Claude accounts and switching work in Dev. Switching was fixed on 2026-11-18; not yet confirmed by them.
- **Agent worktrees:** about 28 remain under `.claude/worktrees/`. Remove one only if `git -C <wt> log feat/v2-command-output..HEAD` is empty and `git -C <wt> status` is clean.
- **Tools installed for the iPhone work:** `cocoapods` and `openjdk@17` (Homebrew), and Maestro in a session scratchpad. The person's Command Line Tools are out of date (updating them needs sudo).
