import { ActionMenu } from './ActionMenu';
import { Icon } from './Icons';
import { openOnboarding } from './Onboarding';

/** Help (?) in the window's header: the welcome, the release notes, shortcuts and the docs. */
export function HelpMenu({ settings = true }: { /** The window has a Settings page (a workspace window does not). */ settings?: boolean }) {
  return <ActionMenu label="Help" className="help-menu" summary={<span className="help-mark" aria-hidden="true">?</span>}>
    <button onClick={() => openOnboarding('welcome')}><Icon name="sparkle" size={14}/><span>Welcome &amp; getting started</span></button>
    <button onClick={() => openOnboarding('whats-new')}><Icon name="notes" size={14}/><span>What's new</span></button>
    {settings && <button onClick={() => openOnboarding('shortcuts')}><Icon name="keyboard" size={14}/><span>Keyboard shortcuts</span></button>}
    {/* Bundled with the app and read offline (DocsViewer.tsx). */}
    <button onClick={() => openOnboarding('docs')}><Icon name="notes" size={14}/><span>Documentation</span></button>
  </ActionMenu>;
}
