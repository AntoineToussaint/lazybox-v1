import type { AttentionDestination, AttentionHost, ChatTarget, NotificationPermission, WorkspaceHost } from '@lazybox/platform';

/** Browser test host. Reconnect to existing views across an opener reload/close. */
export function browserWorkspaceHost(scope: string, token: string, chat?: ChatTarget, notifies = false): WorkspaceHost {
  const attention = notifies ? browserAttention() : {};
  const channel = new BroadcastChannel(`lazybox-views:${scope}`);
  const waiting = new Map<string, (value: { ok: boolean; error?: string }) => void>();
  const windows = new Map<string, Window>();
  channel.onmessage = event => {
    const value = event.data;
    if (!value || typeof value.requestId !== 'string') return;
    if (value.reply) { waiting.get(value.requestId)?.(value); return; }
    if (!chat || value.panelId !== chat.panelId) return;
    if (value.action === 'focus' && (value.sessionId !== chat.sessionId || value.collectionId !== chat.collectionId)) {
      channel.postMessage({ requestId: value.requestId, reply: true, ok: false, error: 'An existing chat window has another target. Bring it back before retargeting.' }); return;
    }
    if (value.action !== 'focus' && value.action !== 'dock') return;
    channel.postMessage({ requestId: value.requestId, reply: true, ok: true });
    if (value.action === 'dock') window.close(); else window.focus();
  };
  window.addEventListener('pagehide', () => channel.close(), { once: true });
  const request = (action: string, target: Partial<ChatTarget> & { panelId: string }): Promise<boolean> => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { waiting.delete(requestId); resolve(false); }, 250);
    waiting.set(requestId, value => { clearTimeout(timer); waiting.delete(requestId); if (value.ok) resolve(true); else reject(new Error(value.error)); });
    channel.postMessage({ requestId, action, ...target });
  });
  return {
    ...attention,
    async openWorkspace(collectionId) {
      const url=new URL(location.href);url.search=new URLSearchParams({view:'workspace',collection:collectionId,workspaceWindow:'1'}).toString();url.hash=new URLSearchParams({token}).toString();
      const opened=window.open(url,`workspace-${collectionId}`);if(!opened)throw new Error('Workspace window was blocked');opened.focus();
    },
    async openSignIn(value) {
      const url=new URL(value);
      if (url.protocol!=='https:' || url.username || url.password) throw new Error('Invalid sign-in URL');
      const opened=window.open(url.href,'_blank','noopener,noreferrer');
      // Browsers may return null for a successful noopener navigation.
      void opened;
    },
    async openChat(target) {
      if (await request('focus', target)) return;
      const url = new URL(location.href);
      url.search = new URLSearchParams({ view: 'chat', panel: target.panelId, collection: target.collectionId, session: target.sessionId }).toString();
      url.hash = new URLSearchParams({ token }).toString();
      const child = window.open(url, `chat-${target.panelId}`);
      if (!child) throw new Error('The chat window was blocked by the browser');
      windows.set(target.panelId, child); child.focus();
    },
    async dockChat(panelId) {
      if (await request('dock', { panelId })) return;
      const child = windows.get(panelId);
      if (child?.closed) { windows.delete(panelId); return; }
      throw new Error('The detached browser view did not respond. Reopen it before bringing it back.');
    },
  };
}

/**
 * Web notifications for the browser client. A click focuses this tab and
 * opens the conversation; the badge is the installed-app badge where the
 * browser has one, and the tab title everywhere.
 */
function browserAttention(): AttentionHost {
  const listeners = new Set<(destination: AttentionDestination) => void>();
  const title = document.title;
  const permission = (): NotificationPermission => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  return {
    async notifyAttention(notice) {
      if (permission() !== 'granted') return;
      const shown = new Notification(notice.title, { body: notice.body, tag: `lazybox:${notice.key}` });
      shown.onclick = () => {
        window.focus(); shown.close();
        if (notice.sessionId) for (const listener of listeners) listener({ collectionId: notice.collectionId, sessionId: notice.sessionId });
      };
    },
    async setAttentionBadge(count) {
      document.title = count ? `(${count}) ${title}` : title;
      const badge = navigator as Navigator & { setAppBadge?(count: number): Promise<void>; clearAppBadge?(): Promise<void> };
      try { if (count) await badge.setAppBadge?.(count); else await badge.clearAppBadge?.(); } catch { /* Not an installed app. */ }
    },
    onAttentionOpen(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async notificationPermission() { return permission(); },
    async requestNotificationPermission() { return permission() === 'unsupported' ? 'unsupported' : await Notification.requestPermission(); },
  };
}
