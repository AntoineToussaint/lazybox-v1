import { useEffect, useState } from 'react';
import type { RunnerClient } from '@lazybox/client-core';
import type { Collection, CommandStatus, Session } from '@lazybox/protocol';
import { continueConversation, type ConversationReader } from './transcript-cache';

/** The workspace a conversation belongs to, for its branch: the header leads with it until the conversation has a title. */
export function useSessionWorkspace(api: RunnerClient, workspaceId: string, connected: boolean, revision: number) {
  const [workspace, setWorkspace] = useState<Collection>();
  useEffect(() => {
    setWorkspace(undefined);
    if (!workspaceId || !connected) return;
    const control = new AbortController();
    void api.getCollection({ collectionId: workspaceId }, { signal: control.signal }).then(result => { if (!control.signal.aborted) setWorkspace(result.collection); }, () => {});
    return () => control.abort();
  }, [api, workspaceId, connected, revision]);
  return workspace;
}

/**
 * Refreshes the viewed session and its commands while it is shown, and follows
 * a session to its successor execution (unless a send is moving it there).
 */
export function useSessionRefresh({ api, sessionID, connected, showCommands, reader, sending, setSession, setCommands, setRefreshError, onSuccessor }: {
  api: RunnerClient;
  sessionID: string;
  connected: boolean;
  showCommands: boolean;
  reader: ConversationReader;
  sending: { current: boolean };
  setSession(session: Session | undefined): void;
  setCommands(commands: CommandStatus[]): void;
  setRefreshError(error: string): void;
  onSuccessor(session: Session): void;
}) {
  useEffect(() => {
    if (!sessionID || !connected) return;
    const control = new AbortController(); setSession(reader.session); setCommands([]);
    let refreshing = false;
    const update = async () => {
      if (refreshing || control.signal.aborted) return;
      refreshing = true;
      try {
        const [state, output] = await Promise.all([api.getSession({ sessionId: sessionID }, { signal: control.signal }), showCommands ? api.listCommands({ sessionId: sessionID }, { signal: control.signal }) : Promise.resolve({ commands: [] })]);
        if (!control.signal.aborted) {
          if (state.session?.successorExecutionId && !sending.current) {
            const next = await api.getSession({ sessionId: state.session.successorExecutionId }, { signal: control.signal });
            if (!control.signal.aborted && next.session) { continueConversation(api, sessionID, next.session); onSuccessor(next.session); }
          } else { reader.session = state.session; setSession(state.session); setCommands(output.commands); }
          setRefreshError('');
        }
      } catch (e) { if (!control.signal.aborted) setRefreshError(String(e)); }
      finally { refreshing = false; }
    };
    void update(); const timer = setInterval(() => void update(), 1500);
    return () => { control.abort(); clearInterval(timer); };
  }, [api, sessionID, connected, showCommands]);
}
