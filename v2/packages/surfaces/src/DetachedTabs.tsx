import type { Session } from '@lazybox/protocol';
import { resolveTarget, type Panel, type ViewTarget } from './workspace-model';

/** The page's chats that are open in their own windows: go to one, or bring it back. */
export function DetachedTabs({ panels, selection, sessions, onOpen, onDock }: { panels: Panel[]; selection: ViewTarget; sessions?: Session[]; onOpen(panel: Panel): void; onDock(panel: Panel): void }) {
  return <div className="detached-tabs">
    {panels.map(p => <span key={p.id}>
      <button onClick={() => onOpen(p)}>↗ {sessions?.find(s => s.id === resolveTarget(p, selection).sessionId)?.title || 'Chat in separate window'}</button>
      <button onClick={() => onDock(p)}>Bring back</button>
    </span>)}
  </div>;
}
