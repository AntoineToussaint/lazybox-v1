import { useState } from 'react';
import { useRunner } from './RunnerContext';
import { useRunnerSettings } from './RunnerSettings';
import { Icon } from './Icons';
import { accountNotices, shownNotices } from './claude-auth-model';
import { settingsError } from './settings-parts';
import './claude-auth.css';

/**
 * The one-time notices the Runner raised when automatic switching left the
 * core and Claude sign-in in Lazybox was turned off (CLAUDE_COMPLIANCE.md).
 * Each says what changed and where to change it back; Got it dismisses it for
 * good (the Runner keeps the dismissal, so every window and device agrees).
 */
export function AccountNotices({ onOpenSettings }: { onOpenSettings(tab: 'extensions' | 'agents'): void }) {
  const { api } = useRunner();
  const { settings, setSettings } = useRunnerSettings();
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const ids = shownNotices(settings?.notices);
  if (!settings || !ids.length) return null;
  const dismiss = async (id: string) => {
    setBusy(id); setError('');
    try {
      setSettings(await api.saveRunnerSettings({ ...settings, notices: settings.notices.filter(n => n !== id) }, { timeoutMs: 10000 }));
      window.dispatchEvent(new Event('lazybox-settings-saved'));
    } catch (e) { setError(settingsError(e)); } finally { setBusy(''); }
  };
  return <div className="account-notices">
    {ids.map(id => { const notice = accountNotices[id]; return <section key={id} className="account-notice" role="status" aria-label={notice.title}>
      <Icon name="bell" size={15}/>
      <div className="account-notice-body">
        <strong>{notice.title}</strong>
        <p>{notice.body}</p>
        <div className="account-notice-actions">
          <button type="button" className="primary" onClick={() => onOpenSettings(notice.tab)}>{notice.action}</button>
          <button type="button" disabled={busy === id} onClick={() => void dismiss(id)}>{busy === id ? 'Saving…' : 'Got it'}</button>
        </div>
        {error && <p className="settings-error" role="alert">{error}</p>}
      </div>
    </section>; })}
  </div>;
}
