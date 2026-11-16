import { useEffect, useRef } from 'react';

/**
 * Requests between panels of one window, like compose.ts: a request is
 * delivered to whoever is mounted for it, or kept until one mounts.
 *
 * - open artifact: the Workspace shows its Artifacts panel, which opens the page;
 * - reveal message: the chat of that conversation scrolls to the message.
 */
export type OpenArtifactRequest = { collectionId: string; artifactId: string };
export type RevealMessageRequest = { sessionId: string; messageId: string };

const OPEN = 'lazybox-open-artifact', REVEAL = 'lazybox-reveal-message';
const pendingOpen = new Map<string, string>(), pendingReveal = new Map<string, string>();

/** Ask the window to show an artifact. True when a workspace took it now. */
export function openArtifact(request: OpenArtifactRequest): boolean {
  pendingOpen.set(request.collectionId, request.artifactId);
  const event = new CustomEvent<OpenArtifactRequest>(OPEN, { detail: request, cancelable: true });
  return !window.dispatchEvent(event);
}

/** The workspace: show the Artifacts panel when an artifact of this workspace is asked for. */
export function useOpenArtifactRequests(collectionId: string, show: (request: OpenArtifactRequest) => void) {
  const ref = useRef(show); ref.current = show;
  useEffect(() => {
    if (!collectionId) return;
    const listener = (event: Event) => {
      const request = (event as CustomEvent<OpenArtifactRequest>).detail;
      if (request.collectionId !== collectionId) return;
      event.preventDefault(); ref.current(request);
    };
    window.addEventListener(OPEN, listener);
    return () => window.removeEventListener(OPEN, listener);
  }, [collectionId]);
}

/** The Artifacts panel: the artifact asked for, now or once mounted. */
export function useArtifactSelection(collectionId: string, select: (artifactId: string) => void) {
  const ref = useRef(select); ref.current = select;
  useEffect(() => {
    if (!collectionId) return;
    const queued = pendingOpen.get(collectionId);
    if (queued) { pendingOpen.delete(collectionId); ref.current(queued); }
    const listener = (event: Event) => {
      const request = (event as CustomEvent<OpenArtifactRequest>).detail;
      if (request.collectionId !== collectionId) return;
      pendingOpen.delete(collectionId);
      // Let the workspace see the request too: it brings the panel into view.
      queueMicrotask(() => ref.current(request.artifactId));
    };
    window.addEventListener(OPEN, listener);
    return () => window.removeEventListener(OPEN, listener);
  }, [collectionId]);
}

/** Scroll a conversation to a message: now if its chat is mounted, else when it is. */
export function revealMessage(request: RevealMessageRequest) {
  pendingReveal.set(request.sessionId, request.messageId);
  window.dispatchEvent(new CustomEvent<RevealMessageRequest>(REVEAL, { detail: request }));
}

/** A chat takes reveal requests for its conversation once its messages are loaded. */
export function useRevealRequests(sessionId: string, ready: boolean, reveal: (messageId: string) => void) {
  const ref = useRef(reveal); ref.current = reveal;
  useEffect(() => {
    if (!sessionId || !ready) return;
    const queued = pendingReveal.get(sessionId);
    if (queued) { pendingReveal.delete(sessionId); requestAnimationFrame(() => ref.current(queued)); }
    const listener = (event: Event) => {
      const request = (event as CustomEvent<RevealMessageRequest>).detail;
      if (request.sessionId !== sessionId) return;
      pendingReveal.delete(sessionId); ref.current(request.messageId);
    };
    window.addEventListener(REVEAL, listener);
    return () => window.removeEventListener(REVEAL, listener);
  }, [sessionId, ready]);
}
