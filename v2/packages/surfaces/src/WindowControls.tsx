import { ActionMenu } from './ActionMenu';
import { Icon } from './Icons';

/**
 * A detached chat or console window's own controls: one quiet row. Back to
 * the workspace is the one action people use; reopening a closed window and
 * reconnecting (rarely needed, the window follows Runner restarts) live in ⋯.
 */
export function WindowControls({ applicationName, onWorkspace, onReopenClosed, onReconnect }: { applicationName: string; onWorkspace(): void; onReopenClosed(): void; onReconnect(): void }) {
  return <nav className="native-toolbar" aria-label="Window controls">
    <button className="icon-button window-back" aria-label="← Workspace" title="Back to the workspace" onClick={onWorkspace}><Icon name="back" size={15}/></button>
    <span className="application-name">{applicationName}</span>
    <ActionMenu className="window-menu" label="Window actions">
      <button onClick={onReopenClosed}>Reopen closed window</button>
      <button onClick={onReconnect}>Reconnect this window</button>
    </ActionMenu>
  </nav>;
}
