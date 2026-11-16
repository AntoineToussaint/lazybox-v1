# Lazybox V2 audit and next-generation roadmap — 2026-11-16

## Verdict

V2 is a good **single-person local workbench** and almost none of the product
in [PRODUCT.md](../../PRODUCT.md). Agents survive Runner restarts, multi-repo
workspaces work, two providers run with live approvals, cost is metered, and
command output now reaches the human in full and the agent in compact form.
But there is no task model, no review record, no PR flow, no notifications, no
runtime isolation beyond worktrees, no remote or phone access, and one live
security hole: **an agent can approve its own permission requests.**

The market moved fast in 2026. The frontier tools (Conductor, Claude Code
agent view, Codex app, Cursor 3, Copilot app, Devin, herdr) have converged on
the same core: worktree per task, an attention inbox, a PR-centred review
loop, setup/run scripts with ports, and phone control. V2 has the first and
none of the rest. Its genuine differentiators — multi-repo workspaces, agents
that outlive the Runner, metered cost with account rotation, and compact
agent-facing output with a full human console — are real but not yet visible
as a product.

The opportunity the survey confirms is the one PRODUCT.md names: **nobody
tracks ownership, dependencies and decisions across parallel agents, and
nobody verifies an agent's "done" against what actually ran.** Review is the
bottleneck everywhere; practitioners cap out at 3–5 parallel agents.

## Where V2 stands

Evidence is in the internal audit summary below; statuses were checked
against code, not docs.

| PRODUCT.md outcome | Status |
| --- | --- |
| Understand the shared effort | Not started (`internal/work`, `internal/hub` are empty) |
| Direct work at scale | Not started |
| Collaborate with people | Not started (one owner token, no identities) |
| Collaborate with agents | Not started (agents' only tool is managed commands) |
| Watch real execution | Done locally (consoles, `lazybox run`) |
| Develop visually | Not started (no app preview) |
| Continue elsewhere | Partial (survives Runner restart; no remote, no phone) |
| Trust reported status | Partial (agent status; no evidence or acceptance model) |

MVP A01–A14: seven not started, A13/A14 done for one person, the rest partial.
Roadmap R0–R4: none complete. P01 and most of P03 are in main.

What a person can do today, end to end on one machine: pick repositories
(GitHub App, personal token or local scan), create a multi-repo workspace of
worktrees, run Claude and Codex with images, steering, questions and
approvals, change permissions live, rotate subscriptions, review uncommitted
and branch changes against any base, edit files, watch command consoles, read
cost and context telemetry, use snippets and a configurable `]]` menu, and
keep agents running across Runner restarts.

Missing for daily use: committing, pushing, opening or merging a PR; running
or previewing the app; notifications; tasks, delegation, reviews; search
across conversations; phone; remote Runner; an interactive shell (in flight).

## How V2 compares

✓ yes · ◐ partial · ✗ no. Other columns from the survey; sources in the
session's research notes (Conductor docs, Claude Code agent-view docs, Codex
docs, Cursor/Copilot/Devin changelogs, herdr.dev).

| Capability | **Lazybox V2** | Conductor | herdr | Claude Code | Codex app | Cursor 3 | Copilot app | Devin |
|---|---|---|---|---|---|---|---|---|
| Worktree per task | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **Multi-repo task** | **✓** | ◐ | ◐ | ✓ beta, cloud | ? | ✓ | ✓ | ? |
| Container / cloud execution | ✗ | ◐ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Agents survive UI/runner restart** | **✓** | ? | ✓ | ✓ | ? | ◐ | ✓ | ✓ |
| Attention inbox + notifications | ✗ | ◐ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ |
| In-app diff review | ✓ | ✓ | ✗ | ◐ | ✓ | ✓ | ✓ | ✓ |
| Inline review comments → agent | ✗ | ✓ | ✗ | ? | ? | ? | ? | ✓ |
| PR creation / checks / CI autofix | ✗ | ✓ | ✗ | ✓ | ◐ | ✓ | ✓ | ✓ |
| Setup / run scripts, ports | ✗ | ✓ | ✗ | ◐ | ✓ | ✓ | ◐ | ✓ |
| Run / preview the app | ✗ | ✓ | ◐ | ? | ✓ | ✓ | ✓ | ✓ |
| Per-turn checkpoints / revert | ✗ | ✓ | ✗ | ✓ | ? | ✓ | ? | ? |
| Agent → agent delegation, lineage | ✗ | ◐ | ✓ | ✓ | ✓ | ◐ | ◐ | ✓ |
| Shared memory across sessions | ✗ | ◐ | ✗ | ✓ | ? | ? | ? | ✓ |
| **Cost metering + account rotation** | **✓** | ◐ | ✗ | ◐ | ◐ | ◐ | ◐ | ✓ |
| **Compact agent output + full console** | **✓** | ✗ | ✗ | ◐ spill file | ◐ truncation | ? | ? | ? |
| Live permission change | ✓ | ? | n/a | ✓ | ✓ | ? | ? | n/a |
| Phone / remote control | ◐ web only | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Several agent harnesses | ◐ (2) | ✓ | ✓ | ✗ | ✗ | ◐ | ✓ | ✗ |
| Scheduled / triggered agents | ✗ | ✓ | ✗ | ✓ | ✓ | ◐ | ✓ | ✓ |
| Programmable control plane (API/MCP) | ◐ CLI + API | ✓ | ✓ | ✓ | ? | ✓ | ? | ? |

