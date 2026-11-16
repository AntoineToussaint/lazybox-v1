import { useLayoutEffect, useState } from 'react';
import type { RunnerClient } from '@lazybox/client-core';
import type { Session } from '@lazybox/protocol';
import type { OpenModifiers } from './file-links';
import type { FileLink } from './file-reference';
import type { Subagents } from './subagent-model';
import { SubagentView } from './subagent-view';

/**
 * One chat's sub-agent presentation, kept current with its transcript and
 * session. The store is stable for the chat's life, so providing it re-renders
 * nothing; cards and the tray subscribe to what they show.
 */
export function useSubagentHost({ api, sessionID, session, index, revealMessage, openFile, onError }: {
  api: RunnerClient; sessionID: string; session?: Session; index: Subagents;
  revealMessage(messageId: string): void;
  openFile?(reference: FileLink, how: OpenModifiers): void;
  onError(message: string): void;
}): SubagentView {
  const [view] = useState(() => new SubagentView());
  // Read during this render by the cards it mounts; announced once committed.
  view.setIndex(index);
  view.actions = {
    revealMessage, openFile,
    stop: async agentId => {
      try { await api.apply({ sessionId: sessionID, operationId: crypto.randomUUID(), operation: { case: 'stopAgent', value: { agentId } } }); }
      catch (error) { onError(`Could not stop the sub-agent: ${String(error)}`); }
    },
  };
  useLayoutEffect(() => { view.notify(); }, [view, index]);
  useLayoutEffect(() => { if (view.setSession(session)) view.notify(); }, [view, session]);
  // A different conversation starts with its cards closed and no panel.
  useLayoutEffect(() => { view.expanded.clear(); view.results.clear(); view.seen.clear(); view.panel = null; view.notify(); }, [view, sessionID]);
  return view;
}
