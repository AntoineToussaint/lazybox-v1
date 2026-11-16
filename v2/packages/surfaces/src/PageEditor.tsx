import { useState } from 'react';
import type { PanelModule } from './PanelRegistry';
import { clonePage, defaultLayout, panels, type WorkspaceLayout, type WorkspacePage } from './workspace-model';

/** Customizing a page: its name, duplicating or removing it, adding panels, resetting all pages. */
export function PageConfig({ page, layout, registry, module, hasDetached, pending, onModule, commit, changePage }: {
  page: WorkspacePage;
  layout: WorkspaceLayout;
  registry: Readonly<Record<string, PanelModule>>;
  /** The kind the next added panel has. */
  module: string;
  hasDetached: boolean;
  pending: boolean;
  onModule(kind: string): void;
  commit(next: WorkspaceLayout, reset?: boolean): boolean;
  changePage(next: WorkspacePage): boolean;
}) {
  const duplicate = () => { const next = clonePage(page, () => crypto.randomUUID()); commit({ ...layout, selectedPage: next.id, pages: [...layout.pages, next] }); };
  const remove = () => commit({ ...layout, selectedPage: layout.pages.find(value => value.id !== page.id)!.id, pages: layout.pages.filter(value => value.id !== page.id) });
  const addPanel = () => changePage({ ...page, layout: { type: 'split', direction: 'row', ratio: 0.65, children: [page.layout, { type: 'panel', panel: { id: crypto.randomUUID(), kind: module, binding: { mode: 'follow' }, detached: false } }] } });
  return <div className="page-config">
    <PageName key={page.id} name={page.name} onSave={name => changePage({ ...page, name })}/>
    <button disabled={layout.pages.length >= 8} onClick={duplicate}>Duplicate page</button>
    <button disabled={layout.pages.length <= 1 || layout.pages.some(value => value.id === page.id && panels(value.layout).some(panel => panel.detached))} onClick={remove}>Remove page</button>
    <label>Add panel<select value={module} onChange={event => onModule(event.target.value)}>
      {Object.entries(registry).map(([kind, module]) => <option key={kind} value={kind}>{module.title}</option>)}
    </select></label>
    <button disabled={panels(page.layout).length >= 12} onClick={addPanel}>Add panel</button>
    <button disabled={hasDetached || pending} onClick={() => commit(defaultLayout(page.selection), true)}>Reset pages</button>
  </div>;
}

function PageName({ name, onSave }: { name: string; onSave(name: string): void }) {
  const [draft, setDraft] = useState(name);
  return <form onSubmit={event => { event.preventDefault(); onSave(draft); }}>
    <label>Page name<input required maxLength={64} value={draft} onChange={event => setDraft(event.target.value)}/></label>
    <button>Rename page</button>
  </form>;
}

/** The pages as JSON: panel references and arrangement, to inspect or import. */
export function LayoutConfiguration({ json, disabled, onChange, onImport, onClose }: { json: string; disabled: boolean; onChange(json: string): void; onImport(): void; onClose(): void }) {
  return <section className="layout-json">
    <div className="inspector-heading">
      <strong>Page configuration</strong>
      <button className="icon-button" aria-label="Close layout configuration" onClick={onClose}>×</button>
    </div>
    <label className="sr-only" htmlFor="page-config-json">Page configuration</label>
    <textarea id="page-config-json" value={json} onChange={event => onChange(event.target.value)} spellCheck={false}/>
    <button disabled={disabled} onClick={onImport}>Import layout</button>
    <small>Panel references and arrangement only. Your account and permissions stay unchanged.</small>
  </section>;
}
