import type { Session } from '@lazybox/protocol';
import { ActionMenu } from './ActionMenu';
import { ActionMenuItems } from './ActionMenuItems';
import type { MenuItem } from './context-menu-model';
import { ACTIVITY_LABELS, type ActivityDetailState } from './activity-detail';
import { ACTIVITY_DETAILS } from './tool-lines';
import type { SlashChoice } from './slash-commands';
import { showMenuNotice } from './ContextMenu';
import { requestRename } from './ConversationTitle';
import { conversationHandoffItems, useHandoffMenus } from './handoff';
import { useRunner } from './RunnerContext';

/** The model picker: the same choices and switch as `/model` (useSlashCommands.tsx). */
export type ModelChoices = { choices: SlashChoice[]; live: boolean; disabled?: string; choose(value: string): void; /** Any model id: `/model ` in the message box. */ pick(): void };
const copySessionId = (id: string) => { void navigator.clipboard?.writeText(id).then(() => showMenuNotice('Session ID copied'), () => showMenuNotice('Could not copy the session ID')); };

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
  /** The models it can switch to. */
  models?: ModelChoices;
  sessionID?: string;
};
export type ActivityChoice = Pick<ActivityDetailState, 'detail' | 'fallback' | 'overridden' | 'choose'>;
/** A permission the agent can take now, or why not. */
const permissionBlocked = (session: Session, mode: string) => mode === 'yolo' && session.workflow === 'plan' ? 'YOLO is unavailable in plan mode' : session.permission === mode;
const takesPermissions = (session?: Session): session is Session => !!session && !session.closed && !['help', 'planning', 'summary'].includes(session.purpose);

/** What can be done to a conversation: the chat's ⋯ menu and its header's context menu, one list. */
export function sessionMenuItems({ session, allowStart, onChangePermission, onRestartWithPermission, onSwitchSubscription, onNewSession, onClose, onDelete, activity, models, sessionID }: SessionActions): MenuItem[] {
  return [
    activity && { label: 'Activity detail', icon: 'activity', submenu: [
      ...ACTIVITY_DETAILS.map(detail => ({ label: ACTIVITY_LABELS[detail].label + (detail === activity.fallback ? ' (default)' : ''), checked: activity.detail === detail, run: () => activity.choose(detail) })),
    ] },
    takesPermissions(session) && { label: 'Permissions', icon: 'sliders', submenu: PERMISSION_CHOICES.map(([mode, label]) => ({
      label, checked: session.permission === mode, disabled: permissionBlocked(session, mode),
      run: () => session.capabilities?.livePermission ? onChangePermission(mode) : onRestartWithPermission(mode),
    })) },
    models && session && !session.closed && { label: 'Model', icon: 'sparkle', disabled: models.disabled, submenu: [
      ...models.choices.map(choice => ({ label: choice.label + (models.live ? '' : ' (restarts the agent)'), checked: !!choice.current, run: () => models.choose(choice.value) })),
      'separator', { label: 'Other model…', run: models.pick },
    ] },
    session && !session.closed && { label: 'Switch subscription…', run: onSwitchSubscription },
    session?.closed ? allowStart && { label: 'New session', run: onNewSession } : { label: 'End session', disabled: !session, run: onClose },
    'separator',
    session && sessionID && { label: 'Rename…', icon: 'pencil', run: () => { if (!requestRename(sessionID)) showMenuNotice('Open the conversation to rename it'); } },
    sessionID && { label: 'Copy session ID', icon: 'copy', run: () => copySessionId(sessionID) },
    { label: 'Delete conversation…', danger: true, disabled: !session, run: onDelete },
  ];
}

/** Handing the conversation to your own tools goes before Delete, which stays last. */
export function withHandoff(items: MenuItem[], handoff: MenuItem[]): MenuItem[] {
  if (!handoff.length) return items;
  const danger = items.findIndex(item => !!item && item !== 'separator' && !!item.danger);
  return danger < 0 ? [...items, 'separator', ...handoff] : [...items.slice(0, danger), ...handoff, ...items.slice(danger)];
}

/** The ⋯ menu of a chat: what it runs on, its permissions and subscription, and ending or deleting it. */
export function SessionMenu({ session, sessionID, accountName, stream, allowStart, onChangePermission, onRestartWithPermission, onSwitchSubscription, onNewSession, onClose, onDelete, activity, models }: {
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
  models?: ModelChoices;
}) {
  const live = stream === 'Live';
  // Open in Terminal and Continue in Claude Code / Codex…, here and in the header's and rows' menus.
  useHandoffMenus();
  const { api, info } = useRunner();
  const handoff = conversationHandoffItems(api, session, info);
  return <ActionMenu className="session-menu" label="Session actions">
    <strong>Session{live ? '' : <span className="session-connection" role="status"><span aria-hidden="true"/>{stream}</span>}</strong>
    <dl className="session-facts">
      <div><dt>Subscription</dt><dd>{accountName}</dd></div>
      <div><dt>Gateway</dt><dd>{session?.gatewayId || 'direct'}</dd></div>
    </dl>
    {takesPermissions(session) && <div className="session-permission" role="group" aria-label="Permissions">
      <strong>Permissions{session.permission ? '' : ' · CLI settings'}{session.capabilities?.livePermission ? '' : ' · restart needed'}</strong>
      {PERMISSION_CHOICES.map(([mode, label]) => <button key={mode} aria-pressed={session.permission === mode}
        disabled={!!permissionBlocked(session, mode)}
        title={mode === 'yolo' && session.workflow === 'plan' ? 'YOLO is unavailable in plan mode' : session.capabilities?.livePermission ? undefined : 'This agent started before live permission changes: it restarts in this mode and the conversation continues'}
        onClick={() => session.capabilities?.livePermission ? onChangePermission(mode) : onRestartWithPermission(mode)}>{label}</button>)}
    </div>}
    {models && session && !session.closed && <div className="session-permission session-model" role="group" aria-label="Model">
      <strong>Model{models.live ? '' : ' · restart needed'}</strong>
      {models.choices.map(choice => <button key={choice.value} aria-pressed={!!choice.current} disabled={!!models.disabled} title={[choice.detail, models.live ? '' : 'Restarts the agent between turns; the conversation continues'].filter(Boolean).join(' · ') || undefined}
        onClick={() => models.choose(choice.value)}>{choice.label}</button>)}
      <button disabled={!!models.disabled} title="Any model id, typed in the message box (/model)" onClick={models.pick}>Other…</button>
    </div>}
    {activity && <ActivityDetailChoice activity={activity}/>}
    {session?.closed && !allowStart && <span>Saved conversation</span>}
    <ActionMenuItems items={withHandoff(sessionMenuItems({ session, allowStart, onChangePermission, onRestartWithPermission, onSwitchSubscription, onNewSession, onClose, onDelete, sessionID }).filter(item => !item || item === 'separator' || !item.submenu), handoff)}/>
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
