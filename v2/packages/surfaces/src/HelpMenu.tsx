import { ActionMenu } from './ActionMenu';
import { Icon } from './Icons';
import { DOCS_URL, openOnboarding } from './Onboarding';

/** Help (?) in the window's header: the welcome, the release notes, shortcuts and the docs. */
export function HelpMenu({ settings = true }: { /** The window has a Settings page (a workspace window does not). */ settings?: boolean }) {
  return <ActionMenu label="Help" className="help-menu" summary={<span className="help-mark" aria-hidden="true">?</span>}>
    <button onClick={() => openOnboarding('welcome')}><Icon name="sparkle" size={14}/><span>Welcome &amp; getting started</span></button>
    <button onClick={() => openOnboarding('whats-new')}><Icon name="notes" size={14}/><span>What's new</span></button>
    {settings && <button onClick={() => openOnboarding('shortcuts')}><Icon name="keyboard" size={14}/><span>Keyboard shortcuts</span></button>}
    {/* The desktop app sends window.open for a web page to the browser. */}
    <button onClick={() => window.open(DOCS_URL, '_blank', 'noopener,noreferrer')}><Icon name="external" size={14}/><span>Documentation</span></button>
  </ActionMenu>;
}
