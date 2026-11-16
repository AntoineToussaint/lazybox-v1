import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CodeRevert, TurnCheckpoint } from '@lazybox/protocol';
import { ActionMenu } from './ActionMenu';
import { DraggableDialog, DialogHeader } from './DraggableDialog';
import { Icon } from './Icons';
import { RevertCodeDialog } from './RevertCodeDialog';
import { useRunner } from './RunnerContext';
import { TurnChangesView } from './TurnChangesView';
import type { TranscriptMessage } from './transcript-model';
import { plural, showTurnChanges, turnEnds, turnSummary, undoable, useTurnCheckpoints } from './turn-checkpoints';
import './turn-checkpoints.css';

/** Which conversation's checkpoints the message list shows, and whether its agent is mid-turn. */
export type CheckpointScope = { sessionId: string; workspaceId: string; busy: boolean };

type Toast = { text: string; problems: string[]; undo?: CodeRevert };

/**
 * A turn's quiet marker at its end: one thin divider saying what it changed,
 * with what a person can do about it (show, revert) in its ⋯ menu.
 */
function TurnMarker({ turn, busy, reverted, onShow, onRevert, onUndo, undoing }: { turn: TurnCheckpoint; busy: boolean; reverted?: CodeRevert; onShow(): void; onRevert(): void; onUndo(): void; undoing: boolean }) {
  const failed = turn.before.filter(repo => repo.error);
  return <div className="turn-checkpoint" role="group" aria-label={`Turn ${turn.turn} checkpoint`} data-turn={turn.turn} data-reverted={reverted ? '' : undefined}>
    <span className="turn-checkpoint-line" aria-hidden="true"/>
    <span className="turn-checkpoint-summary" title={`Checkpoint saved before turn ${turn.turn}${turn.endedAtUnixMillis ? ' and after it' : ''}, uncommitted and untracked files included`}>
      Turn {turn.turn} · {turnSummary(turn)}
    </span>
    {failed.length > 0 && <span className="turn-checkpoint-warning" title={failed.map(repo => `${repo.member}: ${repo.error}`).join('\n')}>{failed.length === turn.before.length ? 'Not checkpointed' : `${plural(failed.length, 'repository')} not checkpointed`}</span>}
    {reverted && <span className="turn-checkpoint-reverted" role="status">Files reverted to before this turn<button type="button" disabled={undoing || busy} onClick={onUndo}>{undoing ? 'Undoing…' : 'Undo revert'}</button></span>}
    {(turn.files > 0 || failed.length < turn.before.length) && <ActionMenu className="turn-checkpoint-menu" label={`Turn ${turn.turn} actions`}>
      {turn.files > 0 && <button type="button" onClick={onShow}><Icon name="eye" size={13}/> Show changes in this turn</button>}
      {failed.length < turn.before.length && <button type="button" disabled={busy} title={busy ? 'Wait for the agent’s turn to end, or interrupt it, before reverting files' : 'Put every file in this workspace back as it was before this turn. You can undo it.'} onClick={onRevert}><Icon name="history" size={13}/> Revert to before this turn…</button>}
    </ActionMenu>}
    <span className="turn-checkpoint-line end" aria-hidden="true"/>
  </div>;
}

/**
 * Per-turn checkpoint affordances for a conversation's message list: a
 * marker after each finished turn, the revert confirmation, the turn's
 * changes when no Changes page can show them, and the undo toast.
 */
