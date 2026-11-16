import type { Session } from '@lazybox/protocol';
import { ActionMenu } from './ActionMenu';
import { ActionMenuItems } from './ActionMenuItems';
import type { MenuItem } from './context-menu-model';
import { ACTIVITY_LABELS, type ActivityDetailState } from './activity-detail';
import { ACTIVITY_DETAILS } from './tool-lines';

export const PERMISSION_CHOICES: [string, string][] = [['ask', 'Ask for approval'], ['read-only', 'Read only'], ['yolo', 'YOLO']];

/** Ends a live session, or starts a new one from a saved conversation. */
export function SessionLifecycleButton({ session, allowStart, onNewSession, onClose }: { session?: Session; allowStart: boolean; onNewSession(): void; onClose(): void }) {
  if (session?.closed) return allowStart ? <button onClick={onNewSession}>New session</button> : <span>Saved conversation</span>;
  return <button disabled={!session} onClick={onClose}>End session</button>;
}

type SessionActions = {
  session?: Session;
  allowStart: boolean;
  onChangePermission(mode: string): void;
  /** For an agent that cannot change permissions live: ask to restart it in this mode. */
  onRestartWithPermission(mode: string): void;
  onSwitchSubscription(): void;
  onNewSession(): void;
  onClose(): void;
  onDelete(): void;
  /** How much tool activity this conversation shows. */
  activity?: ActivityChoice;
};
export type ActivityChoice = Pick<ActivityDetailState, 'detail' | 'fallback' | 'overridden' | 'choose'>;
/** A permission the agent can take now, or why not. */
const permissionBlocked = (session: Session, mode: string) => mode === 'yolo' && session.workflow === 'plan' ? 'YOLO is unavailable in plan mode' : session.permission === mode;
const takesPermissions = (session?: Session): session is Session => !!session && !session.closed && !['help', 'planning', 'summary'].includes(session.purpose);

/** What can be done to a conversation: the chat's ⋯ menu and its header's context menu, one list. */
export function sessionMenuItems({ session, allowStart, onChangePermission, onRestartWithPermission, onSwitchSubscription, onNewSession, onClose, onDelete, activity }: SessionActions): MenuItem[] {
  return [
    activity && { label: 'Activity detail', icon: 'activity', submenu: [
      ...ACTIVITY_DETAILS.map(detail => ({ label: ACTIVITY_LABELS[detail].label + (detail === activity.fallback ? ' (default)' : ''), checked: activity.detail === detail, run: () => activity.choose(detail) })),
    ] },
    takesPermissions(session) && { label: 'Permissions', icon: 'sliders', submenu: PERMISSION_CHOICES.map(([mode, label]) => ({
      label, checked: session.permission === mode, disabled: permissionBlocked(session, mode),
      run: () => session.capabilities?.livePermission ? onChangePermission(mode) : onRestartWithPermission(mode),
    })) },
    session && !session.closed && { label: 'Switch subscription…', run: onSwitchSubscription },
    session?.closed ? allowStart && { label: 'New session', run: onNewSession } : { label: 'End session', disabled: !session, run: onClose },
    'separator',
    { label: 'Delete conversation…', danger: true, disabled: !session, run: onDelete },
  ];
}

/** The ⋯ menu of a chat: what it runs on, its permissions and subscription, and ending or deleting it. */
export function SessionMenu({ session, sessionID, accountName, stream, allowStart, onChangePermission, onRestartWithPermission, onSwitchSubscription, onNewSession, onClose, onDelete, activity }: {
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
  activity?: ActivityChoice;
}) {
  return <ActionMenu className="session-menu" label="Session actions">
    <strong>Session</strong>
    <small>{accountName}</small>
    <small>Gateway: {session?.gatewayId || 'direct'}</small>
    <small className="mono">{sessionID}</small>
    <small>{stream}</small>
    {takesPermissions(session) && <div className="session-permission" role="group" aria-label="Permissions">
      <strong>Permissions{session.permission ? '' : ' · CLI settings'}{session.capabilities?.livePermission ? '' : ' · restart needed'}</strong>
      {PERMISSION_CHOICES.map(([mode, label]) => <button key={mode} aria-pressed={session.permission === mode}
        disabled={!!permissionBlocked(session, mode)}
        title={mode === 'yolo' && session.workflow === 'plan' ? 'YOLO is unavailable in plan mode' : session.capabilities?.livePermission ? undefined : 'This agent started before live permission changes: it restarts in this mode and the conversation continues'}
        onClick={() => session.capabilities?.livePermission ? onChangePermission(mode) : onRestartWithPermission(mode)}>{label}</button>)}
    </div>}
    {activity && <ActivityDetailChoice activity={activity}/>}
    {session?.closed && !allowStart && <span>Saved conversation</span>}
    <ActionMenuItems items={sessionMenuItems({ session, allowStart, onChangePermission, onRestartWithPermission, onSwitchSubscription, onNewSession, onClose, onDelete }).filter(item => !item || item === 'separator' || !item.submenu)}/>
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

/** Quiet, Smart or Verbose for this conversation, in its ⋯ menu; the default is marked. */
function ActivityDetailChoice({ activity }: { activity: ActivityChoice }) {
  return <div className="session-permission session-activity" role="group" aria-label="Activity detail">
    <strong>Activity detail{activity.overridden ? ' · this conversation' : ' · default'}</strong>
    {ACTIVITY_DETAILS.map(detail => <button key={detail} aria-pressed={activity.detail === detail} title={ACTIVITY_LABELS[detail].detail + (detail === activity.fallback ? ' (The default for every conversation.)' : '')}
      onClick={() => activity.choose(detail)}>{ACTIVITY_LABELS[detail].label}</button>)}
  </div>;
}
