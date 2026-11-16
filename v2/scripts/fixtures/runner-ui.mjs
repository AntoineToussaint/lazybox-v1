// An explicitly fake RPC authority for isolated browser/native surface checks.
// It neither loads credentials nor runs Git, commands, or model inference.
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const orchestrationProcess = JSON.parse(readFileSync(new URL('./orchestration-process.json', import.meta.url), 'utf8'));

const frame = (value, flag = 0) => { const data = Buffer.from(JSON.stringify(value)); const head = Buffer.alloc(5); head[0] = flag; head.writeUInt32BE(data.length, 1); return Buffer.concat([head, data]); };
const stream = values => Buffer.concat([...values.map(value => frame(value)), frame({}, 2)]);
export async function startRunnerFixture() {
  // A restarted Runner has a new bearer, and a launcher restart a new port: both change.
  let token = randomUUID(), url = '';
  const calls = [], mutations = [];
  const workspaceFiles=new Map();
  // Message attachments the fake Runner retained, by the path its journal lists.
  const attachments=new Map();let attachmentReadDelayMs=0;
  // Every workspace member holds the same small tree, so the Files panel, Go
  // to file and link resolution have folders and names to work with. Paths
  // outside it still read as a generic file, as before.
  const memberTree=['README.md','package.json','config.toml','src/main.go','src/routes.ts','src/components/App.tsx','scripts/build.sh'];
  const uniqueFiles={api:['scripts/undeclared-routes.json']};
  const treeFiles=collectionId=>{const collection=collections.find(c=>c.id===collectionId);return (collection?.members||[]).flatMap(m=>[...memberTree,...(uniqueFiles[m.spec.name]||[])].map(path=>m.spec.name+'/'+path));};
  const treeFolders=collectionId=>{const out=new Set(['.']);for(const file of treeFiles(collectionId)){const parts=file.split('/');for(let i=1;i<parts.length;i++)out.add(parts.slice(0,i).join('/'));}return out;};
  const listFolder=(collectionId,folder)=>{const files=treeFiles(collectionId),folders=treeFolders(collectionId),prefix=folder==='.'?'':folder+'/',seen=new Map();
    for(const path of [...folders,...files]){if(path==='.'||!path.startsWith(prefix))continue;const name=path.slice(prefix.length).split('/')[0];const full=prefix+name;if(!seen.has(full))seen.set(full,{name,path:full,directory:folders.has(full)});}
    return [...seen.values()].sort((a,b)=>a.directory!==b.directory?(a.directory?-1:1):a.name.localeCompare(b.name));};
  const fuzzy=(path,query)=>{const lower=path.toLowerCase(),q=query.toLowerCase().replace(/\s+/g,'');const base=path.lastIndexOf('/')+1;
    const match=from=>{const positions=[];let j=0;for(let i=from;i<lower.length&&j<q.length;i++)if(lower[i]===q[j]){positions.push(i);j++;}return j===q.length?positions:null;};
    const inName=q.includes('/')?null:match(base);const positions=inName||match(0);if(!positions)return null;return {path,positions,score:(inName?100:0)-path.length};};
  const eventStreams=new Map();
  // Messages a conversation accepted while at a subscription limit, by operation.
  const waitingMessages=new WeakMap();
  // A saved conversation's journal is finite: after `complete()` the stream ends
  // like the Runner's does at EOF, instead of staying open for live events.
  const openEvents=id=>{const channel={events:[],clients:new Set(),done:false,push(event){const record={cursor:String(this.events.length+1),event};this.events.push(record);for(const res of this.clients)res.write(frame({...record,retained:record.cursor}));},complete(){this.done=true;for(const res of this.clients)res.end(frame({},2));this.clients.clear();}};eventStreams.set(id,channel);return channel;};
  const collections = ['alpha', 'beta'].map((id, index) => ({ id, name: index ? 'Beta release' : 'Alpha feature', workId: id, root: `/fixture/collections/${id}`, state: 'ready', ownerExecutionId: `${id}-session`, members: ['api', 'web'].map((name, i) => ({ spec: { name, repositoryId: i ? 'frontend' : 'backend', baseRef: 'main', branch: `lazybox/${id}/${name}` }, path: `/fixture/collections/${id}/${name}`, baseCommit: (index ? 'b' : 'a').repeat(40), ready: true })) }));
  const sessions = collections.map(collection => ({ id: `${collection.id}-session`, collectionId: collection.id, workId: collection.id, profileId: 'claude-default', gatewayId: 'direct', workingDirectory: collection.root, capabilities: { files: true, images: true, resume: true, livePermission: true }, permission: 'ask', instructionsPending: collection.id === 'alpha', pending: [] }));
  sessions[0].status = 'running'; sessions[0].agents = [{ id: 'root', name: 'Main agent', status: 'done' }, { id: 'child-review', parentId: 'root', name: 'Review', status: 'running' }];
  const commands = sessions.map(session => ({ id: `${session.collectionId}-command`, sessionId: session.id, title: `${session.collectionId} fixture build`, mode: 'managed', done: true, exitCode: 0, offset: '24' }));
  // startRun stands in for `lazybox run` in a session: a finished pipe with the
  // report of what its agent received.
  const startRun = (sessionId, title, report) => { const command = { id: `run-${commands.length}`, sessionId, title, mode: 'pipe', done: true, offset: '24', report }; commands.push(command); return command; };
  // startTerminalRun stands in for `cmd | lazybox log` in a workspace terminal:
  // a workspace run, optionally shared with a conversation (`--to`).
  const claimedShares = new Set();
  const startTerminalRun = (collectionId, title, report, { shareWith = '', done = true, output = 'fixture retained output\n' } = {}) => { const command = { id: `terminal-run-${commands.length}`, sessionId: '', collectionId, origin: 'terminal', shareWith, title, mode: 'pipe', done, offset: String(Buffer.byteLength(output)), report, output }; commands.push(command); return command; };
  const wireCommand = ({ output, ...command }) => command;
  const listedCommand = command => { const value = wireCommand(command); return value.report ? { ...value, report: { ...value.report, agentView: undefined } } : value; };
  const requests = new Map();
  const library = [{ id: 'backend', path: '/fixture/backend' }, { id: 'frontend', path: '/fixture/frontend' }];
  const github = { state: 'setup_required', clientId: '', appSlug: '', login: '', userId: '0', pendingSignIn: undefined };
  const githubFlows = new Map();
  const discovery = { roots: [] };
  const githubRepositories = [
    { id: '101', name: 'api', fullName: 'fixture-team/api', private: true, defaultBranch: 'main', htmlUrl: 'https://github.com/fixture-team/api' },
    { id: '102', name: 'web', fullName: 'fixture-team/web', private: false, defaultBranch: 'main', htmlUrl: 'https://github.com/fixture-team/web' },
  ];
  let catalogRemote=[], catalogUpdated='0';const preparationFailures=new Set();const prepared=[];
  const catalogEntries=()=>{const rows=new Map();for(const r of catalogRemote)rows.set('github:'+r.fullName.toLowerCase(),{identity:'github:'+r.fullName.toLowerCase(),name:r.fullName});for(const r of discovery.roots.flatMap(root=>root.repositories||[]))rows.set(r.gitIdentity||r.path,{identity:r.gitIdentity||r.path,name:r.gitIdentity?.startsWith('github:')?r.gitIdentity.slice(7):r.name,path:r.path});for(const r of library){const identity=r.gitIdentity||'local:'+r.id;rows.set(identity,{...rows.get(identity),identity,name:r.gitIdentity?.startsWith('github:')?r.gitIdentity.slice(7):r.name||r.id,repositoryId:r.id});}return [...rows.values()];};
  const completeGitHub = () => { github.state = 'connected'; github.authMethod = 'github_app'; github.login = 'fixture-user'; github.userId = '42'; if (github.pendingSignIn) { github.pendingSignIn.state = 'connected'; github.pendingSignIn.userCode = ''; github.pendingSignIn.signInUrl = ''; } github.pendingSignIn = undefined; };

  const profiles = [{ id: 'claude-default', provider: 'claude', isolation: 'inherited' }, { id: 'codex-default', provider: 'codex', isolation: 'inherited', availability: { state: 'available', plan: 'plus', observedAtUnixMillis: String(Date.now()), windows: [{ name: 'codex:primary', durationMinutes: '300', usedPercent: 45, resetAt: String(Math.floor(Date.now()/1000)+7200) }, { name: 'codex:secondary', durationMinutes: '10080', usedPercent: 60, resetAt: String(Math.floor(Date.now()/1000)+172800) }] } }];
  profiles.push({ id:'codex-saved', provider:'codex', label:'Saved Codex', managed:true, isolation:'environment', availability:{...structuredClone(profiles[1].availability),email:'codex-fixture@example.invalid'} });
  const enrollments = new Map();
  const completeEnrollment = id => { const flow = enrollments.get(id); if (!flow) throw new Error('Unknown fixture enrollment'); if (flow.state === 'added') return; flow.state = 'added'; flow.signInUrl = ''; flow.userCode = ''; profiles.push({ id: flow.profileId, provider: flow.provider, label: flow.label, managed:true, isolation: 'environment', availability: flow.provider === 'codex' ? { state: 'available', plan: 'pro', observedAtUnixMillis: String(Date.now()), windows: [{ name: 'codex:primary', durationMinutes: '300', usedPercent: 73, resetAt: String(Math.floor(Date.now()/1000)+3600) }] } : { state: 'unknown' } }); };

  // Terminals echo what is typed and answer each line, like a minimal shell.
  const terminals=new Map();
  const terminalStatus=t=>({id:t.id,collectionId:t.collectionId,directory:t.directory,title:t.title,shell:'/bin/fixture-sh',cols:t.cols,rows:t.rows,offset:String(t.output.length),retained:String(t.output.length),done:t.done,...(t.done?{exitCode:0}:{}),createdAtUnixMillis:String(t.createdAt)});
  const terminalOutput=(t,text)=>{const offset=t.output.length;const data=Buffer.from(text);t.output=Buffer.concat([t.output,data]);for(const res of t.clients)res.write(frame({offset:String(offset),data:data.toString('base64'),status:terminalStatus(t)}));};

  // The PR loop per workspace member: uncommitted files, branch commits, push
  // state and its pull request. Nothing here runs Git or contacts GitHub.
  const ship=new Map();
  const hex=()=>randomUUID().replaceAll('-','').padEnd(40,'0').slice(0,40);
  const shipState=(collectionId,member)=>{const key=collectionId+'/'+member;if(!ship.has(key)){const spec=collections.find(c=>c.id===collectionId)?.members.find(m=>m.spec.name===member)?.spec;ship.set(key,{branch:spec?.branch||'feature/'+member,head:hex(),files:[],commits:[],committed:[],upstream:'',ahead:0,githubRepository:'',pr:undefined,mergeRefusal:''});}return ship.get(key);};
  const pullRequest=state=>state.pr?{...state.pr,githubRepository:state.githubRepository,branch:state.branch,defaultBranch:'main',found:true}:{githubRepository:state.githubRepository,branch:state.branch,defaultBranch:'main',found:false,...(state.githubRepository?{}:{unavailable:'origin is not a GitHub repository; push works, pull requests need GitHub'})};

  let runnerSettings={revision:'1',naming:'repositories',permission:'',context:'You are running inside Lazybox.',claudeContext:'',codexContext:'',suggestedName:'gentle-copper-otter',prices:[],processBackend:'',rotationExcludedProfileIds:[]};
  // The fake Runner process. RestartRunner answers, then the "process" is down
  // for restartMs (every RPC fails as unavailable) before a new instance serves.
  // listDelayMs holds ListCollections answers (a slow first response);
  // refusedBearers records every bearer the fake Runner did not accept.
  const runner = { instanceId: randomUUID(), restartAvailable: true, restartError: '', restartMs: 1500, down: false, restarts: 0, listDelayMs: 0, refusedBearers: [] };
  // Hosted processes as ListProcesses reports them, for the Processes view.
  // Explicitly fake: no session host, tmux or process table behind them. Open
  // terminals are listed too, as the Runner lists their hosts.
  const processHosting = { configured: 'sessionhost', tmuxVersion: 'tmux 3.4', tmuxProblem: '', fallback: '' };
  const usage = (cpuPercent, megabytes, processCount) => ({ cpuPercent, memoryBytes: String(megabytes * 1048576), processCount });
  const processes = [
    { id: 'host-agent-alpha', kind: 'agent', backend: 'sessionhost', state: 'running', attached: true, hostPid: 4101, programPid: 4102, uptimeSeconds: '8100', label: 'Fix the parser', workspaceId: 'alpha', workspaceName: 'Alpha feature', sessionId: 'alpha-session', conversationTitle: 'Fix the parser', provider: 'claude', usage: usage(3.2, 412, 5) },
    { id: 'host-command-beta', kind: 'command', backend: 'tmux', state: 'running', attached: true, hostPid: 4201, programPid: 4202, uptimeSeconds: '95', label: 'go test ./...', workspaceId: 'beta', workspaceName: 'Beta release', sessionId: 'beta-session', conversationTitle: 'Ship the release', provider: 'claude', commandId: 'beta-command', attachCommand: 'tmux -S /private/tmp/tmux-501/lazybox-fixture attach -t host-command-beta', usage: usage(97.5, 220, 3) },
    { id: 'host-orphan', kind: 'agent', backend: 'sessionhost', state: 'running', attached: false, hostPid: 4301, programPid: 4302, uptimeSeconds: '90061', label: 'codex · old-checkout', usage: usage(0, 96, 2) },
  ];
  const processInventory = () => ({
    processes: [...processes, ...[...terminals.values()].filter(t => !t.done).map(t => ({ id: 'host-' + t.id, kind: 'terminal', backend: 'sessionhost', state: 'running', attached: true, hostPid: 4400, programPid: 4401, uptimeSeconds: '30', label: t.title, workspaceId: t.collectionId, workspaceName: collections.find(c => c.id === t.collectionId)?.name || '', terminalId: t.id, usage: usage(0.1, 8, 2) }))],
    hosting: { selected: runnerSettings.processBackend || processHosting.configured, ...processHosting },
  });
  const handle = async (req, res) => {
    // A desktop window calls the Runner's own origin (no proxy), as the native app does.
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'authorization, content-type, connect-protocol-version, connect-timeout-ms');
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Expose-Headers', '*');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    }
    if (req.headers.authorization !== `Bearer ${token}`) { runner.refusedBearers.push({ bearer: req.headers.authorization ?? null, method: req.url.split('/').at(-1) }); res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 'unauthenticated', message: 'local test bench bearer required' })); return; }
    if (runner.down) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 'unavailable', message: 'Fixture Runner is restarting' })); return; }
    const method = req.url.split('/').at(-1); let body;
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      let data = Buffer.concat(chunks);
      if (req.headers['content-type']?.startsWith('application/connect+json')) data = data.subarray(5, 5 + data.readUInt32BE(1));
      body = JSON.parse(data.toString() || '{}');
    }
    catch { res.writeHead(400); res.end(); return; }
    calls.push({ method, body });
    const json = value => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    const error = (code, message) => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code, message })); };
    switch (method) {
      case 'GetRunnerSettings': return json(runnerSettings);
      case 'SaveRunnerSettings': {
        if(body.revision!==runnerSettings.revision)return error('aborted','Settings changed');
        mutations.push({method,body});runnerSettings={...runnerSettings,...body,revision:String(Number(runnerSettings.revision)+1)};return json(runnerSettings);
      }
      case 'SetModelPrice': {
        if(body.revision!==runnerSettings.revision)return error('aborted','Settings changed');
        mutations.push({method,body});runnerSettings.prices=runnerSettings.prices.filter(p=>p.provider!==body.price.provider||p.model!==body.price.model);
        if(!body.remove)runnerSettings.prices.push({...body.price,version:'custom-fixture',custom:true});runnerSettings.revision=String(Number(runnerSettings.revision)+1);return json(runnerSettings);
      }
      case 'ListRepositoryDiscovery': return json(discovery);
      case 'RemoveRepository': {mutations.push({method,body});const index=library.findIndex(repo=>repo.id===body.repositoryId);if(index>=0)library.splice(index,1);for(const root of discovery.roots)root.repositories=root.repositories.filter(repo=>repo.gitIdentity!==body.gitIdentity);return json(discovery);}
      case 'ScanRepositoryRoot': { mutations.push({ method, body }); const root = { path: body.path, scannedAt: '1', repositories: [...['api', 'web', 'tools'].map(name => ({ name, path: body.path + '/' + name, gitIdentity: 'github:team/' + name })), { name: 'api-other-clone', path: body.path + '/other-clone', gitIdentity: 'github:team/api' }, { name: 'api-feature-worktree', path: body.path + '/api-feature', gitIdentity: 'github:team/api' }] }; discovery.roots = [...discovery.roots.filter(item => item.path !== body.path), root]; return json(discovery); }
      case 'GetGitHubConnection': return json(github);
      case 'ConnectGitHubPersonalToken': { mutations.push({ method, body }); if (body.token !== 'ghp_offline_fixture') // The real Runner reports a rejected GitHub credential as failed_precondition;
        // unauthenticated is reserved for a refused Runner bearer.
        return error('failed_precondition', 'Token rejected by fixture'); Object.assign(github, { state: 'connected', authMethod: 'personal_token', login: 'fixture-user', userId: '42', error: '' }); return json(github); }
      case 'ConfigureGitHubApp': mutations.push({ method, body }); Object.assign(github, { state: 'not_connected', clientId: body.clientId, appSlug: body.slug }); return json(github);
      case 'BeginGitHubSignIn': {
        mutations.push({ method, body });
        if (!githubFlows.has(body.requestKey)) githubFlows.set(body.requestKey, { id: 'github-' + body.requestKey, state: 'awaiting_login', userCode: 'TEST-CODE', signInUrl: 'https://github.com/login/device' });
        github.pendingSignIn = githubFlows.get(body.requestKey); return json(github.pendingSignIn);
      }
      case 'GetGitHubSignIn': return json([...githubFlows.values()].find(flow => flow.id === body.id) || { state: 'expired' });
      case 'CancelGitHubSignIn': { mutations.push({ method, body }); const flow = [...githubFlows.values()].find(flow => flow.id === body.id); Object.assign(flow, { state: 'cancelled', userCode: '', signInUrl: '' }); github.pendingSignIn = undefined; return json(flow); }
      case 'DisconnectGitHub': mutations.push({ method, body }); Object.assign(github, { state: github.clientId ? 'not_connected' : 'setup_required', authMethod: '', login: '', userId: '0', error: '' }); return json(github);
      case 'ListGitHubInstallations': return json({ installations: [{ id: '7', account: 'fixture-team', repositorySelection: 'selected' }], hasMore: false });
      case 'ListGitHubRepositories': return json({ repositories: githubRepositories.map(repo => ({ ...repo, registeredId: library.find(item => item.githubId === repo.id)?.id || '' })), hasMore: false });
      case 'ImportGitHubRepository': { mutations.push({ method, body }); let repo = library.find(item => item.githubId === body.repositoryId); if (!repo) { const remote = githubRepositories.find(item => item.id === body.repositoryId); repo = { id: 'github-' + remote.id, name: remote.name, path: '/fixture/repos/' + remote.id, sourceUrl: remote.htmlUrl, githubId: remote.id,gitIdentity:'github:'+remote.fullName.toLowerCase() }; library.push(repo); } return json({ repository: repo }); }
      case 'ListGitHubItems': return json({ items: [{ id: '501', number: '12', kind: 'issue', title: 'Fix startup', state: 'open', author: 'fixture-user', htmlUrl: 'https://github.com/fixture-team/api/issues/12' }, { id: '502', number: '13', kind: 'pull_request', title: 'Improve startup', state: 'open', author: 'fixture-user', htmlUrl: 'https://github.com/fixture-team/api/pull/13' }], hasMore: false });
      case 'ListSnippets': return json({snippets:[{key:'review',category:'Review',description:'Review this change',body:'Review the current change carefully.',origin:'built-in'},{key:'test',category:'Testing',description:'Run tests',body:'Run the relevant tests.',origin:'global'}]});
      case 'GetTelemetry': return json({groups:[],contexts:[],recent:[]});
      case 'RenameCollection': { const workspace=collections.find(c=>c.id===body.collectionId);if(!workspace)return error('not_found','workspace missing');workspace.name=body.name;mutations.push({method,body});return json({collection:workspace}); }
      case 'RestartRunner': {
        mutations.push({ method, body });
        if (!runner.restartAvailable) return error('failed_precondition', 'this Runner was not started by a launcher that can start it again; restart it where it runs');
        if (runner.restartError) return error('internal', runner.restartError);
        const stopping = runner.instanceId; runner.restarts++;
        setTimeout(() => { runner.down = true; setTimeout(() => { runner.instanceId = randomUUID(); runner.down = false; }, runner.restartMs); }, 50);
        return json({ instanceId: stopping });
      }
      case 'Info': return json({ restartAvailable: runner.restartAvailable, instanceId: runner.instanceId, profiles, pendingEnrollments: [...enrollments.values()].filter(flow => flow.state === 'awaiting_login').map(({ id, state, provider, label, profileId }) => ({ id, state, provider, label, profileId })), sessions, attachmentLimits: { maxFiles: 4, maxFileBytes: '20971520', maxMessageBytes: '20971520' } });
      case 'AddSubscription': {
        mutations.push({ method, body });
        const id = `enrollment-${body.requestKey}`;
        if (!enrollments.has(id)) { enrollments.set(id, { id, state: 'awaiting_login', profileId: `saved-${enrollments.size}`, provider: body.provider, label: body.label, signInUrl: body.provider === 'claude' ? 'https://claude.com/cai/oauth/authorize?state=fixture' : 'https://auth.openai.com/codex/device', userCode: body.provider === 'claude' ? '' : 'AUTH-FIXTURE-CODE' }); }
        return json(enrollments.get(id));
      }
      case 'GetSubscriptionEnrollment': { const id=body.enrollmentId || `enrollment-${body.requestKey}`; return enrollments.has(id) ? json(enrollments.get(id)) : json({id, state:'expired',error:'Fixture enrollment no longer tracked'}); }
      case 'CancelSubscriptionEnrollment': { const flow = enrollments.get(body.enrollmentId); if (!flow) return error('not_found', 'Unknown enrollment'); flow.state = 'cancelled'; flow.userCode = ''; flow.signInUrl = ''; return json(flow); }
      case 'RenameConversation': {const session=sessions.find(s=>s.id===body.sessionId);if(!session)return error('not_found','Missing conversation');session.title=body.title;mutations.push({method,body});return json({session});}
      case 'ListHistory': return json({sessions:sessions.filter(s=>(body.collectionId===undefined||s.collectionId===body.collectionId)&&(!body.search||(s.title||`Conversation ${s.id}`).toLowerCase().includes(body.search.toLowerCase()))).map(s=>({...s,title:s.title||`Conversation ${s.id}`,conversationId:s.workId||s.id})),hasMore:false});
      case 'RefreshSubscription': { const profile = profiles.find(p => p.id === body.profileId); if (!profile) return error('not_found', 'Unknown profile'); if (profile.provider === 'claude') profile.availability = {state:'available',plan:'max',windows:[{name:'five_hour',usedPercent:37,durationMinutes:'300',resetAt:String(Math.floor(Date.now()/1000)+3600)}]}; profile.availability.observedAtUnixMillis = String(Date.now()); profile.availability.windows[0].usedPercent += 5; return json(profile); }
      case 'ListCollections': { if (runner.listDelayMs) await new Promise(resolve => setTimeout(resolve, runner.listDelayMs)); return json({ collections }); }
      case 'GetCollection': { const collection = collections.find(c => c.id === body.collectionId); return collection ? json({ collection }) : error('not_found', 'Workspace missing'); }
      case 'AddLocalRepository': {
        mutations.push({ method, body });
        let repository = library.find(repo => repo.path === body.path);
        if (!repository) { repository = { id: 'local-' + (library.length + 1), name: body.name || body.path.split('/').at(-1), path: body.path, gitIdentity: discovery.roots.flatMap(root => root.repositories).find(repo => repo.path === body.path)?.gitIdentity || '' }; library.push(repository); }
        return json({ repository });
      }
      case 'GetRepositoryCatalog': {if(body.refresh&&github.state==='connected'){catalogRemote=structuredClone(githubRepositories);catalogUpdated=String(Math.floor(Date.now()/1000));}return json({entries:catalogEntries(),sources:[{id:'github',state:github.state,detail:github.authMethod==='github_app'?'GitHub App access is limited to its installed repositories.':'Repositories visible to this personal token.',updatedAt:catalogUpdated}],refreshSeconds:300});}
      case 'PrepareWorkspace': {
       mutations.push({method,body});const values=[];const members=[];
       for(const identity of body.repositoryIdentities||[]){const choice=catalogEntries().find(r=>r.identity===identity);if(!choice)return error('not_found','Unknown repository identity');let repo=library.find(r=>r.id===choice.repositoryId);if(!repo){if(preparationFailures.delete(identity)){res.writeHead(200,{'Content-Type':'application/connect+json'});res.end(Buffer.concat([...values.map(v=>frame(v)),frame({error:{code:'failed_precondition',message:'Fixture preparation failure'}},2)]));return;}const remote=githubRepositories.find(r=>'github:'+r.fullName.toLowerCase()===identity);repo={id:remote?'github-'+remote.id:'local-'+(library.length+1),name:choice.name.split('/').at(-1),path:choice.path||'/fixture/repos/'+remote.id,gitIdentity:identity};library.push(repo);prepared.push(identity);}values.push({identity,message:'Preparing '+choice.name});members.push({repositoryId:repo.id,name:repo.name||repo.id,...(body.branch&&!body.collectionId?{branch:body.branch}:{})});}
       let collection=requests.get(body.requestKey);if(!collection){if(body.collectionId){collection=collections.find(c=>c.id===body.collectionId);if(!collection)return error('not_found','Missing workspace');collection.members.push(...members.map(spec=>({spec,path:collection.root+'/'+spec.name,ready:true})));}else{const id='created-'+collections.length;collection={id,name:body.name,root:'/fixture/collections/'+id,state:'ready',members:members.map(spec=>({spec,path:'/fixture/collections/'+id+'/'+spec.name,ready:true}))};collections.push(collection);}requests.set(body.requestKey,collection);}values.push({message:'Ready',collection});res.writeHead(200,{'Content-Type':'application/connect+json'});res.end(stream(values));return;
      }
      case 'ListRepositories': return json({ repositories: library });
      case 'ResolveWorkspacePath': {const files=treeFiles(body.collectionId),folders=treeFolders(body.collectionId),path=String(body.path||'').replace(/^\.\//,'');const members=collections.find(c=>c.id===body.collectionId)?.members.map(m=>m.spec.name)||[];
        const exists=p=>files.includes(p)||folders.has(p),match=p=>({path:p,directory:folders.has(p)});
        if(/missing/.test(path))return json({matches:[]});
        if(exists(path))return json({matches:[match(path)],exact:true});
        const under=members.map(m=>m+'/'+path).filter(exists);if(under.length)return json({matches:under.map(match),exact:true});
        const name=path.split('/').pop();const named=files.filter(p=>p.split('/').pop()===name);if(named.length)return json({matches:named.map(match)});
        return json({matches:[{path,directory:false}],exact:true});}
      case 'SearchWorkspaceFiles': {const files=treeFiles(body.collectionId);const found=body.query?files.map(p=>fuzzy(p,body.query)).filter(Boolean).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)).slice(0,body.limit||50):[];return json({matches:found.map(({path,positions})=>({path,positions})),indexed:files.length});}
      case 'ReadWorkspaceFile': {const key=body.collectionId+'/'+body.path; if(treeFolders(body.collectionId).has(body.path))return json({path:body.path,directory:true,entries:listFolder(body.collectionId,body.path)}); if(!workspaceFiles.has(key))workspaceFiles.set(key,{path:body.path,text:'# File preview\nA retained file.\n',version:'v1',binary:false,truncated:false});return json(workspaceFiles.get(key));}
      case 'SaveWorkspaceFile': {const key=body.collectionId+'/'+body.path,file=workspaceFiles.get(key);if(file.version!==body.expectedVersion)return error('aborted','File changed on the Runner');Object.assign(file,{text:body.text,version:crypto.randomUUID()});mutations.push({method,body});return json(file);}
      case 'DeleteConversation': {const session=sessions.find(s=>s.id===body.sessionId);if(session&&!session.closed&&!body.stopSessions)return error('failed_precondition','Agent running');if(session)sessions.splice(sessions.indexOf(session),1);mutations.push({method,body});return json({});}
      case 'ResumeSession': {
        const previous=sessions.find(s=>s.id===body.sessionId);if(!previous)return error('not_found','Missing conversation');
        let session=sessions.find(s=>s.previousExecutionId===previous.id);
        if(!session){session={...previous,id:previous.id+'-continued',previousExecutionId:previous.id,conversationId:previous.conversationId||previous.id,closed:false,historical:false,status:'ready'};sessions.push(session);}
        previous.successorExecutionId=session.id;mutations.push({method,body});return json({session});
      }
      case 'GetSession': { const session = sessions.find(value => value.id === body.sessionId); return session ? json({ session }) : error('not_found', 'Fixture session not found'); }
      case 'ListCommands': { const workspace = sessions.find(value => value.id === body.sessionId)?.collectionId; return json({ commands: commands.filter(value => value.sessionId === body.sessionId || (!value.sessionId && value.collectionId && value.collectionId === workspace)).map(listedCommand) }); }
      case 'ClaimCommandShare': { const command = commands.find(value => value.id === body.commandId); if (!command) return error('not_found', 'Command missing'); const claimed = !!command.shareWith && command.done && !claimedShares.has(command.id); if (claimed) claimedShares.add(command.id); return json({ claimed, status: wireCommand(command) }); }
      case 'PreviewWorkspaceDeletion': return json({activeSessionIds:sessions.filter(s=>s.collectionId===body.collectionId&&!s.closed).map(s=>s.id),dirtyRepositories:['api'],filesOutsideRepositories:false});
      case 'DeleteWorkspace': {const index=collections.findIndex(c=>c.id===body.collectionId);if(index<0||body.confirmName!==collections[index].name)return error('failed_precondition','Confirm name');if(!body.stopSessions||!body.discardChanges)return error('failed_precondition','Explicit cleanup consent required');mutations.push({method,body});const collection=collections.splice(index,1)[0];for(const s of sessions.filter(s=>s.collectionId===collection.id)){s.closed=true;s.status='stopped';}return json({collection:{...collection,state:'deleted'}});}
      case 'WatchEvents': {
        const channel=eventStreams.get(body.sessionId);if(channel){res.writeHead(200,{'Content-Type':'application/connect+json'});res.flushHeaders();
          // Like the Runner, each replayed record says where the retained history ends.
          const head=String(channel.events.length);
          const backlog=channel.events.filter(event=>BigInt(event.cursor)>BigInt(body.after||0)).map(event=>({...event,retained:head}));
          // `pace` paces a replay like the Runner's one-message-per-record stream: a
          // flush every `pace` records instead of one write of the whole journal.
          if(channel.pace){void (async()=>{for(let i=0;i<backlog.length;i+=channel.pace){if(res.destroyed)return;res.write(Buffer.concat(backlog.slice(i,i+channel.pace).map(event=>frame(event))));await new Promise(resolve=>setTimeout(resolve,channel.paceMs??1));}if(channel.done)res.end(frame({},2));})();return;}
          channel.clients.add(res);res.on('close',()=>channel.clients.delete(res));for(const event of backlog)res.write(frame(event));if(channel.done){channel.clients.delete(res);res.end(frame({},2));}return;}
        const lineage=[];let id=body.sessionId;while(id&&!lineage.includes(id)){lineage.unshift(id);id=sessions.find(s=>s.id===id)?.previousExecutionId;}const events=lineage.flatMap((id,index)=>[{cursor:String(index*2+1),event:{type:'message_delta',text:`Retained conversation for ${id}`,sessionReference:id}},{cursor:String(index*2+2),event:{type:'message_delta',text:'CHILD_PRIVATE_TRANSCRIPT',agentId:'child-review',parentAgentId:'root'}}]);
        res.writeHead(200, { 'Content-Type': 'application/connect+json' }); res.end(stream(events.filter(value => BigInt(value.cursor) > BigInt(body.after || 0)))); return;
      }
      case 'WatchOutput': {
        const command = commands.find(value => value.id === body.commandId);
        const events = [{ cursor: '1', offset: '0', channel: 'stdout', data: Buffer.from(command?.output || 'fixture retained output\n').toString('base64'), status: command && wireCommand(command) }];
        res.writeHead(200, { 'Content-Type': 'application/connect+json' }); res.end(stream(events.filter(value => BigInt(value.cursor) > BigInt(body.after || 0)))); return;
      }
      case 'OpenTerminal': {
        mutations.push({method,body});const collection=collections.find(c=>c.id===body.collectionId);if(!collection)return error('not_found','Workspace missing');
        if(body.directory&&!collection.members.some(m=>m.spec.name===body.directory))return error('failed_precondition','terminal directory must be inside the workspace');
        const existing=[...terminals.values()].find(t=>body.requestKey&&t.requestKey===body.requestKey);if(existing)return json(terminalStatus(existing));
        const t={id:'terminal-'+(terminals.size+1),requestKey:body.requestKey,collectionId:collection.id,directory:body.directory||'',title:collection.name+(body.directory?' / '+body.directory:''),cols:body.cols,rows:body.rows,createdAt:Date.now(),output:Buffer.alloc(0),line:'',input:[],resizes:[],done:false,clients:new Set()};
        terminals.set(t.id,t);terminalOutput(t,`fixture shell in ${t.title}\r\n$ `);return json(terminalStatus(t));
      }
      case 'ListTerminals': return json({terminals:[...terminals.values()].filter(t=>!body.collectionId||t.collectionId===body.collectionId).map(terminalStatus)});
      case 'WatchTerminal': {
        const t=terminals.get(body.terminalId);if(!t)return error('not_found','Terminal missing');
        res.writeHead(200,{'Content-Type':'application/connect+json'});res.flushHeaders();
        const after=Number(body.after||0);if(t.output.length>after)res.write(frame({offset:String(after),data:t.output.subarray(after).toString('base64'),status:terminalStatus(t)}));
        if(t.done){res.end(Buffer.concat([frame({offset:String(t.output.length),status:terminalStatus(t)}),frame({},2)]));return;}
        t.clients.add(res);res.on('close',()=>t.clients.delete(res));return;
      }
      case 'WriteTerminal': {
        const t=terminals.get(body.terminalId);if(!t||t.done)return error(t?'failed_precondition':'not_found','Terminal unavailable');
        const text=Buffer.from(body.data||'','base64').toString();t.input.push(text);
        for(const character of text){if(character==='\r'){const line=t.line;t.line='';if(line==='exit'){terminalOutput(t,'\r\nexit\r\n');t.done=true;for(const client of t.clients)client.end(Buffer.concat([frame({offset:String(t.output.length),status:terminalStatus(t)}),frame({},2)]));break;}terminalOutput(t,`\r\nran: ${line}\r\n$ `);}else{t.line+=character;terminalOutput(t,character);}}
        return json(terminalStatus(t));
      }
      case 'ResizeTerminal': {const t=terminals.get(body.terminalId);if(!t)return error('not_found','Terminal missing');Object.assign(t,{cols:body.cols,rows:body.rows});t.resizes.push([body.cols,body.rows]);return json(terminalStatus(t));}
      case 'CloseTerminal': {
        const t=terminals.get(body.terminalId);if(!t)return error('not_found','Terminal missing');mutations.push({method,body});
        t.done=true;for(const client of t.clients)client.end(Buffer.concat([frame({offset:String(t.output.length),status:terminalStatus(t)}),frame({},2)]));terminals.delete(t.id);return json(terminalStatus(t));
      }
      case 'CreateCollection': {
        mutations.push({ method, body });
        if (!requests.has(body.requestKey)) {
          const id = `created-${collections.length}`;
          const collection = { id, name: body.spec.name, workId: id, root: `/fixture/collections/${id}`, state: 'ready', members: (body.spec.members || []).map(member => ({ spec: { ...member, branch: `lazybox/${id}/${member.name}` }, path: `/fixture/collections/${id}/${member.name}`, baseCommit: 'c'.repeat(40), ready: true })) };
          requests.set(body.requestKey, collection); collections.push(collection);
        }
        return json({ collection: requests.get(body.requestKey) });
      }
      case 'AddCollectionRepositories': {
        mutations.push({method,body});const collection=collections.find(c=>c.id===body.collectionId);
        if(!collection)return error('not_found','Workspace missing');
        if(!requests.has(body.requestKey)){for(const member of body.members){const repo=library.find(r=>r.id===member.repositoryId);const name=member.name||repo?.name||member.repositoryId;collection.members.push({spec:{...member,name,branch:`feature/${collection.name}`},path:`${collection.root}/${name}`,baseCommit:'c'.repeat(40),ready:true});}requests.set(body.requestKey,collection);}
        return json({collection});
      }
      case 'OpenAssistant': {
        mutations.push({ method, body });
        const session = { id: `assistant-${sessions.length}`, collectionId:body.collectionId||'', profileId: body.profileId, purpose: body.purpose, status: 'ready', capabilities: { images: true }, pending: [] }; sessions.push(session); return json({ session });
      }
      case 'OpenSession': {
        mutations.push({ method, body });
        if (body.emptyWorkspace) { const session = {id:`empty-${sessions.length}`,profileId:body.profileId,workingDirectory:`/fixture/workspaces/${sessions.length}`,status:'ready',capabilities:{files:true},pending:[]};sessions.push(session);return json({session}); }
        const collection = collections.find(value => value.id === body.collectionId); if (!collection) return error('failed_precondition', 'Fixture Collection required');
        const session = { id: `started-${sessions.length}`, collectionId: collection.id, workId: collection.id, profileId: body.profileId, capabilities: { files: true }, pending: [] }; sessions.push(session); collection.ownerExecutionId = session.id;
        return json({ session });
      }
      case 'ListWorkspaceChanges': {
        const collection=collections.find(c=>c.id===body.collectionId);if(!collection)return error('not_found','Workspace missing');
        return json({repositories:collection.members.map(m=>{const s=shipState(collection.id,m.spec.name);return {member:m.spec.name,branch:s.branch,head:s.head,base:'c'.repeat(40),files:s.files,committed:s.committed,commits:s.commits,branches:[s.branch,'main','origin/main','release/2'],defaultBranch:'origin/main',upstream:s.upstream,ahead:s.ahead,githubRepository:s.githubRepository};})});
      }
      case 'ReadWorkspaceDiff': return json({text:`@@ fixture ${body.committed?'branch':'working tree'} diff @@\n+${body.path}`});
      case 'CommitWorkspaceChanges': {
        mutations.push({method,body});const s=shipState(body.collectionId,body.member);
        const paths=body.paths||[];const chosen=s.files.filter(f=>!paths.length||paths.includes(f.path));
        if(!chosen.length)return error('failed_precondition','nothing to commit: the selected files have no changes');
        const subject=(body.message||'').trim().split('\n')[0];if(!subject)return error('failed_precondition','write a commit message');
        s.head=hex();s.files=s.files.filter(f=>!chosen.includes(f));s.committed.push(...chosen.map(f=>({path:f.path,indexStatus:f.indexStatus==='?'?'A':f.indexStatus.trim()||'M'})));s.commits.unshift({id:s.head,subject,committedAtUnix:String(Math.floor(Date.now()/1000))});s.ahead++;
        return json({commit:s.head,subject,files:chosen.length,branch:s.branch});
      }
      case 'PushWorkspaceBranch': {
        mutations.push({method,body});const s=shipState(body.collectionId,body.member);
        s.upstream='origin/'+s.branch;s.ahead=0;if(s.pr&&s.pr.state==='open')s.pr.headSha=s.head;return json({branch:s.branch,upstream:s.upstream,head:s.head,githubRepository:s.githubRepository});
      }
      case 'GetPullRequest': return json(pullRequest(shipState(body.collectionId,body.member)));
      case 'CreatePullRequest': {
        mutations.push({method,body});const s=shipState(body.collectionId,body.member);
        if(!s.upstream)return error('failed_precondition','push the branch before opening a pull request');
        if(s.ahead)return error('failed_precondition',`${s.ahead} local commit(s) are not pushed yet; push before opening a pull request`);
        s.pr={number:'7',title:body.title,body:body.body,url:`https://github.com/${s.githubRepository}/pull/7`,state:'open',draft:!!body.draft,base:body.base||'main',headSha:s.head,mergeableState:'unstable',reviewDecision:'',checksState:'failure',author:'fixture-user',
          checks:[{name:'test',status:'completed',conclusion:'failure',url:`https://github.com/${s.githubRepository}/actions/runs/41/job/1`,summary:'2 tests failed'},{name:'lint',status:'in_progress',conclusion:'',url:''},{name:'build',status:'completed',conclusion:'success',url:`https://github.com/${s.githubRepository}/actions/runs/40`}]};
        return json(pullRequest(s));
      }
      case 'MergePullRequest': {
        mutations.push({method,body});const s=shipState(body.collectionId,body.member);
        if(!s.pr||String(s.pr.number)!==String(body.number))return error('failed_precondition',`pull request #${body.number} is not this branch's pull request`);
        if(s.mergeRefusal)return error('failed_precondition','GitHub: '+s.mergeRefusal);
        if(body.expectedHead!==s.pr.headSha)return error('failed_precondition','GitHub: Head branch was modified. Review and try the merge again.');
        Object.assign(s.pr,{state:'merged',mergeCommit:hex(),mergeMethod:body.method});return json(pullRequest(s));
      }
      case 'ListProcesses': return json(processInventory());
      case 'StopProcess': {
        mutations.push({ method, body });
        const terminal = [...terminals.values()].find(t => 'host-' + t.id === body.id && !t.done);
        if (terminal) { terminal.done = true; for (const client of terminal.clients) client.end(frame({}, 2)); return json(processInventory()); }
        const index = processes.findIndex(p => p.id === body.id);
        if (index < 0) return error('not_found', 'hosted process not found');
        processes.splice(index, 1); return json(processInventory());
      }
      case 'CleanUpOrphanProcesses': {
        mutations.push({ method, body });
        const orphans = processes.filter(p => !p.attached);
        for (const p of orphans) processes.splice(processes.indexOf(p), 1);
        return json({ stopped: orphans.length, inventory: processInventory() });
      }
      case 'Apply': {
        mutations.push({ method, body });
        // Like the Runner: at a subscription limit a message is accepted and
        // waits in the queue (journaled once), delivered after the switch.
        const session=sessions.find(s=>s.id===body.sessionId);
        if(session&&['exhausted','throttled','auth_required','billing_error'].includes(session.fault)&&body.message){
          const queued=waitingMessages.get(session)||new Map();waitingMessages.set(session,queued);
          if(!queued.has(body.operationId)){queued.set(body.operationId,body.message.text);session.queued=(session.queued||0)+1;eventStreams.get(session.id)?.push({type:'operation_accepted',text:body.message.text});}
        }
        // A message with files is retained like the Runner's attachment store
        // (by execution and content digest) and journaled with the file list a
        // conversation shows its thumbnails from.
        else if(session&&body.message?.attachments?.length){
          const files=body.message.attachments.map(file=>{const data=Buffer.from(file.data||'','base64');const path=`/fixture/attachments/${session.id}/${createHash('sha256').update(data).digest('hex')}/${file.name}`;attachments.set(path,{name:file.name,mediaType:file.mediaType||'application/octet-stream',data});return {name:file.name,mediaType:file.mediaType||'application/octet-stream',path,size:data.length};});
          eventStreams.get(session.id)?.push({type:'operation_accepted',text:body.message.text||'',providerDataJson:Buffer.from(JSON.stringify({files})).toString('base64')});
        }
        return json({ operationId: body.operationId, delivery: 'accepted' });
      }
      // Like the Runner: only a retained attachment, only an image a browser displays.
      case 'ReadAttachment': {
        const file=attachments.get(body.path);
        if(!file)return error(String(body.path||'').startsWith('/fixture/attachments/')?'not_found':'invalid_argument','not a retained message attachment');
        if(!/^image\/(png|jpeg|gif|webp)$/.test(file.mediaType))return error('failed_precondition','only PNG, JPEG, GIF and WebP attachments can be previewed');
        if(attachmentReadDelayMs)await new Promise(resolve=>setTimeout(resolve,attachmentReadDelayMs));
        return json({name:file.name,mediaType:file.mediaType,data:file.data.toString('base64')});
      }
      // A switch continues the same conversation: the fixture journals what the
      // Runner does (switching, switched with its origin) and clears the limit.
      case 'SwitchSubscription': {
        mutations.push({method,body});const session=sessions.find(s=>s.id===body.sessionId);if(!session)return error('not_found','Missing conversation');
        if(session.closed)return error('failed_precondition','the conversation has ended; resume it to continue');
        const target=profiles.find(p=>p.id===body.profileId);if(!target)return error('failed_precondition','subscription not found');
        const from=session.profileId,channel=eventStreams.get(session.id),data=value=>Buffer.from(JSON.stringify(value)).toString('base64');
        const resetAt=Number(session.account?.resetAt||0),fromState=session.account?.state||'available';
        if(from===target.id){channel?.push({type:'profile_changed',text:from,status:'retry_same_profile',providerDataJson:data({from,fromState,resetAt,requested:true})});}
        else{channel?.push({type:'profile_switching',status:'requested'});channel?.push({type:'profile_changed',text:target.id,status:'checkpoint_handoff',providerDataJson:data({from,fromState,resetAt,requested:true})});}
        if(body.enableRotation)session.rotationProfileIds=profiles.filter(p=>p.provider===target.provider&&p.isolation==='environment'&&p.id!==target.id).map(p=>p.id);
        Object.assign(session,{profileId:target.id,fault:'',status:'running',busy:true,queued:0,account:{state:'unknown'}});waitingMessages.delete(session);
        return json({session});
      }
      case 'SetSessionRotation': {
        mutations.push({method,body});const session=sessions.find(s=>s.id===body.sessionId);if(!session)return error('not_found','Missing conversation');
        const provider=profiles.find(p=>p.id===session.profileId)?.provider||session.provider;
        const pool=id=>body.enabled?profiles.filter(p=>p.provider===provider&&p.isolation==='environment'&&p.id!==id).map(p=>p.id):[];
        for(const s of body.allSessions?sessions.filter(s=>!s.closed&&(s.provider||profiles.find(p=>p.id===s.profileId)?.provider)===provider):[session])s.rotationProfileIds=pool(s.profileId);
        return json({session});
      }
      case 'CloseSession': mutations.push({ method, body }); return error('failed_precondition', 'Closing a surface must not close a session');
      // The real reviewed-team preset as the Runner sends it (`lazybox process show --json --preset reviewed-team`).
      case 'GetOrchestrationProcess': return json({
        preset: 'reviewed-team', valid: true, digest: 'sha256:fixture', json: JSON.stringify(orchestrationProcess), userFile: '/fixture/state/process.yaml',
        layers: [{ kind: 'preset', source: 'reviewed-team', digest: 'sha256:preset' }, ...(body.collectionId ? [{ kind: 'repository', source: 'api/.lazybox/process.yaml', digest: 'sha256:repo' }] : [])],
        issues: body.collectionId ? [{ severity: 'warning', path: 'roles.worker.instructions.file', message: '.lazybox/roles/worker.md does not exist in this repository; the role starts without these instructions', layer: 'preset:reviewed-team', source: 'preset reviewed-team', line: 39, column: 26 }] : [],
        candidates: body.collectionId ? [{ repositoryId: 'api', name: 'api', path: '/fixture/api/.lazybox/process.yaml', digest: 'sha256:repo' }] : [],
      });
      default: return error('unimplemented', `Unsupported fixture RPC ${method}`);
    }
  };
  const listen = async () => { const next = createServer(handle); await new Promise(resolve => next.listen(0, '127.0.0.1', resolve)); return next; };
  const stop = async value => { value.closeAllConnections(); await new Promise(resolve => value.close(resolve)); };
  let server = await listen();
  url = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), 'lazybox-workspace-ui-'));
  const endpoint = join(directory, 'endpoint.json');
  const publish = () => writeFile(endpoint, JSON.stringify({ url, token, runnerId: 'fixturerunneridentity' }), { mode: 0o600 });
  await publish();
  return { attachments, set attachmentReadDelayMs(value) { attachmentReadDelayMs = value; }, runner, processes, processHosting, terminals, commands, startRun, startTerminalRun, claimedShares, githubRepositories, preparationFailures, prepared, workspaceFiles, openEvents,
    get url() { return url; }, get token() { return token; }, endpoint, calls, mutations, collections, sessions, profiles, enrollments, completeEnrollment, github, completeGitHub, library, ship, shipState,
    /** A Codefly hot reload: the process is replaced on the same port with a new bearer; its streams end. */
    async hotReload() { token = randomUUID(); runner.instanceId = randomUUID(); server.closeAllConnections(); await publish(); },
    /** A launcher restart: the old port stops answering and the new Runner serves elsewhere, with a new bearer. */
    async moveToNewPort() { const previous = server; server = await listen(); url = `http://127.0.0.1:${server.address().port}`; token = randomUUID(); runner.instanceId = randomUUID(); await stop(previous); await publish(); },
    async close() { await stop(server); await rm(directory, { recursive: true, force: true }); } };
}
