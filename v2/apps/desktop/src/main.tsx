import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { AgentWindow, ArtifactWindow, WindowControls, WindowErrorBoundary, Workspace, useRunnerLocator } from '@lazybox/surfaces';
import type { AttentionDestination, AttentionHost, SurfaceHost, SurfaceTarget, ViewStateStore, WorkspaceHost } from '@lazybox/platform';

type Bootstrap = { url: string; token: string; workingDirectory: string; target: SurfaceTarget; viewKey: string; viewScope: string; viewRoot: string; applicationName: string; fixedWorkspaceId: string; kind: 'workspace' | 'chat' | 'console' | 'artifact'; notice: string; viewState: Record<string,string> };
const fetchRunner: typeof globalThis.fetch = (input, init) => nativeFetch(input, { ...init, maxRedirections: 0 });

/**
 * Notifications are shown by the native host: the webview holds no
 * notification permission, only these commands. A click on a notification
 * focuses the main window, which then asks the host for its conversation.
 */
const desktopAttention: AttentionHost = {
  notifyAttention: notice => invoke<void>('notify_attention', { notice: { title: notice.title, body: notice.body, destination: { collectionId: notice.collectionId, sessionId: notice.sessionId } } }),
  setAttentionBadge: count => invoke<void>('set_attention_badge', { count }),
  notificationPermission: async () => 'granted',
  onAttentionOpen(listener) {
    let disposed = false, stop: (() => void) | undefined;
    const take = async () => {
      const destination = await invoke<AttentionDestination | null>('take_attention_destination');
      if (destination && !disposed) listener(destination);
    };
    void take().catch(() => {});
    void listen('attention-open', () => void take().catch(() => {})).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; });
    return () => { disposed = true; stop?.(); };
  },
};

