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

/**
 * Artifacts of every other workspace, for finding a plan made elsewhere: read
 * once when shown and every 15 seconds while the window is visible.
 */
export function useOtherArtifacts(collections: { id: string; name: string }[], current: string) {
  const { api } = useRunner();
  const [items, setItems] = useState<{ artifact: Artifact; collectionId: string; workspace: string }[]>([]);
  const ids = collections.filter(c => c.id && c.id !== current).map(c => `${c.id}\u0000${c.name}`).join('\u0001');
  useEffect(() => {
    const others = ids ? ids.split('\u0001').map(entry => { const [id, name] = entry.split('\u0000'); return { id, name }; }) : [];
    if (!others.length) { setItems([]); return; }
    const control = new AbortController();
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      const lists = await Promise.all(others.map(c => api.listArtifacts({ collectionId: c.id }, { signal: control.signal, timeoutMs: 10000 })
        .then(result => result.artifacts.map(artifact => ({ artifact, collectionId: c.id, workspace: c.name })))
        .catch(() => [])));
      if (!control.signal.aborted) setItems(lists.flat().sort((a, b) => Number(b.artifact.updatedAtUnixMillis || 0n) - Number(a.artifact.updatedAtUnixMillis || 0n)));
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => { control.abort(); clearInterval(timer); };
  }, [api, ids, current]);
  return items;
}
