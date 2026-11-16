import { peekProps } from './peek-model';
import { useContext, useMemo, useRef, useState } from 'react';
import type { Artifact, Collection } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import { ArtifactHostContext, ArtifactPage } from './ArtifactPage';
import { ContextMenu, menuPoint, type ContextMenuState } from './ContextMenu';
import { DeleteArtifactDialog } from './ArtifactDialogs';
import { asKind, kindIcon, kindLabel, updatedLine } from './artifact-model';
import { useArtifactSelection } from './artifact-events';
import { useArtifacts, useOtherArtifacts } from './useArtifacts';
import { useWorkConversation } from './PullRequestFlow';
import { Icon } from './Icons';
import type { ViewTarget } from './workspace-model';
import './artifacts.css';

/**
 * The Artifacts panel: a workspace's plans, reports, specs and notes. The list
 * and the open page sit side by side when the panel is wide, and one at a
 * time when it is narrow.
 */
export function ArtifactsPanel({ workspaceId, collections, viewState, target, onShowSession }: { workspaceId: string; collections: Collection[]; viewState?: ViewStateStore; target: ViewTarget; onShowSession?(target: ViewTarget): void }) {
  const key = viewState ? `${viewState.key}:artifact:${workspaceId}` : '';
  const [selected, setSelectedState] = useState(() => { try { return key ? viewState!.getItem(key) || '' : ''; } catch { return ''; } });
  const setSelected = (id: string) => { setElsewhere(undefined); setSelectedState(id); try { if (key) viewState!.setItem(key, id); } catch { /* a convenience */ } };
  const { artifacts, loaded, error } = useArtifacts(workspaceId);
  // Artifacts live in the workspace that made them; the others stay one click away.
  const others = useOtherArtifacts(collections, workspaceId);
  const [elsewhere, setElsewhere] = useState<{ collectionId: string; id: string }>();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<ContextMenuState>(), [deleting, setDeleting] = useState<Artifact>();
  const host = useContext(ArtifactHostContext);
  const list = useRef<HTMLUListElement>(null);
  useArtifactSelection(workspaceId, setSelected);
  const conversation = useWorkConversation(workspaceId, target.collectionId === workspaceId ? target.sessionId : '');
  const collection = collections.find(value => value.id === workspaceId);
  const shown = useMemo(() => { const q = query.trim().toLowerCase(); return q ? artifacts.filter(a => a.title.toLowerCase().includes(q) || a.kind.includes(q) || a.trackedPath.toLowerCase().includes(q)) : artifacts; }, [artifacts, query]);
  const other = elsewhere ? others.find(o => o.collectionId === elsewhere.collectionId && o.artifact.id === elsewhere.id) : undefined;
  const current = other ? other.artifact : artifacts.find(a => a.id === selected);
  const currentCollectionId = other ? other.collectionId : workspaceId;
  if (!workspaceId) return <p className="module-empty">Choose a workspace to see its artifacts.</p>;
  const focusRow = (id: string) => requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-artifact-id="${CSS.escape(id)}"]`)?.focus());
  const rowMenu = (artifact: Artifact, point: { x: number; y: number }, returnFocus: HTMLElement | null) => setMenu({ ...point, label: `${artifact.title} actions`, returnFocus, items: [
    { label: 'Open', icon: 'artifact', run: () => setSelected(artifact.id) },
    ...(host.openArtifact ? [{ label: 'Open in its own window', icon: 'external', run: () => void host.openArtifact!({ collectionId: workspaceId, artifactId: artifact.id }) }] : []),
    { label: 'Delete…', icon: 'cross', danger: true, separatorBefore: true, run: () => setDeleting(artifact) },
  ] });
  return <div className={`artifacts-panel${current ? ' has-selection' : ''}`}>
    <section className="artifacts-list" aria-label="Artifacts">
      <header className="artifacts-list-header">
        <strong>{loaded ? `${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'}` : 'Loading…'}</strong>
        {artifacts.length > 4 && <label className="artifacts-search"><Icon name="search" size={13}/><input type="search" placeholder="Filter" aria-label="Filter artifacts" value={query} onChange={event => setQuery(event.target.value)}/></label>}
      </header>
      {error && <p className="artifact-error" role="alert">{error}</p>}
      {loaded && !artifacts.length && !error && <div className="artifacts-empty">
        <Icon name="artifact" size={26}/>
        <strong>{others.length ? 'None in this workspace' : 'No artifacts yet'}</strong>
        <p>{others.length ? `${others.length} in other workspaces, listed below.` : 'Plans, reports and specs worth keeping get their own page here, with versions.'}</p>
        <ul><li>Right-click an agent message → <em>Track as artifact…</em></li><li>Right-click a Markdown file in Files → <em>Track as artifact</em></li><li>Agents publish with <code>lazybox artifact put</code></li></ul>
      </div>}
      <ul ref={list} role="listbox" aria-label="Artifacts" className="artifacts-rows" onKeyDown={event => {
        const index = shown.findIndex(a => a.id === (document.activeElement as HTMLElement | null)?.dataset.artifactId);
        const step = event.key === 'ArrowDown' || event.key === 'j' ? 1 : event.key === 'ArrowUp' || event.key === 'k' ? -1 : 0;
        if (step && shown.length) { event.preventDefault(); focusRow(shown[Math.max(0, Math.min(shown.length - 1, index + step))].id); }
      }}>
        {shown.map((artifact, i) => {
          const kind = asKind(artifact.kind);
          const active = artifact.id === selected;
          return <li key={artifact.id} role="option" aria-selected={active} data-artifact-id={artifact.id} {...peekProps({ kind: 'artifact', workspaceId, artifactId: artifact.id, title: artifact.title })} tabIndex={active || (!current && i === 0) ? 0 : -1}
            className="artifact-row" onClick={() => setSelected(artifact.id)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(artifact.id); } if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); setDeleting(artifact); } if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const r = event.currentTarget.getBoundingClientRect(); rowMenu(artifact, { x: r.left + 24, y: r.bottom - 4 }, event.currentTarget); } }}
            onContextMenu={event => { if (event.shiftKey) return; event.preventDefault(); rowMenu(artifact, menuPoint(event), event.currentTarget); }}>
            <span className={`artifact-kind-icon kind-${kind}`} title={kindLabel[kind]}><Icon name={kindIcon[kind]} size={16}/></span>
            <span className="artifact-row-text">
              <strong>{artifact.title}</strong>
              <small>{updatedLine(artifact)}</small>
              {(artifact.trackedPath || artifact.trackingProblem) && <small className={artifact.trackingProblem ? 'artifact-row-problem' : 'artifact-row-file'}>{artifact.trackingProblem ? <><Icon name="alert" size={11}/>{artifact.trackingProblem}</> : <><Icon name="refresh" size={11}/>{artifact.trackedPath}</>}</small>}
            </span>
          </li>;
        })}
        {query && !shown.length && <li className="artifacts-none">No artifact matches “{query}”.</li>}
      </ul>
      {others.length > 0 && <section className="artifacts-elsewhere" aria-label="Artifacts in other workspaces">
        <h4>In other workspaces</h4>
        <ul role="listbox" aria-label="Artifacts in other workspaces" className="artifacts-rows">
          {others.filter(o => !query.trim() || o.artifact.title.toLowerCase().includes(query.trim().toLowerCase())).map(o => {
            const kind = asKind(o.artifact.kind), active = elsewhere?.collectionId === o.collectionId && elsewhere.id === o.artifact.id;
            return <li key={o.collectionId + '/' + o.artifact.id} role="option" aria-selected={active} tabIndex={0} className="artifact-row" data-artifact-id={o.artifact.id}
              onClick={() => setElsewhere({ collectionId: o.collectionId, id: o.artifact.id })}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setElsewhere({ collectionId: o.collectionId, id: o.artifact.id }); } }}>
              <span className={`artifact-kind-icon kind-${kind}`} title={kindLabel[kind]}><Icon name={kindIcon[kind]} size={16}/></span>
              <span className="artifact-row-text"><strong>{o.artifact.title}</strong><small>{o.workspace} · {updatedLine(o.artifact)}</small></span>
            </li>;
          })}
        </ul>
      </section>}
    </section>
    {current ? <ArtifactPage key={currentCollectionId + '/' + current.id} collectionId={currentCollectionId} artifactId={current.id} summary={current} collection={other ? collections.find(c => c.id === other.collectionId) : collection}
      onBack={() => { const id = current.id; setSelected(''); focusRow(id); }} onShowSession={onShowSession}
      conversationId={conversation?.id} conversationTitle={conversation?.title} onDeleted={() => setSelected('')}/>
      : artifacts.length > 0 && <div className="artifact-page is-placeholder"><p className="module-empty">Choose an artifact to read it.</p></div>}
    {menu && <ContextMenu menu={menu} onClose={() => setMenu(undefined)}/>}
    {deleting && <DeleteArtifactDialog artifact={deleting} onClose={() => setDeleting(undefined)} onDeleted={() => { if (deleting.id === selected) setSelected(''); setDeleting(undefined); }}/>}
  </div>;
}
