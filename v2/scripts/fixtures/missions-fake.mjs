// An explicitly fake mission service for browser checks of the Missions
// panel and the inbox. It keeps an event list per mission and derives each
// task's status and trust with a deliberately small copy of the Runner's
// rules (internal/work/derive.go): enough to drive the surfaces, never a
// specification. The Go tests own the real derivation.

export function createMissionFake({ sessions, collections }) {
  const missions = [];
  const prompts = [];
  let counter = 0;
  const id = prefix => `${prefix}_${(++counter).toString(16).padStart(6, '0')}`;
  const ms = () => String(Date.now());
  const conversationOf = sessionId => { const s = sessions.find(v => v.id === sessionId); return s ? (s.conversationId || s.workId === s.collectionId && s.id || s.id) : sessionId; };

  const append = (m, type, subject, payload, actorKind = 'human') => {
    m.seq += 1; const at = ms();
    m.events.unshift({ seq: String(m.seq), atUnixMillis: at, type, version: 1, subject, actorKind, actorRole: '', conversationId: '', summary: summary(m, type, payload), known: true, evidence: [], rawJson: '' });
    m.updatedAtUnixMillis = at;
  };
  const taskName = (m, taskId) => { const t = m.tasks.find(v => v.id === taskId); return t ? `“${t.title}”` : ''; };
  const summary = (m, type, p) => ({
    'mission.created': `Mission created: ${p.title}`, 'mission.process_pinned': 'Runs the solo-pair process', 'task.created': `Task added: ${p.title}`,
    'task.assigned': `${taskName(m, p.task)} assigned to a conversation`, 'task.reported': `${taskName(m, p.task)} reported done${p.summary ? ': ' + p.summary : ''}`,
    'gate.requested': `Waiting for you to accept ${taskName(m, p.task)}`, 'gate.passed': `You accepted ${taskName(m, p.task)}`, 'gate.rejected': `You asked for changes on ${taskName(m, p.task)}${p.note ? ': ' + p.note : ''}`,
    'evidence.recorded': p.kind === 'run' ? `Ran ${p.title} · exit ${p.exitCode}` : `Pull request #${p.number} · checks ${p.outcome}`, 'task.canceled': `${taskName(m, p.task)} canceled`,
  }[type] || type);

  // The task as stored (raw) and as the Runner would derive it.
  const liveOf = attempt => {
    if (!attempt || attempt.ended) return { live: 'closed', detail: '' };
    const s = sessions.find(v => v.id === attempt.sessionId);
    if (!s) return { live: 'missing', detail: '' };
    if (s.closed) return { live: 'closed', detail: '' };
    if (s.pending?.length) return { live: 'waiting', detail: s.pending[0].type === 'approval' ? 'approve ' + (s.pending[0].text || '') : 'a question' };
    if (s.busy || s.status === 'running') return { live: 'running', detail: s.agents?.[0]?.tool || '' };
    return { live: 'idle', detail: '' };
  };
  const judge = t => {
    const runs = t.evidence.filter(e => e.kind === 'run' && !e.piped);
    const run = runs[0], pr = t.evidence.find(e => e.kind === 'pr');
    if (!t.evidence.length) return { trust: 'claimed', flags: ['no_evidence'], reason: 'no run or check recorded' };
    if (pr?.outcome === 'pass') return { trust: 'verified', flags: [], reason: `checks passed on ${pr.repository}#${pr.number}` };
    if (run?.outcome === 'pass') return { trust: 'observed', flags: [], reason: `last run passed: ${run.title} (exit 0)` };
    if (run) return { trust: 'claimed', flags: ['failing'], reason: `last run failed: ${run.title} (exit ${run.exitCode})` };
    return { trust: 'claimed', flags: ['no_evidence'], reason: 'no passing run or check recorded' };
  };
  const derive = (m, t) => {
    const attempt = t.attempts.at(-1), live = liveOf(attempt), evidence = judge(t);
    const view = { status: 'ready', trust: '', evidenceTrust: evidence.trust, reason: 'Not assigned yet', flags: [], gate: '' };
    const liveAttempt = attempt && !attempt.ended;
    if (t.canceled || m.canceled) Object.assign(view, { status: 'canceled', reason: 'Canceled' });
    else if (t.accepted) Object.assign(view, { status: 'done', trust: 'accepted', reason: 'Accepted; evidence: ' + evidence.reason });
    else if (attempt?.ended && !t.reportedAfterAttempt) Object.assign(view, { status: 'failed', trust: 'observed', reason: 'Its conversation ended (deleted) without a report' });
    else if (t.gate) Object.assign(view, { status: 'needs_you', trust: evidence.trust, gate: t.gate, flags: evidence.flags, reason: 'Reported done, waiting for you to accept · ' + evidence.reason });
    else if (liveAttempt && live.live === 'waiting') Object.assign(view, { status: 'needs_you', trust: 'observed', reason: 'The agent is waiting for you: ' + live.detail });
    else if (t.rejected) Object.assign(view, { status: 'changes_requested', trust: evidence.trust, reason: 'You asked for changes: ' + t.decisionNote });
    else if (liveAttempt && (live.live === 'running' || live.live === 'idle')) Object.assign(view, { status: 'working', trust: 'observed', reason: live.live === 'running' ? 'The agent is working' : 'The agent finished its turn; reply in the conversation, or report the task done' });
    else if (t.blockedBy.some(b => !m.tasks.find(v => v.id === b)?.accepted)) Object.assign(view, { status: 'blocked', reason: 'Waiting for ' + taskName(m, t.blockedBy[0]) });
    if (view.status !== 'needs_you' || !view.gate) view.flags = evidence.flags.filter(f => f !== 'no_evidence');
    const wireAttempt = a => { const l = liveOf(a); const s = sessions.find(v => v.id === a.sessionId); return { id: a.id, conversationId: a.conversationId, sessionId: a.sessionId, collectionId: a.collectionId, startedAtUnixMillis: a.at, endedAtUnixMillis: a.ended ? a.endedAt : '0', outcome: a.outcome || '', live: l.live, liveDetail: l.detail, title: s?.title || '' }; };
    const snippets = attempt ? prompts.filter(p => p.conversationId === attempt.conversationId && p.source?.kind === 'snippet') : [];
    return { id: t.id, goalId: '', title: t.title, brief: t.brief, ...view, attempt: attempt ? wireAttempt(attempt) : undefined, attempts: t.attempts.map(wireAttempt), evidence: t.evidence,
      report: t.report || '', reportedAtUnixMillis: t.reportedAt || '0', decisionNote: t.decisionNote || '', blockedBy: t.blockedBy, createdAtUnixMillis: t.created, updatedAtUnixMillis: t.updated,
      lastSnippet: snippets[0]?.source.snippetKey || '', nextSnippets: snippets[0]?.next || [] };
  };
  const wire = (m, full) => ({ id: m.id, title: m.title, brief: m.brief, process: 'solo-pair', processDigest: 'sha256:fixture', autonomy: 3, createdAtUnixMillis: m.createdAtUnixMillis, updatedAtUnixMillis: m.updatedAtUnixMillis, canceled: m.canceled, seq: String(m.seq), goals: [], tasks: m.tasks.map(t => derive(m, t)), events: full ? m.events.slice(0, 200) : [], error: '', ignored: 0 });
  const refuse = message => ({ error: { code: 'failed_precondition', message } });

  const create = (title, brief = '') => {
    const m = { id: id('m'), title, brief, canceled: false, seq: 0, events: [], tasks: [], createdAtUnixMillis: ms(), updatedAtUnixMillis: ms(), operations: new Map() };
    missions.push(m); append(m, 'mission.created', 'mission', { title }); append(m, 'mission.process_pinned', 'mission', {}, 'lazybox');
    return m;
  };
  const addTask = (m, title, brief = '', blockedBy = []) => {
    const t = { id: id('t'), title, brief, blockedBy, attempts: [], evidence: [], created: ms(), updated: ms() };
    m.tasks.push(t); append(m, 'task.created', 'task:' + t.id, { title }); return t;
  };
  const assign = (m, t, session, newConversation) => {
    const previous = t.attempts.at(-1); if (previous && !previous.ended) Object.assign(previous, { ended: true, endedAt: ms(), outcome: 'handoff' });
    t.attempts.push({ id: id('a'), conversationId: conversationOf(session.id), sessionId: session.id, collectionId: session.collectionId || '', at: ms(), new: newConversation });
    t.rejected = false; t.updated = ms(); append(m, 'task.assigned', 'task:' + t.id, { task: t.id });
  };
  /** A `lazybox run` (or a terminal run) finishing in a conversation: recorded on its live attempts. */
  const recordRun = (sessionId, { title, exitCode, commandId = '' }) => {
    for (const m of missions) for (const t of m.tasks) {
      const a = t.attempts.at(-1);
      if (!a || a.ended || t.accepted || t.canceled || a.conversationId !== conversationOf(sessionId)) continue;
      const e = { ref: `run:${sessionId}/${commandId || id('r')}`, kind: 'run', title, outcome: exitCode === 0 ? 'pass' : 'fail', exitCode, piped: false, member: '', repository: '', head: '', number: '0', url: '', state: '', collectionId: a.collectionId, sessionId, commandId, outputPath: '/fixture/output/' + title.replaceAll(' ', '-') + '.log', detail: 'agent saw 2.1 KiB of 1.4 MiB (go-test filter)', atUnixMillis: ms() };
      t.evidence.unshift(e); t.updated = ms(); append(m, 'evidence.recorded', 'task:' + t.id, e, 'lazybox');
    }
  };
  const recordPullRequest = (collectionId, { number, head, outcome, repository = 'fixture-team/api' }) => {
    for (const m of missions) for (const t of m.tasks) {
      const a = t.attempts.at(-1);
      if (!a || a.ended || t.accepted || t.canceled || a.collectionId !== collectionId) continue;
      const e = { ref: `pr:${repository}#${number}@${head}`, kind: 'pr', title: 'Pull request', outcome, piped: false, member: 'api', repository, head, number: String(number), url: `https://github.com/${repository}/pull/${number}`, state: 'open', collectionId, sessionId: '', commandId: '', outputPath: '', detail: outcome === 'pass' ? '3 checks passed' : 'failed: test', atUnixMillis: ms() };
      t.evidence.unshift(e); t.updated = ms(); append(m, 'evidence.recorded', 'task:' + t.id, e, 'check');
    }
  };

  const update = (m, body) => {
    if (body.operationId && m.operations.has(body.operationId)) return m.operations.get(body.operationId);
    const task = taskId => m.tasks.find(t => t.id === taskId);
    let createdId = '', sessionId = '';
    if (body.addTask) {
      if (!body.addTask.title?.trim()) return refuse('a task needs a title');
      createdId = addTask(m, body.addTask.title.trim(), body.addTask.brief || '', body.addTask.blockedBy || []).id;
    } else if (body.assign) {
      const t = task(body.assign.taskId); if (!t) return refuse('task does not exist');
      let session;
      if (body.assign.open) {
        const collection = collections.find(c => c.id === body.assign.open.collectionId); if (!collection) return refuse('choose the workspace the new conversation works in');
        session = { id: `task-session-${sessions.length}`, collectionId: collection.id, workId: collection.id, profileId: body.assign.open.profileId, title: t.title, status: 'running', busy: true, capabilities: { files: true }, pending: [], createdAtUnixMillis: ms() };
        sessions.push(session);
      } else {
        session = sessions.find(s => s.id === body.assign.sessionId); if (!session) return { error: { code: 'not_found', message: 'conversation not found' } };
      }
      assign(m, t, session, !!body.assign.open); sessionId = session.id;
      if (body.assign.sendBrief) prompts.unshift({ text: t.title + '\n\n' + t.brief, conversationId: conversationOf(session.id), collectionId: session.collectionId, sessionId: session.id, atUnixMillis: ms(), source: { kind: 'mission', missionId: m.id, taskId: t.id } });
    } else if (body.report) {
      const t = task(body.report.taskId); if (!t) return refuse('task does not exist');
      if (t.gate) return refuse(`task “${t.title}” is already waiting for a decision`);
      Object.assign(t, { report: body.report.summary || '', reportedAt: ms(), gate: 'reviewed', rejected: false, reportedAfterAttempt: true, updated: ms() });
      append(m, 'task.reported', 'task:' + t.id, { task: t.id, summary: t.report }); append(m, 'gate.requested', 'task:' + t.id, { task: t.id }, 'rule');
    } else if (body.accept || body.reject) {
      const decision = body.accept || body.reject, t = task(decision.taskId); if (!t) return refuse('task does not exist');
      if (!t.gate) return refuse(`nothing on “${t.title}” is waiting for a decision`);
      Object.assign(t, { gate: '', accepted: !!body.accept, rejected: !!body.reject, decisionNote: decision.note || '', updated: ms() });
      append(m, body.accept ? 'gate.passed' : 'gate.rejected', 'task:' + t.id, { task: t.id, note: decision.note });
    } else if (body.cancelTask) {
      const t = task(body.cancelTask.taskId); if (!t) return refuse('task does not exist');
      t.canceled = true; append(m, 'task.canceled', 'task:' + t.id, { task: t.id });
    } else return { error: { code: 'invalid_argument', message: 'a typed change is required' } };
    const result = { value: { ...wire(m, true), createdId, sessionId } };
    if (body.operationId) m.operations.set(body.operationId, result);
    return result;
  };

  /** One RPC, or undefined when it is not a mission RPC. */
  const handle = (method, body) => {
    switch (method) {
      case 'ListMissions': return { value: { missions: [...missions].reverse().map(m => wire(m, false)) } };
      case 'GetMission': { const m = missions.find(v => v.id === body.missionId); return m ? { value: wire(m, true) } : { error: { code: 'not_found', message: 'mission not found' } }; }
      case 'CreateMission': { if (!body.title?.trim()) return refuse('a mission needs a title'); return { value: wire(create(body.title.trim(), body.brief || ''), true) }; }
      case 'UpdateMission': { const m = missions.find(v => v.id === body.missionId); return m ? update(m, body) : { error: { code: 'not_found', message: 'mission not found' } }; }
      case 'ListPromptHistory': return { value: { prompts: prompts.filter(p => (!body.conversationId || p.conversationId === conversationOf(body.conversationId)) && (!body.collectionId || p.collectionId === body.collectionId)), lastSnippet: '', nextSnippets: [], recentSnippets: [] } };
    }
    return undefined;
  };
  /** A message sent to a conversation, kept like the Runner's prompt log (snippet bodies are labeled). */
  const recordApply = (body, snippets) => {
    const text = body.message?.text; if (!text) return;
    const session = sessions.find(s => s.id === body.sessionId);
    let source = body.message.source || { kind: 'typed' };
    const snippet = snippets.find(s => source.kind === 'snippet' ? s.key === source.snippetKey : s.body.trim() === text.trim());
    const next = snippet?.next || [];
    if (snippet) source = { kind: 'snippet', snippetKey: snippet.key };
    prompts.unshift({ text, conversationId: conversationOf(body.sessionId), collectionId: session?.collectionId || '', sessionId: body.sessionId, atUnixMillis: ms(), source, next });
  };
  return { handle, missions, prompts, create, addTask, assign, recordRun, recordPullRequest, recordApply };
}