type Renew = () => Promise<{ baseUrl: string; token: string } | undefined>;
function DesktopWindow({ bootstrap, followRestart, renew }: { bootstrap: Bootstrap; followRestart(): void; renew: Renew }) {
  const [error, setError] = useState(bootstrap.notice);
  const host = useMemo<SurfaceHost>(() => ({
    saveTarget: target => invoke<void>('save_surface', { target }),
    reopenAgent: () => invoke<void>('reopen_agent'),
    reopenClosed: () => invoke<void>('reopen_closed'),
    reconnect: () => invoke<void>('reconnect_view'),
  }), []);
  const retained = useRef(new Map(Object.entries(bootstrap.viewState)));
  const pendingWrites = useRef(Promise.resolve());
  const viewState = useMemo<ViewStateStore>(() => ({ key: bootstrap.viewKey, scope: bootstrap.viewScope, root: bootstrap.viewRoot,
    getItem: key => retained.current.get(key) ?? localStorage.getItem(key),
    setItem: (key, value) => {
      if (value.length > 256 * 1024) throw new Error('Saved view is too large');
      retained.current.set(key, value);
      pendingWrites.current = pendingWrites.current.then(() => invoke<void>('save_view_state', { key, value })).catch(error => setError(`Could not save this window: ${String(error)}`));
    },
  }), [bootstrap.viewKey, bootstrap.viewScope, bootstrap.viewRoot]);
  const saveTarget = useCallback((target: SurfaceTarget) => host.saveTarget(target), [host]);
  // The main window alone notifies and owns the dock badge; every other window shows the inbox only.
  const notifies = bootstrap.kind === 'workspace' && !bootstrap.fixedWorkspaceId;
  const workspaceHost = useMemo<WorkspaceHost>(() => ({
    ...(notifies ? desktopAttention : {}),
    reconnect: () => invoke<void>('reconnect_view'),
    // Arm the host to adopt the restarted Runner's locator (possibly a new port)
    // and reread it promptly; the window keeps its state, nothing reloads.
    expectRunnerRestart: async () => { await invoke<void>('expect_runner_restart'); followRestart(); },
    openWorkspace: collectionId => invoke<void>('open_workspace', { collectionId }),
    chooseRepositoryFolder: () => invoke<string | null>('choose_repository_folder'),
    openSignIn: url => invoke<void>('open_sign_in', { url }),
    openPreview: url => invoke<void>('open_preview', { url }),
    copySignInCode: code => invoke<void>('copy_sign_in_code', { code }),
    openChat: target => invoke<void>('open_chat', target),
    dockChat: panelId => invoke<void>('dock_chat', { panelId }),
    openArtifact: target => invoke<void>('open_artifact', target),
  }), [followRestart, notifies]);
  const saveSelection = useCallback((target: { collectionId: string; sessionId: string; commandId: string }) => host.saveTarget({ ...target, commandsOpen: false }), [host]);
  const openViewer = useCallback((sessionId: string, commandId: string) => invoke<void>('open_console', { sessionId, commandId }), []);
  useEffect(() => {
    let disposed = false; let stop: (() => void) | undefined;
    void listen<string>('desktop-error', event => setError(event.payload)).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; });
    return () => { disposed = true; stop?.(); };
  }, []);
  const action = async (callback: () => Promise<void>) => { try { await callback(); setError(''); } catch (error) { setError(String(error)); } };
  return <div className="desktop-root">
    {bootstrap.kind !== 'workspace' && <WindowControls applicationName={bootstrap.applicationName} onWorkspace={() => void action(host.reopenAgent)} onReopenClosed={() => void action(host.reopenClosed)} onReconnect={() => void action(host.reconnect)}/>}
    {error && <div className="error" role="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {bootstrap.kind === 'artifact' ? <ArtifactWindow connection={{ baseUrl: bootstrap.url, token: bootstrap.token, fetch: fetchRunner, renew }} collectionId={bootstrap.target.collectionId || ''} artifactId={bootstrap.target.artifactId || ''}/> : bootstrap.kind === 'workspace' ? <Workspace
      fixedWorkspaceId={bootstrap.fixedWorkspaceId || undefined}
      connection={{ baseUrl: bootstrap.url, token: bootstrap.token, fetch: fetchRunner, renew }}
      viewState={viewState} host={workspaceHost} onTargetChange={saveSelection} onOpenViewer={openViewer}
      initialTarget={{ collectionId: bootstrap.target.collectionId || '', sessionId: bootstrap.target.sessionId, commandId: bootstrap.target.commandId }}
    /> : <AgentWindow
      connection={{ baseUrl: bootstrap.url, token: bootstrap.token, fetch: fetchRunner, renew }}
      agent="claude" mode={bootstrap.kind === 'console' ? 'console' : 'agent'} viewState={viewState}
      collectionId={bootstrap.target.collectionId} allowStart={false}
      showCommands={false} embedded={bootstrap.kind === 'chat'}
      workingDirectory={bootstrap.workingDirectory}
      initialSessionId={bootstrap.target.sessionId || undefined}
      initialCommandId={bootstrap.target.commandId || undefined}
      initialCommandsOpen={bootstrap.target.commandsOpen}
      onViewChange={bootstrap.kind === 'console' ? saveTarget : undefined}
      onOpenViewer={openViewer}
    />}
  </div>;
}
// The host rereads this window's Runner locator. A restarted Runner (a Codefly
// hot reload, or Restart Runner from the app) gets a new bearer and may get a
// new port; the window follows it without reloading, whether or not the
// restart was requested here.
const readBootstrap = () => invoke<Bootstrap>('runner_bootstrap');
function DesktopApp() {
  const { value: bootstrap, error, renew, follow } = useRunnerLocator(readBootstrap);
  const [reconnectError, setReconnectError] = useState('');
  const shown = reconnectError || error;
  if (bootstrap) return <>{shown && <div className="error" role="alert">{shown}<button onClick={()=>void invoke('reconnect_view').then(()=>setReconnectError(''),e=>setReconnectError(String(e)))}>Reconnect this window</button></div>}<DesktopWindow bootstrap={bootstrap} followRestart={follow} renew={renew}/></>;
  return <p role={error ? 'alert' : 'status'}>{error ? `Unable to restore this window: ${error}` : 'Restoring your windows…'}</p>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><WindowErrorBoundary development={import.meta.env.DEV}><DesktopApp/></WindowErrorBoundary></React.StrictMode>);
