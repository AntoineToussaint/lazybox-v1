/** Navigation belongs to a particular native window, not to its execution. */
export type SurfaceTarget = { sessionId: string; commandId: string; commandsOpen: boolean; collectionId?: string; panelId?: string; artifactId?: string };
export type ChatTarget = { panelId: string; collectionId: string; sessionId: string };
export type ArtifactTarget = { collectionId: string; artifactId: string };
/** A conversation that needs the person, as a native notification. */
export type AttentionNotice = { key: string; title: string; body: string; collectionId: string; sessionId: string };
export type AttentionDestination = { collectionId: string; sessionId: string };
export type NotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported';
/** What a host offers for attention: notifications, a dock badge, and the conversation a clicked notification asks for. */
export type AttentionHost = {
  notifyAttention?(notice: AttentionNotice): Promise<void>;
  setAttentionBadge?(count: number): Promise<void>;
  /** Calls `listener` for each clicked notification; returns the unsubscribe. */
  onAttentionOpen?(listener: (destination: AttentionDestination) => void): () => void;
  notificationPermission?(): Promise<NotificationPermission>;
  requestNotificationPermission?(): Promise<NotificationPermission>;
};
export type WorkspaceHost = AttentionHost & { reconnect?(): Promise<void>; /** Before Restart Runner: follow the restarted Runner, even on a new port, without reloading. */ expectRunnerRestart?(): Promise<void>;  openWorkspace?(collectionId: string): Promise<void>; chooseRepositoryFolder?(): Promise<string | null>; openSignIn?(url: string): Promise<void>; /** Opens a workspace preview (a loopback http URL) in the system browser. */ openPreview?(url: string): Promise<void>; copySignInCode?(code: string): Promise<void>; openChat(target: ChatTarget): Promise<void>; /** An artifact page in its own window; reuses that artifact's window when open. */ openArtifact?(target: ArtifactTarget): Promise<void>; dockChat(panelId: string): Promise<void> };
export type ViewStateStore = {
  key: string;
  /** Resolved authority scope shared by panels moved between native windows. */
  scope?: string;
  /** Runner authority every window shares; app-wide preferences are saved under it. */
  root?: string;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};
export type SurfaceHost = {
  saveTarget(target: SurfaceTarget): Promise<void>;
  reopenAgent(): Promise<void>;
  reopenClosed(): Promise<void>;
  reconnect(): Promise<void>;
};
