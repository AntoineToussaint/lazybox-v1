import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunnerClient } from '@lazybox/client-core';
import type { ReviewRun, Session, StartReviewRequest } from '@lazybox/protocol';
import { useRunner } from './RunnerContext';
import { useRunnerSettings } from './RunnerSettings';
import { errorText } from './PullRequestFlow';
import { reviewerChoices, type ReviewerChoice } from './review-model';
import { refreshWorkspaceReview } from './useWorkspaceReview';

/**
 * One-click cross-agent review, the client half (GITHUB.md, "Agent review"):
 * start a review on the Runner, then show the reviewer conversation it opened
 * and the Review tray its findings land in. Every entry point (Changes,
 * a turn's ⋯ menu, the PR card, the palette, the file list) goes through
 * `useReviewLauncher`, so they choose the reviewer the same way.
 */

export type ReviewScope = { scope: 'changes'; compare?: string } | { scope: 'turn'; turn: number } | { scope: 'pr'; member: string };

// ---- Cross-panel requests -------------------------------------------------

const SHOW_CONVERSATION = 'lazybox-show-conversation';
const SHOW_REVIEW = 'lazybox-show-review';
/** `anywhere`: show it even from another workspace (an agent tree spans workspaces). */
export type ConversationRequest = { collectionId: string; sessionId: string; anywhere?: boolean };
/** Ask the workspace to show a conversation (the reviewer, once started). */
export function showConversation(request: ConversationRequest) { window.dispatchEvent(new CustomEvent<ConversationRequest>(SHOW_CONVERSATION, { detail: request })); }
/** The workspace shows conversations other panels ask for. */
export function useConversationRequests(workspaceId: string, show: (request: ConversationRequest) => void) {
  const ref = useRef(show); ref.current = show;
  useEffect(() => {
    const listener = (event: Event) => { const request = (event as CustomEvent<ConversationRequest>).detail; if (!workspaceId || request.collectionId === workspaceId || request.anywhere) ref.current(request); };
    window.addEventListener(SHOW_CONVERSATION, listener);
    return () => window.removeEventListener(SHOW_CONVERSATION, listener);
  }, [workspaceId]);
}

export type ReviewTrayRequest = { collectionId: string; reviewId?: string };
// The tray a Changes page should open with, asked for before one was mounted.
const requestedTrays = new Map<string, ReviewTrayRequest>();
/** Open the Changes page's Review tray (on one review's findings). */
export function showReview(request: ReviewTrayRequest) {
  requestedTrays.set(request.collectionId, request);
  window.dispatchEvent(new CustomEvent<ReviewTrayRequest>(SHOW_REVIEW, { detail: request }));
}
/** The workspace opens its Changes page when a review is asked for. */
export function useReviewHost(workspaceId: string, showChanges: () => void) {
  const ref = useRef(showChanges); ref.current = showChanges;
  useEffect(() => {
    const listener = (event: Event) => { if ((event as CustomEvent<ReviewTrayRequest>).detail.collectionId === workspaceId) ref.current(); };
    window.addEventListener(SHOW_REVIEW, listener);
    return () => window.removeEventListener(SHOW_REVIEW, listener);
  }, [workspaceId]);
}
/** A Changes page takes the tray request for its workspace, now or once mounted. */
export function useReviewTrayRequests(workspaceId: string, open: (request: ReviewTrayRequest) => void) {
  const ref = useRef(open); ref.current = open;
  useEffect(() => {
    const queued = requestedTrays.get(workspaceId);
    if (queued) { requestedTrays.delete(workspaceId); ref.current(queued); }
    const listener = (event: Event) => {
      const request = (event as CustomEvent<ReviewTrayRequest>).detail;
      if (request.collectionId !== workspaceId) return;
      requestedTrays.delete(workspaceId); ref.current(request);
    };
    window.addEventListener(SHOW_REVIEW, listener);
    return () => window.removeEventListener(SHOW_REVIEW, listener);
  }, [workspaceId]);
}

// ---- Starting one -----------------------------------------------------------

/** Starts a review on the Runner; the reviewer conversation opens beside the work. */
export async function startReview(api: RunnerClient, request: Omit<StartReviewRequest, '$typeName' | '$unknown'>): Promise<{ run?: ReviewRun; session?: Session }> {
  const started = await api.startReview(request, { timeoutMs: 60000 });
  refreshWorkspaceReview(request.collectionId);
  if (started.session) showConversation({ collectionId: started.session.collectionId || request.collectionId, sessionId: started.session.id });
  return started;
}

/**
 * The reviewers a conversation's work can be reviewed by, the default first
 * (the setting's subscription, else the other provider than the author's),
 * and the start itself, with what it is doing and why it failed.
 */
export function useReviewLauncher(workspaceId: string, source?: Pick<Session, 'id' | 'profileId' | 'provider'>) {
  const { api, info } = useRunner();
  // No conversation to review (a transcript on the phone, Peek): nothing to choose a reviewer for.
  const { settings } = useRunnerSettings(!!source);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const authorProvider = source?.provider || info?.profiles.find(p => p.id === source?.profileId)?.provider || '';
  const choices = useMemo(() => reviewerChoices(info?.profiles || [], authorProvider, settings?.review?.reviewer || ''), [info?.profiles, authorProvider, settings?.review?.reviewer]);
  const unavailable = !workspaceId ? 'Choose a workspace first' : !source ? 'No conversation in this workspace to review yet' : !choices.length ? 'No subscription is signed in to review with' : '';
  const start = async (scope: ReviewScope, choice: ReviewerChoice | undefined = choices[0]) => {
    if (!source || !choice || busy) return;
    setBusy(choice.key); setError('');
    try {
      const started = await startReview(api, { collectionId: workspaceId, sourceSessionId: source.id, scope: scope.scope, compare: scope.scope === 'changes' ? scope.compare || '' : '', turn: scope.scope === 'turn' ? scope.turn : 0, member: scope.scope === 'pr' ? scope.member : '', profileId: choice.profileId, provider: choice.profileId ? '' : choice.provider });
      if (started.run?.state === 'failed') setError(started.run.detail);
      return started;
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(''); }
  };
  return { choices, start, busy, error, setError, unavailable };
}
export type ReviewLauncher = ReturnType<typeof useReviewLauncher>;
