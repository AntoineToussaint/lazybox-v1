import { useEffect, useRef, useState } from 'react';
import type { ViewStateStore } from '@lazybox/platform';
import { readDraft, writeDraft, type FileReference } from './view-state';

/** The message and files of a send whose delivery is not yet confirmed. */
export type SendAttempt = { id: string; text: string; files: File[] };

/**
 * The composer's draft for one conversation: its text, the files attached in
 * this window, the files a restored draft names but this window no longer
 * holds, and the operation identity of a send that was not confirmed. Every
 * edit persists it, so the draft survives this view remounting.
 */
export function useComposerDraft(viewState: ViewStateStore | undefined, sessionID: string, onError: (message: string) => void) {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [missingFiles, setMissingFiles] = useState<FileReference[]>([]);
  const [uncertainSend, setUncertainSend] = useState('');
  const sendAttempt = useRef<SendAttempt | null>(null);

  useEffect(() => {
    try {
      const draft = readDraft(viewState, sessionID);
      setMessage(draft.text); setMissingFiles(draft.files); setFiles([]); setUncertainSend(draft.operationId); sendAttempt.current = null;
    } catch (e) { onError(`Could not restore this window's draft: ${String(e)}`); }
  }, [viewState, sessionID]);

  const persistDraft = (text: string, selected: File[], missing: FileReference[], operationId = '') => {
    try { writeDraft(viewState, sessionID, { text, files: [...selected.map(file => ({ name: file.name, size: file.size, lastModified: file.lastModified })), ...missing], operationId }); }
    catch (e) { onError(`Could not save this window's draft: ${String(e)}`); }
  };

  return { message, setMessage, files, setFiles, missingFiles, setMissingFiles, uncertainSend, setUncertainSend, sendAttempt, persistDraft };
}