export function useCheckpointUI(messages: readonly TranscriptMessage[], scope?: CheckpointScope) {
  const { api } = useRunner();
  const sessionId = scope?.sessionId || '', busy = !!scope?.busy;
  const ends = useMemo(() => scope ? turnEnds(messages) : new Map<string, string>(), [messages, !!scope]);
  const checkpoints = useTurnCheckpoints(api, sessionId, busy, !!scope, [...ends.values()].at(-1));
  const [confirming, setConfirming] = useState<TurnCheckpoint>();
  const [viewing, setViewing] = useState<TurnCheckpoint>();
  const [toast, setToast] = useState<Toast>();
  const [undoing, setUndoing] = useState(false);
  useEffect(() => { setConfirming(undefined); setViewing(undefined); setToast(undefined); }, [sessionId]);
  // A toast for a revert stays until dismissed or replaced; one without an action fades.
  useEffect(() => { if (!toast || toast.undo || toast.problems.length) return; const timer = setTimeout(() => setToast(undefined), 8000); return () => clearTimeout(timer); }, [toast]);
  const last = undoable(checkpoints.reverts);
  const revertedTurn = last?.kind === 'revert' ? last.turn : 0;
  const undo = async (revert: CodeRevert) => {
    setUndoing(true);
    try {
      const done = await api.undoRevertCode({ sessionId, revertId: revert.id }, { timeoutMs: 180000 });
      setToast({ text: `Revert undone. ${plural(done.files, 'file')} back as they were.`, problems: done.problems });
    } catch (e) { setToast({ text: 'Could not undo the revert.', problems: [String(e)] }); }
    finally { setUndoing(false); checkpoints.reload(); }
  };
  const show = (turn: TurnCheckpoint) => {
    if (scope?.workspaceId && showTurnChanges({ workspaceId: scope.workspaceId, sessionId, turn: turn.turn })) return;
    setViewing(turn);
  };
  const marker = (messageId: string): ReactNode => {
    const operation = ends.get(messageId);
    const turn = operation ? checkpoints.turns.get(operation) : undefined;
    if (!scope || !turn) return null;
    // The running turn has no marker yet: what it changed is not known.
    if (!turn.endedAtUnixMillis && busy) return null;
    return <TurnMarker turn={turn} busy={busy} reverted={revertedTurn === turn.turn ? last : undefined} undoing={undoing}
      onShow={() => show(turn)} onRevert={() => setConfirming(turn)} onUndo={() => last && void undo(last)}/>;
  };
  const overlay = scope ? <>
    {confirming && <RevertCodeDialog sessionId={sessionId} turn={confirming} later={[...checkpoints.byNumber.keys()].filter(n => n > confirming.turn).length} onClose={() => setConfirming(undefined)} onReverted={revert => {
      setConfirming(undefined); checkpoints.reload();
      setToast({ text: `Reverted ${plural(revert.files, 'file')} to before turn ${revert.turn}.`, problems: revert.problems, undo: revert });
    }}/>}
    {viewing && <TurnChangesDialog sessionId={sessionId} turn={viewing} onClose={() => setViewing(undefined)}/>}
    {toast && <div className="checkpoint-toast" role="status" aria-live="polite">
      <div><span>{toast.text}</span>{toast.problems.length > 0 && <details><summary>{plural(toast.problems.length, 'problem')}</summary><ul>{toast.problems.map((problem, i) => <li key={i}>{problem}</li>)}</ul></details>}</div>
      {toast.undo && <button type="button" className="primary" disabled={undoing || busy} onClick={() => { const revert = toast.undo!; void undo(revert); }}>{undoing ? 'Undoing…' : 'Undo revert'}</button>}
      <button type="button" className="checkpoint-toast-close" aria-label="Dismiss" onClick={() => setToast(undefined)}>×</button>
    </div>}
  </> : null;
  return { marker, overlay };
}

/** A turn's changes where no Changes page is open to show them (a chat in its own window). */
function TurnChangesDialog({ sessionId, turn, onClose }: { sessionId: string; turn: TurnCheckpoint; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <DraggableDialog ref={dialog} className="turn-changes-dialog" aria-label={`Changes in turn ${turn.turn}`} onCancel={onClose}>
    <DialogHeader><h2>Turn {turn.turn} changes</h2><button type="button" aria-label="Close turn changes" onClick={onClose}>×</button></DialogHeader>
    <TurnChangesView sessionId={sessionId} turn={turn.turn} prompt={turn.prompt}/>
  </DraggableDialog>;
}
