import { useFileOpener } from './file-links';
import { CodeBlock } from './RichContent';
import { useEffect, useState } from 'react';
import type { ViewStateStore } from '@lazybox/platform';
import type { ChangedFile, RepositoryChanges, Session, WorkspaceDiff } from '@lazybox/protocol';
import { useRunner } from './RunnerContext';
import { RepositoryShip, useWorkConversation } from './PullRequestFlow';
import { composeInConversation } from './compose';
import type { ViewTarget } from './workspace-model';

type Selection = { member: string; path: string; committed: boolean };

// Compare choices: uncommitted work only, the commit the workspace started
// from, or any branch (default branch first), compared from their merge base.
const UNCOMMITTED = ':uncommitted', START = ':start';
const compareRef = (compare: string) => compare === UNCOMMITTED || compare === START ? '' : compare;

const notices = new Map<string, string>();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const age = (unix: bigint) => {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - Number(unix)) / 60));
  return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`;
};

/** A workspace-scoped projection; all Git operations belong to the Runner.
 * It shows what the branch committed since the workspace started, then what is
 * still uncommitted: an agent's work is usually in both. Each repository has
 * its PR loop (commit, push, pull request, checks, merge) above its files. */
export function ChangesPanel({ workspaceId, viewState, sessionId = '', onShowSession }: { workspaceId: string; viewState?: ViewStateStore; sessionId?: string; onShowSession?(target: ViewTarget): void }) {
  const { api } = useRunner();
  const conversation = useWorkConversation(workspaceId, sessionId);
  const [notice, setNotice] = useState(() => { const value = notices.get(workspaceId) || ''; notices.delete(workspaceId); return value; });
  // Failing checks go to the message box of the conversation that did the
  // work, opened beside this page, for the person to review and send.
  const sendToAgent = (text: string) => {
    if (!conversation) { void navigator.clipboard?.writeText(text).catch(() => {}); setNotice('No conversation in this workspace yet. The failing checks were copied: start one and paste them.'); return; }
    const said = `Added to the message box of “${conversation.title || 'the conversation'}”. Review it and send.`;
    composeInConversation({ sessionId: conversation.id, text });
    // Opening the chat beside this panel remounts it; the notice survives that.
    notices.set(workspaceId, said); setNotice(said);
    onShowSession?.({ collectionId: workspaceId, sessionId: conversation.id, commandId: '' });
  };
  const fileLinks = useFileOpener(workspaceId, viewState);
  const [repos, setRepos] = useState<RepositoryChanges[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [compare, setCompare] = useState<string>(START), [selection, setSelection] = useState<Selection>(), [staged, setStaged] = useState(false), [savedDiff, setDiff] = useState<{ key: string; value: WorkspaceDiff }>(), [diffError, setDiffError] = useState('');
  useEffect(() => {
    if (!workspaceId) { setLoading(false); return; }
    const control = new AbortController(); let busy = false;
    const load = async () => {
      if (busy) return; busy = true;
      try { const result = await api.listWorkspaceChanges({ collectionId: workspaceId, compare: compareRef(compare) }, { signal: control.signal, timeoutMs: 20000 }); if (!control.signal.aborted) { setRepos(result.repositories); setError(''); } }
      catch (e) { if (!control.signal.aborted) setError(String(e)); }
      finally { busy = false; if (!control.signal.aborted) setLoading(false); }
    };
    void load(); const timer = setInterval(() => void load(), 10000); return () => { control.abort(); clearInterval(timer); };
  }, [api, workspaceId, revision, compare]);
  const choose = (member: string, file: ChangedFile, committed: boolean) => { setSelection({ member, path: file.path, committed }); setStaged(!committed && file.worktreeStatus === ' ' && file.indexStatus !== '?'); };
  // A file committed (or reverted) since it was chosen leaves its list; choose again.
  useEffect(() => {
    if (!selection) return;
    const repo = repos.find(value => value.member === selection.member);
    if (repo && !(selection.committed ? repo.committed : repo.files).some(file => file.path === selection.path)) setSelection(undefined);
  }, [repos]);
  // Open the first change instead of an empty "select a file" pane.
  useEffect(() => {
    if (selection) return;
    for (const repo of repos) {
      if (compare !== UNCOMMITTED && repo.committed[0]) { choose(repo.member, repo.committed[0], true); return; }
      if (repo.files[0]) { choose(repo.member, repo.files[0], false); return; }
    }
  }, [repos, selection, compare]);
  const diffKey = JSON.stringify([workspaceId, selection, staged, revision, compare]);
  const diff = savedDiff?.key === diffKey ? savedDiff.value : undefined;
  useEffect(() => {
    setDiff(undefined); setDiffError(''); if (!selection) return;
    const control = new AbortController();
    void api.readWorkspaceDiff({ collectionId: workspaceId, member: selection.member, path: selection.path, staged: !selection.committed && staged, committed: selection.committed, compare: compareRef(compare) }, { signal: control.signal, timeoutMs: 20000 })
      .then(value => { if (!control.signal.aborted) setDiff({ key: diffKey, value }); }, error => { if (!control.signal.aborted) setDiffError(String(error)); });
    return () => control.abort();
  }, [api, workspaceId, selection, staged, revision, compare, diffKey]);
  if (!workspaceId) return <p className="module-empty">Choose a workspace to review its changes.</p>;
  const showCommitted = compare !== UNCOMMITTED;
  const committed = showCommitted ? repos.reduce((sum, repo) => sum + repo.committed.length, 0) : 0, uncommitted = repos.reduce((sum, repo) => sum + repo.files.length, 0);
  const summary = loading ? 'Reading changes…' : !committed && !uncommitted ? 'No changes yet' : [committed && `${plural(committed, 'file')} changed ${compare === START ? 'on the branch' : 'vs ' + compare}`, uncommitted && `${uncommitted} uncommitted`].filter(Boolean).join(' · ');
  const refresh = () => setRevision(value => value + 1);
  return <section className="changes-panel" aria-label="Workspace changes">
    <ChangesHeader summary={summary} compare={compare} repos={repos} onCompare={value => { setCompare(value); setSelection(undefined); }} onRefresh={refresh}/>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="changes-notice" role="status"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></p>}
    <div className="changes-columns">
      <nav aria-label="Changed files">
        {repos.map(repo => <RepositoryFiles key={repo.member} workspaceId={workspaceId} repo={repo} compare={compare} selection={selection} conversation={conversation} onChoose={choose} onChanged={refresh} onSendToAgent={sendToAgent}/>)}
      </nav>
      <div className="diff-view">
        {selection
          ? <>
            <header>
              <strong>{selection.member}/{selection.path}</strong>
              <button title="Open in the editor · Alt-click for a quick look" onClick={event => void fileLinks.open({ path: `${selection.member}/${selection.path}` }, event, { exact: true })}>Open file</button>
              {!selection.committed && <label><input type="checkbox" checked={staged} onChange={event => setStaged(event.target.checked)}/> Staged</label>}
            </header>
            <div className="diff-comparison">{selection.committed ? (compare === START ? 'Workspace start → latest commit' : `${compare} (merge base) → latest commit`) : staged ? 'Last commit → staged' : 'Staged → working tree (uncommitted)'}</div>
            <DiffBody diff={diff} error={diffError} empty={selection.committed ? 'branch' : staged ? 'staged' : 'unstaged'}/>
          </>
          : <div className="diff-empty"><h3>{loading ? 'Reading changes…' : 'No changes yet'}</h3><p>Nothing has been committed or edited in this workspace since it started.</p></div>}
      </div>
    </div>
    {fileLinks.element}
  </section>;
}

/** What changed in total, what it is compared with, and a refresh. */
function ChangesHeader({ summary, compare, repos, onCompare, onRefresh }: { summary: string; compare: string; repos: RepositoryChanges[]; onCompare(compare: string): void; onRefresh(): void }) {
  const defaults = [...new Set(repos.map(repo => repo.defaultBranch).filter(Boolean))];
  const current = new Set(repos.map(repo => repo.branch));
  const others = [...new Set(repos.flatMap(repo => repo.branches))].filter(name => !defaults.includes(name) && !current.has(name)).sort();
  if (compare !== UNCOMMITTED && compare !== START && !defaults.includes(compare) && !others.includes(compare)) others.unshift(compare);
  return <header>
    <div>
      <strong>{summary}</strong>
      <small>{compare === UNCOMMITTED ? 'Staged, unstaged and untracked files' : compare === START ? 'Since the workspace started, plus uncommitted work' : `Branch commits since it left ${compare}, plus uncommitted work`}</small>
    </div>
    <label className="changes-compare">Compare with<select value={compare} onChange={event => onCompare(event.target.value)}>
      <option value={UNCOMMITTED}>Uncommitted only</option>
      <option value={START}>Workspace start</option>
      {defaults.map(name => <option key={'d:' + name} value={name}>{name}</option>)}
      {others.length > 0 && <optgroup label="Other branches">{others.map(name => <option key={name} value={name}>{name}</option>)}</optgroup>}
    </select></label>
    <button onClick={onRefresh}>Refresh changes</button>
  </header>;
}

/** One repository: its PR loop, then its committed and uncommitted files. */
function RepositoryFiles({ workspaceId, repo, compare, selection, conversation, onChoose, onChanged, onSendToAgent }: {
  workspaceId: string;
  repo: RepositoryChanges;
  compare: string;
  selection?: Selection;
  conversation?: Session;
  onChoose(member: string, file: ChangedFile, committed: boolean): void;
  onChanged(): void;
  onSendToAgent(text: string): void;
}) {
  const showCommitted = compare !== UNCOMMITTED;
  const fileButton = (file: ChangedFile, isCommitted: boolean) => <button key={(isCommitted ? 'c:' : 'u:') + file.path} className={selection?.member === repo.member && selection.path === file.path && selection.committed === isCommitted ? 'selected' : ''} onClick={() => onChoose(repo.member, file, isCommitted)}>
    <code title={isCommitted ? 'Change since the workspace started' : 'Index / working tree status'}>{isCommitted ? file.indexStatus : file.indexStatus + file.worktreeStatus}</code>
    <span>{file.path}{file.originalPath && <small>from {file.originalPath}</small>}</span>
  </button>;
  return <section>
    <h3>{repo.member}<small>{repo.branch === 'HEAD' ? 'Detached HEAD' : repo.branch} · {repo.head.slice(0, 8)}</small></h3>
    <RepositoryShip workspaceId={workspaceId} repo={repo} conversation={conversation} onChanged={onChanged} onSendToAgent={onSendToAgent}/>
    {repo.error ? <p role="alert" className="error">{repo.error}</p> : <>
      {!showCommitted ? null : repo.committedError ? <p className="module-empty" role="status">Branch changes unavailable: {repo.committedError}</p> : repo.committed.length > 0 && <div className="changes-group">
        <h4>{compare === START ? 'Committed on this branch' : `Committed vs ${compare}`}</h4>
        <details className="changes-commits">
          <summary>{plural(repo.commits.length, 'commit')}{compare === START ? (repo.base ? ` since ${repo.base.slice(0, 8)}` : '') : ` not on ${compare}`}</summary>
          <ol>{repo.commits.map(c => <li key={c.id}><code>{c.id.slice(0, 8)}</code><span>{c.subject}</span><small>{age(c.committedAtUnix)}</small></li>)}</ol>
        </details>
        {repo.committed.map(file => fileButton(file, true))}
        {repo.committedTruncated && <p role="status">Limited. Some branch changes are not shown.</p>}
      </div>}
      {repo.files.length > 0 && <div className="changes-group">
        <h4>Uncommitted</h4>
        {repo.files.map(file => fileButton(file, false))}
        {repo.truncated && <p role="status">File list limited. Some changes are not shown.</p>}
      </div>}
      {!repo.files.length && (!showCommitted || !repo.committed.length) && !repo.committedError && <p className="module-empty">{compare === UNCOMMITTED ? 'No uncommitted changes' : compare === START ? 'No changes since the workspace started' : `No changes vs ${compare}`}</p>}
    </>}
  </section>;
}

/** The selected file's diff, or why there is none. */
function DiffBody({ diff, error, empty }: { diff?: WorkspaceDiff; error: string; empty: 'branch' | 'staged' | 'unstaged' }) {
  if (error) return <p role="alert" className="error">{error}</p>;
  if (!diff) return <p role="status">Loading diff…</p>;
  return <>
    {diff.truncated && <p role="status">Preview limited to 1 MiB.</p>}
    {diff.binary
      ? <p>Binary file · text preview unavailable</p>
      : diff.text
        ? <CodeBlock text={diff.text} language="diff" label="File diff"/>
        : <p className="module-empty">No {empty} diff for this file. Refresh if the agent has changed it.</p>}
  </>;
}
