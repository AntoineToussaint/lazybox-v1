import { useState } from 'react';
import { ConnectError } from '@lazybox/client-core';
import { Icon } from './Icons';
import { awaitingRows, evidenceChip, flagLabel, headlineEvidence, trustLabel, trustMeaning, type AwaitingRow } from './missions-model';
import { useMissions } from './useMissions';
import type { ViewTarget } from './workspace-model';
import './missions.css';

/** How many tasks wait for the person's acceptance, across missions. */
export function useAwaitingTasks(): number {
  return awaitingRows(useMissions().missions).length;
}

/**
 * The inbox's "Awaiting acceptance" group: a task reported done waits at its
 * human gate until the person accepts it or asks for changes, here or on the
 * mission's board. The trust badge says what backs the report.
 */
export function MissionInboxSection({ onOpen }: { onOpen(target: ViewTarget): void }) {
  const missions = useMissions();
  const rows = awaitingRows(missions.missions);
  if (!rows.length) return null;
  return <section className="inbox-group inbox-missions group-awaiting" aria-labelledby="inbox-group-awaiting">
    <h3 id="inbox-group-awaiting"><Icon name="target" size={13}/>Awaiting acceptance<span>{rows.length}</span></h3>
    <ul>{rows.map(row => <AwaitingTask key={row.task.id} row={row} onOpen={onOpen} update={missions.update}/>)}</ul>
  </section>;
}

function AwaitingTask({ row: { mission, task }, onOpen, update }: { row: AwaitingRow; onOpen(target: ViewTarget): void; update: ReturnType<typeof useMissions>['update'] }) {
  const [changes, setChanges] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const decide = async (accept: boolean) => {
    setBusy(true); setError('');
    try { await update(mission.id, accept ? { case: 'accept', value: { taskId: task.id, note: '' } } : { case: 'reject', value: { taskId: task.id, note: changes || '' } }); }
    catch (e) { setError(ConnectError.from(e).rawMessage || String(e)); setBusy(false); }
  };
  const attempt = task.attempt;
  return <li className="inbox-item inbox-task" data-task={task.id}>
    <div className="inbox-task-head"><strong>{task.title}</strong><span className={`trust-badge trust-${task.trust}`} title={trustMeaning[task.trust]}>{trustLabel[task.trust] || task.trust}</span></div>
    <span className="inbox-task-meta">{mission.title}{task.report ? ` · “${task.report}”` : ''}</span>
    <p className="inbox-task-reason">{task.reason}{task.flags.filter(f => f !== 'no_evidence').map(f => ` · ${flagLabel[f] || f}`).join('')}</p>
    {headlineEvidence(task.evidence).length > 0 && <span className="inbox-task-meta">{headlineEvidence(task.evidence).map(e => { const chip = evidenceChip(e); return `${chip.mark} ${chip.label}`; }).join('   ')}</span>}
    {error && <p className="missions-error" role="alert">{error}</p>}
    <div className="inbox-task-actions">
      {changes === null ? <>
        <button type="button" className="primary" disabled={busy} onClick={() => void decide(true)}>Accept</button>
        <button type="button" disabled={busy} onClick={() => setChanges('')}>Ask for changes…</button>
        {attempt?.sessionId && <button type="button" onClick={() => onOpen({ collectionId: attempt.collectionId, sessionId: attempt.sessionId, commandId: '' })}>Open conversation</button>}
      </> : <>
        <textarea autoFocus rows={2} aria-label={`What should change in ${task.title}`} placeholder="What should change" value={changes} onChange={e => setChanges(e.target.value)}/>
        <button type="button" className="primary" disabled={busy || !changes.trim()} onClick={() => void decide(false)}>Ask for changes</button>
        <button type="button" disabled={busy} onClick={() => setChanges(null)}>Back</button>
      </>}
    </div>
  </li>;
}
