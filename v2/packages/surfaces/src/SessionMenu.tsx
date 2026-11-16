import type { Session } from '@lazybox/protocol';
import { ActionMenu } from './ActionMenu';

export const PERMISSION_CHOICES: [string, string][] = [['ask', 'Ask for approval'], ['read-only', 'Read only'], ['yolo', 'YOLO']];

/** Ends a live session, or starts a new one from a saved conversation. */
export function SessionLifecycleButton({ session, allowStart, onNewSession, onClose }: { session?: Session; allowStart: boolean; onNewSession(): void; onClose(): void }) {
  if (session?.closed) return allowStart ? <button onClick={onNewSession}>New session</button> : <span>Saved conversation</span>;
  return <button disabled={!session} onClick={onClose}>End session</button>;
}

/** The ⋯ menu of a chat: what it runs on, its permissions and subscription, and ending or deleting it. */
export function SessionMenu({ session, sessionID, accountName, stream, allowStart, onChangePermission, onRestartWithPermission, onSwitchSubscription, onNewSession, onClose, onDelete }: {
  session?: Session;
  sessionID: string;
  accountName: string;
  stream: string;
  allowStart: boolean;
  onChangePermission(mode: string): void;
  /** For an agent that cannot change permissions live: ask to restart it in this mode. */
  onRestartWithPermission(mode: string): void;
  onSwitchSubscription(): void;
  onNewSession(): void;
  onClose(): void;
  onDelete(): void;
}) {
  return <ActionMenu className="session-menu" label="Session actions">
    <strong>Session</strong>
    <small>{accountName}</small>
    <small>Gateway: {session?.gatewayId || 'direct'}</small>
    <small className="mono">{sessionID}</small>
    <small>{stream}</small>
    {session && !session.closed && !['help', 'planning', 'summary'].includes(session.purpose) && <div className="session-permission" role="group" aria-label="Permissions">
      <strong>Permissions{session.permission ? '' : ' · CLI settings'}{session.capabilities?.livePermission ? '' : ' · restart needed'}</strong>
      {PERMISSION_CHOICES.map(([mode, label]) => <button key={mode} aria-pressed={session.permission === mode}
        disabled={(mode === 'yolo' && session.workflow === 'plan') || session.permission === mode}
        title={mode === 'yolo' && session.workflow === 'plan' ? 'YOLO is unavailable in plan mode' : session.capabilities?.livePermission ? undefined : 'This agent started before live permission changes: it restarts in this mode and the conversation continues'}
        onClick={() => session.capabilities?.livePermission ? onChangePermission(mode) : onRestartWithPermission(mode)}>{label}</button>)}
    </div>}
    {session && !session.closed && <button onClick={onSwitchSubscription}>Switch subscription…</button>}
    <SessionLifecycleButton session={session} allowStart={allowStart} onNewSession={onNewSession} onClose={onClose}/>
    <button className="danger" disabled={!session} onClick={onDelete}>Delete conversation…</button>
  </ActionMenu>;
}

/**
 * An agent whose worker predates live permission changes restarts in the new
 * mode between turns; the same provider conversation continues.
 */
export function PermissionRestartPrompt({ mode, busy, onRestart, onCancel }: { mode: string; busy: boolean; onRestart(): void; onCancel(): void }) {
  return <div className="restart-permission" role="alert">
    <span>Restart the agent in {PERMISSION_CHOICES.find(([choice]) => choice === mode)?.[1] || mode}? The conversation continues; this agent started before permissions could change live.</span>
    <button className="primary" disabled={busy} title={busy ? 'Wait for the current turn to finish' : undefined} onClick={onRestart}>Restart</button>
    <button onClick={onCancel}>Cancel</button>
  </div>;
}
