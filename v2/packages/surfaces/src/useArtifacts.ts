import { useCallback, useEffect, useState } from 'react';
import type { Artifact } from '@lazybox/protocol';
import { useRunner } from './RunnerContext';
import { errorText, onArtifactsChanged } from './artifact-client';

/** How often a shown list rereads the Runner: a tracked file or an agent may add a version at any time. */
export const ARTIFACT_POLL_MS = 4000;

/**
 * A workspace's artifacts (no content), kept current while mounted: reread
 * every few seconds while the window is visible, and at once after a write
 * from this window.
 */
export function useArtifacts(collectionId: string) {
  const { api } = useRunner();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!collectionId) { setArtifacts([]); setLoaded(true); return; }
    const control = new AbortController();
    let busy = false, again = false;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      if (busy) { again = true; return; }
      busy = true;
      try { const result = await api.listArtifacts({ collectionId }, { signal: control.signal, timeoutMs: 10000 }); if (!control.signal.aborted) { setArtifacts(result.artifacts); setError(''); } }
      catch (e) { if (!control.signal.aborted) setError(errorText(e)); }
      finally { busy = false; if (!control.signal.aborted) { setLoaded(true); if (again) { again = false; void load(); } } }
    };
    void load();
    const timer = setInterval(() => void load(), ARTIFACT_POLL_MS);
    const stop = onArtifactsChanged(changed => { if (changed === collectionId) void load(); });
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { control.abort(); clearInterval(timer); stop(); document.removeEventListener('visibilitychange', visible); };
  }, [api, collectionId, revision]);
  return { artifacts, loaded, error, reload };
}
