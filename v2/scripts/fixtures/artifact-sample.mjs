// A realistic design doc an agent publishes with `lazybox artifact put`, in
// two versions: the reader, its table of contents, callouts, tables, task
// lists, code, a Mermaid diagram, footnotes and the rendered diff are tested
// and photographed against it (test-artifact-reader.mjs, test-appearance.mjs).

export const designDocV1 = `# Datasource migration

> **Decision**
> Move reads to the new datasource first, behind a per-tenant flag. Writes follow only after two clean weeks of dual reads.

## Context

The billing service still reads tenant records from the legacy \`accounts\` database, a single Postgres primary that also serves three other teams. At peak it runs at 82% CPU, and every incident in the last quarter traced back to lock contention on \`tenant_settings\`.[^load] The new datasource is a per-region store with read replicas, already used by the catalog service.

This document proposes how we move billing over without a maintenance window, and how we prove each step is safe before taking the next one.

## Goals

- Billing reads and writes tenant records from the regional datasource.
- No customer-visible downtime, and no change to invoice totals.
- Each phase can be rolled back in under five minutes with a flag.

### Non-goals

- Changing the tenant record schema. Field renames happen after the move.
- Migrating the reporting jobs, which keep reading the legacy replica until Q3.

## Architecture

Requests go through a small \`TenantStore\` interface. During the migration it fans out to both stores and compares what comes back, so a mismatch shows up in metrics long before it reaches an invoice.

\`\`\`mermaid
flowchart LR
  API[Billing API] --> Store{TenantStore}
  Store -->|primary| Legacy[(Legacy accounts DB)]
  Store -.->|shadow read| Regional[(Regional datasource)]
  Store --> Compare[Mismatch metrics]
  Compare --> Alerts[On-call alerts]
\`\`\`

The comparison runs off the request path: a mismatch is recorded with the tenant ID and the differing fields, never the values.

## Rollout plan

| Phase | Scope | Flag | Exit criteria | Status |
| --- | --- | --- | --- | --- |
| 1. Shadow reads | All tenants, compare only | \`billing.shadow_reads\` | Mismatch rate below 0.01% for 7 days | Done |
| 2. Dual reads | 5% of tenants read from regional | \`billing.regional_reads\` | p99 latency within 10% of legacy | In progress |
| 3. Regional reads | All tenants | \`billing.regional_reads\` | Two clean weeks, no rollback | Planned |
| 4. Dual writes | Writes to both stores | \`billing.dual_writes\` | Reconciliation job finds no drift | Planned |
| 5. Cut over | Legacy path removed | none | Legacy tables read-only for 30 days | Planned |

> **Warning**
> Phase 4 is the only step that cannot be rolled back by a flag alone: a write that reached only one store must be reconciled. The reconciliation job ships before the flag is turned on.

## Interface

The interface stays small on purpose. Callers never learn which store answered.

\`\`\`go
// TenantStore reads and writes tenant records, whichever datasource holds them.
type TenantStore interface {
	Tenant(ctx context.Context, id TenantID) (Tenant, error)
	UpdateSettings(ctx context.Context, id TenantID, change SettingsChange) error
}
\`\`\`

The flag is evaluated once per request, so a single request never mixes stores:

\`\`\`ts
const store = flags.enabled('billing.regional_reads', tenant) ? regional : legacy;
\`\`\`

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Replication lag returns stale settings | Medium | Wrong plan limits for a few seconds | Read-your-writes: a tenant who just changed settings reads from the primary for 30 s |
| Mismatch metrics are noisy | High | Real drift is missed | Compare normalised records; ignore \`updated_at\` |
| Regional store outage | Low | Billing API errors | Flag back to legacy; the legacy path stays warm until phase 5 |

> **Note**
> Read-your-writes is the one behaviour change callers can observe. It is covered by the contract tests in \`billing/store/contract_test.go\`.

## Milestones

- [x] Shadow reads in production
- [x] Mismatch dashboard and alerts
- [ ] Dual reads at 5%
- [ ] Reconciliation job
- [ ] Cut over and remove the legacy path

## Open questions

1. Do the reporting jobs need the regional store before Q3, or can they keep the legacy replica?
2. Who owns the reconciliation job once the migration is done: billing or the datasource team?

[^load]: Measured over the four weeks ending November 2, at the 95th percentile of hourly samples.
`;

/** The second version: phase 2 finished, a new risk, an answered question. */
export const designDocV2 = designDocV1
  .replace('| 2. Dual reads | 5% of tenants read from regional | `billing.regional_reads` | p99 latency within 10% of legacy | In progress |', '| 2. Dual reads | 5% of tenants read from regional | `billing.regional_reads` | p99 latency within 10% of legacy | Done |')
  .replace('| 3. Regional reads | All tenants | `billing.regional_reads` | Two clean weeks, no rollback | Planned |', '| 3. Regional reads | All tenants | `billing.regional_reads` | Two clean weeks, no rollback | In progress |')
  .replace('- [ ] Dual reads at 5%', '- [x] Dual reads at 5%')
  .replace('| Regional store outage | Low | Billing API errors | Flag back to legacy; the legacy path stays warm until phase 5 |', '| Regional store outage | Low | Billing API errors | Flag back to legacy; the legacy path stays warm until phase 5 |\n| Cache keys collide across regions | Low | One tenant sees another region\'s cached plan | Prefix every cache key with the region |')
  .replace('1. Do the reporting jobs need the regional store before Q3, or can they keep the legacy replica?\n', '1. ~~Do the reporting jobs need the regional store before Q3?~~ No: they keep the legacy replica until Q3 (agreed with the data team).\n');

/** Publishes the sample as an agent would: v1, then v2 with --id. Returns the artifact. */
export function seedDesignDoc(fixture, { collectionId = 'alpha', sessionId = fixture.sessions[0].id } = {}) {
  const first = fixture.artifacts.agentPut({ collectionId, sessionId, conversationId: 'conversation-alpha', title: 'Datasource migration', kind: 'spec', content: designDocV1 });
  return fixture.artifacts.agentPut({ collectionId, sessionId, conversationId: 'conversation-alpha', artifactId: first.id, content: designDocV2 });
}