Market notes that matter for strategy: Conductor was acquired by Meta on
Nov 4 and partly reversed course on Nov 13; Vibe Kanban, Crystal and Terragon
shut down or were abandoned this year. Local-first, open state formats are a
defensible position. Independent benchmarks of rtk-style output compression
showed little cost saving overall (see [command output](../../COMMAND_OUTPUT.md)),
so measure, don't assume.

## Roadmap

Ordered by what unblocks daily use and what only Lazybox can do. Each item
names what to reuse from V1 and which tool sets the bar.

### In flight today (parallel branches)

- Agent self-approval: per-session scoped token so agents can publish console
  output but never approve, answer or delete. **Release blocker.**
- Runner reachable from the LAN: bind loopback; failing release gate
  (agent-stop timing under one CPU); stale launcher text.
- Interactive workspace shell (PTY panel).
- Help as an agent with a settings-only MCP, confirmed per change.
- Console opens on each run, shows what the agent saw; output retention.

### Next

1. **Attention inbox.** One list across workspaces sorted by *needs input /
   ready for review / failed / working / done*, desktop notifications, a dock
   badge, and an unread marker per conversation. The bar: Claude Code agent
   view, herdr. Without it, parallelism beyond three agents is guesswork.
2. **Verified status (the trust thesis).** "Done" is shown only with
   evidence: the exit status of the tests the agent ran through `lazybox run`,
   CI checks, and the diff. Claims without evidence are labelled as claims.
   Nobody does this; it turns the console work into a product.
3. **PR loop.** Commit, push, open a PR with an agent-drafted description,
   a Checks tab, CI failures and review comments sent back to the agent, merge
   when green. Reuse V1 `gh-provider` (`submit_pr_review`, `merge_pr`,
   `enable_auto_merge`, `branch_merge_gate`). The bar: Conductor.
4. **Inline review comments → agent.** Comment on lines in the Changes diff;
   comments become the agent's next message with file:line anchors. Reuse V1
   `core/src/review.rs` (findings, freshness, disposition).
5. **Workspace runtime.** Committable `.lazybox/` setup, run and archive
   scripts per repository; a port block per workspace (`LAZYBOX_PORT`); run
   actions with a live preview and stop/restart; non-concurrent mode for apps
   that can't share ports. The bar: Conductor actions. Database isolation is
   unsolved everywhere — offer a hook, not a promise.
6. **Per-turn checkpoints.** A private git ref before each agent turn, revert
   to any turn. The bar: Conductor, Cursor.

### Then: what only Lazybox does

7. **Work model and coordination.** Tasks with owner, dependencies, decisions
   and evidence; a coordinator agent that splits a goal into child sessions
   across repositories, with visible lineage and a dependency-aware merge
   order. Reuse V1 `core/src/work.rs`, `server/src/epics.rs`, `work_calls.rs`
   (`ask_session`, depth guards). The bar: Claude Projects (cloud only, beta) —
   Lazybox can do it locally and across providers.
8. **Agent review with measured outcomes.** A reviewer agent that files
   findings against a pinned head; track fixed / rejected / ignored. The bar:
   Devin Review.
9. **Lazybox as a control plane for agents.** Generalize the settings MCP
   into a Lazybox MCP and CLI: spawn a session, send, wait, read output, ask
   another session. herdr's `hc` and Conductor's MCP show the shape.
10. **Cost per outcome.** Cost per merged PR and per task, gortk savings per
    run, budgets per workspace. The gateway and rotation are unique; surface
    them as decisions, not charts.

### Later

11. **Phone and remote control** of the local Runner by QR pairing (reuse V1
    `relay`, `e2e-channel`). Every competitor has this now.
12. **Scheduled and triggered agents** feeding the review queue.
13. **Vim mode** in the message box and the file editor (Monaco's vim add-on);
    today the Vim preset covers only navigation outside the composer.
14. **More harnesses** (OpenCode, Gemini, Cursor agent) behind the same
    adapter contract.
15. **Container / remote execution** for isolation (reuse V1 `sandbox`).

## Code health to fix alongside

- Dense TSX: `AgentWindow.tsx` (one 2.7k-character line), `Workspace.tsx`,
  `ChangesPanel.tsx`. Split into components before features 1–4 land on them.
- No component tests; UI coverage is Playwright scripts against a fake Runner.
- Audit probes from 2026-11-09 are kept as `.go.txt` and never run; make the
  authority probe a release gate once the scoped token lands.
- Naming drift: API still says Collection; `internal/hub` scaffold conflicts
  with decision C17; stale claims in the 2026-11-09 audit README.
- `.cache/environments/releases` holds full source copies that are easy to
  grep or edit by mistake.
