import { FilePreview } from './FilePreview';
import { CodeBlock } from './RichContent';
import { useEffect, useState } from 'react';
import type { ChangedFile, RepositoryChanges, WorkspaceDiff } from '@lazybox/protocol';
import { useRunner } from './RunnerContext';

type Selection = { member: string; path: string; committed: boolean };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const age = (unix: bigint) => {
 const minutes = Math.max(0, Math.round((Date.now() / 1000 - Number(unix)) / 60));
 return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`;
};

/** A workspace-scoped read-only projection. All Git operations belong to Runner.
 * It shows what the branch committed since the workspace started, then what is
 * still uncommitted: an agent's work is usually in both. */
export function ChangesPanel({workspaceId}:{workspaceId:string}) {
 const {api}=useRunner();
 const [preview,setPreview]=useState<string>();
 const [repos,setRepos]=useState<RepositoryChanges[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 const [selection,setSelection]=useState<Selection>(),[staged,setStaged]=useState(false),[savedDiff,setDiff]=useState<{key:string;value:WorkspaceDiff}>(),[diffError,setDiffError]=useState('');
 useEffect(()=>{
  if(!workspaceId){setLoading(false);return;}
  const control=new AbortController();let busy=false;
  const load=async()=>{if(busy)return;busy=true;try{const result=await api.listWorkspaceChanges({collectionId:workspaceId},{signal:control.signal,timeoutMs:20000});if(!control.signal.aborted){setRepos(result.repositories);setError('');}}catch(e){if(!control.signal.aborted)setError(String(e));}finally{busy=false;if(!control.signal.aborted)setLoading(false);}};
  void load();const timer=setInterval(()=>void load(),10000);return()=>{control.abort();clearInterval(timer);};
 },[api,workspaceId,revision]);
 const choose=(member:string,file:ChangedFile,committed:boolean)=>{setSelection({member,path:file.path,committed});setStaged(!committed&&file.worktreeStatus===' '&&file.indexStatus!=='?');};
 // Open the first change instead of an empty "select a file" pane.
 useEffect(()=>{
  if(selection)return;
  for(const repo of repos){
   if(repo.committed[0]){choose(repo.member,repo.committed[0],true);return;}
   if(repo.files[0]){choose(repo.member,repo.files[0],false);return;}
  }
 },[repos,selection]);
 const diffKey=JSON.stringify([workspaceId,selection,staged,revision]);
 const diff=savedDiff?.key===diffKey?savedDiff.value:undefined;
 useEffect(()=>{
  setDiff(undefined);setDiffError('');if(!selection)return;
  const control=new AbortController();void api.readWorkspaceDiff({collectionId:workspaceId,member:selection.member,path:selection.path,staged:!selection.committed&&staged,committed:selection.committed},{signal:control.signal,timeoutMs:20000}).then(value=>{if(!control.signal.aborted)setDiff({key:diffKey,value});},error=>{if(!control.signal.aborted)setDiffError(String(error));});return()=>control.abort();
 },[api,workspaceId,selection,staged,revision,diffKey]);
 if(!workspaceId)return <p className="module-empty">Choose a workspace to review its changes.</p>;
 const committed=repos.reduce((sum,repo)=>sum+repo.committed.length,0),uncommitted=repos.reduce((sum,repo)=>sum+repo.files.length,0);
 const summary=loading?'Reading changes…':!committed&&!uncommitted?'No changes yet':[committed&&`${plural(committed,'file')} changed on the branch`,uncommitted&&`${uncommitted} uncommitted`].filter(Boolean).join(' · ');
 const fileButton=(repo:RepositoryChanges,file:ChangedFile,isCommitted:boolean)=><button key={(isCommitted?'c:':'u:')+file.path} className={selection?.member===repo.member&&selection.path===file.path&&selection.committed===isCommitted?'selected':''} onClick={()=>choose(repo.member,file,isCommitted)}><code title={isCommitted?'Change since the workspace started':'Index / working tree status'}>{isCommitted?file.indexStatus:file.indexStatus+file.worktreeStatus}</code><span>{file.path}{file.originalPath&&<small>from {file.originalPath}</small>}</span></button>;
 return <section className="changes-panel" aria-label="Workspace changes">
  <header><div><strong>{summary}</strong><small>Since the workspace started, including uncommitted work</small></div><button onClick={()=>setRevision(value=>value+1)}>Refresh changes</button></header>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="changes-columns"><nav aria-label="Changed files">{repos.map(repo=><section key={repo.member}>
   <h3>{repo.member}<small>{repo.branch==='HEAD'?'Detached HEAD':repo.branch} · {repo.head.slice(0,8)}</small></h3>
   {repo.error?<p role="alert" className="error">{repo.error}</p>:<>
    {repo.committedError?<p className="module-empty" role="status">Branch changes unavailable: {repo.committedError}</p>:repo.committed.length>0&&<div className="changes-group">
     <h4>Committed on this branch</h4>
     <details className="changes-commits"><summary>{plural(repo.commits.length,'commit')}{repo.base?` since ${repo.base.slice(0,8)}`:''}</summary><ol>{repo.commits.map(c=><li key={c.id}><code>{c.id.slice(0,8)}</code><span>{c.subject}</span><small>{age(c.committedAtUnix)}</small></li>)}</ol></details>
     {repo.committed.map(file=>fileButton(repo,file,true))}
     {repo.committedTruncated&&<p role="status">Limited. Some branch changes are not shown.</p>}
    </div>}
    {repo.files.length>0&&<div className="changes-group"><h4>Uncommitted</h4>{repo.files.map(file=>fileButton(repo,file,false))}{repo.truncated&&<p role="status">File list limited. Some changes are not shown.</p>}</div>}
    {!repo.files.length&&!repo.committed.length&&!repo.committedError&&<p className="module-empty">No changes since the workspace started</p>}
   </>}
  </section>)}</nav>
   <div className="diff-view">{selection?<><header><strong>{selection.member}/{selection.path}</strong><button onClick={()=>setPreview(`${selection.member}/${selection.path}`)}>Open file</button>{!selection.committed&&<label><input type="checkbox" checked={staged} onChange={event=>setStaged(event.target.checked)}/> Staged</label>}</header><div className="diff-comparison">{selection.committed?'Workspace start → latest commit':staged?'Last commit → staged':'Staged → working tree (uncommitted)'}</div>{diffError?<p role="alert" className="error">{diffError}</p>:!diff?<p role="status">Loading diff…</p>:<>{diff.truncated&&<p role="status">Preview limited to 1 MiB.</p>}{diff.binary?<p>Binary file · text preview unavailable</p>:diff.text?<CodeBlock text={diff.text} language="diff" label="File diff"/>:<p className="module-empty">No {selection.committed?'branch':staged?'staged':'unstaged'} diff for this file. Refresh if the agent has changed it.</p>}</>}</>:<div className="diff-empty"><h3>{loading?'Reading changes…':'No changes yet'}</h3><p>Nothing has been committed or edited in this workspace since it started.</p></div>}</div>
  </div>
 {preview&&<FilePreview workspaceId={workspaceId} reference={{path:preview}} onClose={()=>setPreview(undefined)}/>}
 </section>;
}
