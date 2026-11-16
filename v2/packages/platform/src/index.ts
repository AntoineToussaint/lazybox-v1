/** Navigation belongs to a particular native window, not to its execution. */
export type SurfaceTarget = { sessionId: string; commandId: string; commandsOpen: boolean; collectionId?: string; panelId?: string; artifactId?: string; webId?: string; webUrl?: string };
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
/**
 * Where a native web view sits, in the window's CSS pixels, with the
 * viewport it was measured in (the host scales it by the window's zoom).
 */
export type WebViewFrame = { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number };
/** What a native web view reports about its page. Every event names the view (`id`). */
export type WebViewEvent =
  | { id: string; kind: 'loading'; url: string }
  | { id: string; kind: 'loaded'; url: string; title?: string }
  | { id: string; kind: 'title'; title: string }
  /** The page's icon, as a data: image URL. */
  | { id: string; kind: 'icon'; icon: string }
  /** The page tried to open a link Lazybox does not show (mailto:, a custom app scheme…). */
  | { id: string; kind: 'blocked'; url: string }
  /** The page started a download: the viewer never saves files. */
  | { id: string; kind: 'download'; url: string };
/**
 * Native web views over a panel (the desktop app): a real browser engine,
 * so sites that refuse to be framed still show. Each view runs on its own
 * website data, with no access to the app's commands. `id` is unique per window.
 */
export type NativeWebViews = {
  /** Moves the view to `frame` and shows it. With a `url` (its panel's first show)
   * it is created on that page, or taken there if it exists on another; an empty
   * `url` only moves it. */
  show(id: string, url: string, frame: WebViewFrame, zoom: number): Promise<void>;
  hide(id: string): Promise<void>;
  navigate(id: string, url: string): Promise<void>;
  action(id: string, action: 'reload' | 'stop' | 'focus' | 'close'): Promise<void>;
  zoom(id: string, zoom: number): Promise<void>;
  /** Every view's events in this window; returns the unsubscribe. */
  subscribe(listener: (event: WebViewEvent) => void): () => void;
};
/** A web page in a window of its own (a detached Web panel). */
export type WebWindowTarget = { webId: string; url: string; collectionId: string };
export type WorkspaceHost = AttentionHost & {
  /** Opens a link in the person's browser (http, https and mailto only). */
  openLink?(url: string): Promise<void>;
  /** Native web views for the Web panel and Preview; without them both use an iframe. */
  webViews?: NativeWebViews;
  /** Opens a web page in its own window, with the viewer's toolbar. */
  openWebWindow?(target: WebWindowTarget): Promise<void>;
 reconnect?(): Promise<void>; /** Before Restart Runner: follow the restarted Runner, even on a new port, without reloading. */ expectRunnerRestart?(): Promise<void>;  openWorkspace?(collectionId: string): Promise<void>; chooseRepositoryFolder?(): Promise<string | null>; openSignIn?(url: string): Promise<void>; copySignInCode?(code: string): Promise<void>; openChat(target: ChatTarget): Promise<void>; /** An artifact page in its own window; reuses that artifact's window when open. */ openArtifact?(target: ArtifactTarget): Promise<void>; dockChat(panelId: string): Promise<void> };
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
