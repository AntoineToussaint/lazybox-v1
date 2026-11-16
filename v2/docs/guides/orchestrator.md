# Let an agent run agents

An **orchestrator** is a conversation you let start and drive other agents
for one [mission](missions.md). It splits the work, starts an agent per task,
messages them, waits for them and stops them. You keep every decision that
matters: their approvals and questions come to you, and only you accept
their work.

## Give a conversation the right

In the conversation, type `/orchestrate` (or ⌘K → **Let this conversation run
agents…**). From the Missions board, **Let a conversation run agents…** does
the same and lets you pick the conversation.

The sheet asks:

| Field | What it means |
| --- | --- |
| **Mission** | The mission its agents work on. Each agent it starts is a task on that mission's board. Name a new one in the last row. |
| **Permission** | The most an agent it starts may get: Read only, Ask or YOLO. It can never be more than the conversation's own permission. |
| **Subscriptions** | The accounts its agents may run on. By default, the conversation's own. |
| **At once** | How many of its agents may run at the same time (default 3). An agent counts until you accept its task or it is stopped. |
| **Budget** | What the whole tree may spend, or no cap. |

**Let it run agents** gives the right. The conversation's header shows an
**Orchestrator 0/3** badge, and the conversation hears what it may do with
your next message.

## What it can and cannot do

| It can | It never can |
| --- | --- |
| Start an agent for a task (`lazybox agents spawn`) | Approve a request, or answer a question for you |
| Message, wait on and stop **the agents it started** | Reach any conversation it did not start |
| Give an agent its own workspace (new branches from its own) | Give an agent more permission, other subscriptions or more agents than you allowed |
| Read what its agents reported | Pass a gate or accept a task |

Every agent it starts asks **you** for approvals, labelled with where it came
from. A message from an agent never counts as your consent.

## Follow the tree

- **The badge** (click it): the mission, what its agents may get, each agent
  with its state (Working, Needs you, Reported, Accepted), and **Revoke
  grant…**.
- **The transcript** shows one quiet line per agent started, message sent or
  agent stopped, each with **Open**. A message from another agent is an event
  line with its sender — *Index the corpus: Found the tokenizer…* marked
  *your agent*, or *Task from “Search lead”: Index the corpus* — that opens to
  exactly what was sent, with **Open** to go to the sender. It never reads as
  you.
- **An agent it started** shows its orchestrator in its header; click it to
  go back up.
- **The Missions board** shows the orchestrator above the columns, and on
  each card who started it and as what (*worker*, *researcher*…).

## Take it back

Click the badge → **Revoke grant…** → **Revoke**, or **Revoke…** on the
Missions board. The conversation can no longer start or drive agents. The
agents it started keep running until you stop them; their reports still
reach you. Deleting the conversation revokes its grant too.

## For the agent: `lazybox agents`

The orchestrator (and its agents) use these from their own conversations:

```text
lazybox agents spawn --title "Index the corpus" --brief "Objective… Done when…" [--workspace new]
                     [--permission read-only|ask|yolo] [--profile ID] [--role worker]
lazybox agents ls                      # its agents and their state
lazybox agents send <agent> "…"         # at most 4 KB, six a minute to one agent
lazybox agents wait [agent…] --until settled|idle|needs-input|reported|closed [--any]
lazybox agents watch                   # follow them live
lazybox agents stop <agent> [--end]
lazybox agents send parent "…"          # from an agent it started
lazybox agents report "what I did and how I checked it"
```

A report asks you to accept the task on the board, and tells the
orchestrator. `wait` and `watch` keep going across a Runner restart: the
agents, the grant and who started whom outlive it.
