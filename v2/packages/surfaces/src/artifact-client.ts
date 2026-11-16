import { ConnectError } from '@lazybox/client-core';

/** The Runner's own sentence for a failed call, without the transport prefix. */
export const errorText = (error: unknown) => ConnectError.from(error).rawMessage || String(error);

const CHANGED = 'lazybox-artifacts-changed';
/** Tell every artifact list of this workspace in this window to reload now (after a write). */
export const artifactsChanged = (collectionId: string) => window.dispatchEvent(new CustomEvent(CHANGED, { detail: collectionId }));
export const onArtifactsChanged = (listener: (collectionId: string) => void) => {
  const handler = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
};
