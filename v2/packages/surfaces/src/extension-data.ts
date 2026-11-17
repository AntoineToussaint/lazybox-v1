import type { Collection, CommandStatus, Mission, Session, TelemetryReport } from '@lazybox/protocol';
import { buildInbox, activityAt, type Seen, type AttentionState } from './attention';
import { conversationName } from './conversation-model';

/**
 * What the extension bridge hands an extension (lazybox.d.ts): plain JSON,
 * projected from the Runner's answers to the extension's own credential.
 * Only what each grant names leaves the app: titles and status, never a
 * conversation's messages, a command's output, a path or an account.
 */
const millis = (value: bigint | number | undefined) => { const n = Number(value || 0); return Number.isFinite(n) && n > 0 ? n : 0; };
const workspaceName = (collections: readonly Collection[], id: string) => collections.find(c => c.id === id)?.name || '';

export function projectWorkspaces(collections: readonly Collection[]) {
  return { workspaces: collections.filter(c => c.state !== 'deleted' && c.state !== 'archived').map(c => ({ id: c.id, name: c.name, repositories: c.members.map(m => m.spec?.name || '').filter(Boolean) })) };
}

export function projectConversations(sessions: readonly Session[], collections: readonly Collection[], workspaceId?: string) {
  const seen = new Set<string>();
  const conversations = [];
  for (const s of [...sessions].sort((a, b) => activityAt(b) - activityAt(a))) {
    const key = s.conversationId || s.id;
    if (seen.has(key) || (workspaceId && s.collectionId !== workspaceId) || ['help', 'planning', 'summary'].includes(s.purpose)) continue;
    seen.add(key);
    conversations.push({
      sessionId: s.id, conversationId: key, title: conversationName(s, 'Conversation'),
      workspaceId: s.collectionId, workspaceName: workspaceName(collections, s.collectionId),
      provider: s.provider, model: s.model, status: s.status, busy: s.busy, closed: s.closed,
      createdAt: millis(s.createdAtUnixMillis), updatedAt: activityAt(s),
    });
  }
  return { conversations };
}

export function projectAttention(sessions: readonly Session[], collections: readonly Collection[], seen: Seen) {
  const inbox = buildInbox(sessions, seen);
  return {
    items: inbox.rows.map(row => ({
      sessionId: row.session.id, conversationId: row.key, title: conversationName(row.session, 'Conversation'),
      workspaceId: row.session.collectionId, workspaceName: workspaceName(collections, row.session.collectionId),
      state: row.state, reason: row.reason, line: row.line, at: row.at, unread: row.unread,
    })),
    counts: inbox.counts as Record<AttentionState, number>,
  };
}

export function projectCommands(commands: readonly CommandStatus[]) {
  return {
    commands: commands.map(c => ({
      id: c.id, title: c.title,
      state: !c.done ? 'running' : c.signal ? 'stopped' : c.exitCode === 0 ? 'succeeded' : 'failed',
      ...(c.exitCode !== undefined ? { exitCode: c.exitCode } : {}),
      startedAt: millis(c.startedAtUnixMillis),
    })),
  };
}

export function projectMissions(missions: readonly Mission[]) {
  return { missions: missions.map(m => ({ id: m.id, title: m.title, canceled: m.canceled, awaitingReview: m.awaitingReview, tasks: m.tasks.map(t => ({ id: t.id, title: t.title, status: t.status, reason: t.reason })) })) };
}

/** Usage across workspaces, one group per workspace, conversation and model. */
export function projectUsage(reports: readonly { workspaceId: string; report: TelemetryReport }[], collections: readonly Collection[]) {
  const groups = [];
  let totalUsd = 0, unpriced = 0;
  for (const { workspaceId, report } of reports) {
    for (const g of report.groups) {
      const usd = g.nanos === undefined ? null : Number(g.nanos) / 1e9;
      if (usd !== null) totalUsd += usd;
      unpriced += Number(g.unpriced || 0n);
      groups.push({
        workspaceId, workspaceName: workspaceName(collections, workspaceId), conversationId: g.scope?.conversation || '',
        model: g.model, provider: g.scope?.provider || '',
        inputTokens: Number(g.tokens?.input || 0n), outputTokens: Number(g.tokens?.output || 0n),
        cacheReadTokens: Number(g.tokens?.cacheRead || 0n), cacheWriteTokens: Number(g.tokens?.cacheWrite5m || 0n) + Number(g.tokens?.cacheWrite1h || 0n),
        usd, records: Number(g.records || 0n),
      });
    }
  }
  return { totalUsd: Math.round(totalUsd * 1e6) / 1e6, unpriced, groups };
}
