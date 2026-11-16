import { useEffect, useState } from 'react';
import type { NotificationPermission } from '@lazybox/platform';
import type { NotificationPreferences } from './attention';
import { useAttentionHost, useNotificationPreferences } from './useAttention';
import './inbox.css';
import { Icon } from './Icons';
import { SettingsGroup, SettingsHeader } from './settings-parts';

const options: { key: keyof NotificationPreferences; label: string; detail: string }[] = [
  { key: 'needsInput', label: 'Needs input', detail: 'An agent asks a question or waits for an approval.' },
  { key: 'failed', label: 'Failed', detail: 'A provider failure, a message that could not be delivered, or a turn a Runner restart interrupted.' },
  { key: 'review', label: 'Ready for review', detail: 'An agent finished its turn.' },
  { key: 'badge', label: 'Dock badge', detail: 'Show on the app icon how many conversations need input.' },
];

/** Settings → Notifications. Preferences are shared by every window of this Runner. */
export function NotificationSettings() {
  const host = useAttentionHost();
  const [preferences, save] = useNotificationPreferences();
  const [permission, setPermission] = useState<NotificationPermission>();
  const [status, setStatus] = useState('');
  useEffect(() => { void host?.notificationPermission?.().then(setPermission).catch(() => setPermission('unsupported')); }, [host]);
  const supported = !!host?.notifyAttention;
  const test = async () => {
    try {
      await host!.notifyAttention!({ key: 'lazybox-test', title: 'Lazybox notifications are on', body: 'You will be told when a conversation needs you.', collectionId: '', sessionId: '' });
      setStatus('Sent. If nothing appeared, check this app in your system notification settings.');
    } catch (error) { setStatus(`Could not send: ${String(error)}`); }
  };
  return <section className="notification-settings" aria-labelledby="notification-settings-title">
    <SettingsHeader id="notification-settings-title" title="Notifications" description="Lazybox tells you when a conversation needs you and you are not looking at it. Every conversation, notified or not, is in the Inbox."/>
    {!supported && <p className="settings-error tone-note" role="note">This window does not send notifications; the main Lazybox window does.</p>}
    {permission === 'denied' && <p className="settings-error" role="alert">Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.</p>}
    {permission === 'default' && host?.requestNotificationPermission && <p className="settings-error tone-note">Your browser asks before showing notifications. <button onClick={() => void host.requestNotificationPermission!().then(setPermission)}>Allow notifications</button></p>}
    <SettingsGroup title="Notify me when">
      {options.map(option => <label key={option.key} className="settings-row notification-option">
        <span className="settings-row-text"><span className="settings-row-label">{option.label}</span><small>{option.detail}</small></span>
        <span className="settings-row-control settings-switch"><input type="checkbox" role="switch" checked={preferences[option.key]} onChange={event => save({ ...preferences, [option.key]: event.target.checked })}/></span>
      </label>)}
    </SettingsGroup>
    <div className="notification-test">
      <button disabled={!supported || permission === 'denied'} onClick={() => void test()}><Icon name="bell" size={14}/>Send a test notification</button>
      {status && <small role="status">{status}</small>}
    </div>
  </section>;
}
