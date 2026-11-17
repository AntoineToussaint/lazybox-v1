import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArtifactHostContext } from './ArtifactPage';
import { artifactChip, asKind, kindIcon, kindLabel } from './artifact-model';
import { openArtifact } from './artifact-events';
import { Icon } from './Icons';
import { OTHER_ARTIFACTS_POLL_MS, useArtifacts } from './useArtifacts';
import './artifacts.css';

/**
 * An artifact in the conversation: what an agent published (`lazybox artifact
 * put`) or a message tracked, where it happened. Open shows its page in the
 * workspace's Artifacts panel; an update also offers its changes.
 */
export function ArtifactCard({ collectionId, artifactId, title, kind, version, how }: {
  collectionId: string;
  artifactId: string;
  title: string;
  kind: string;
  /** The version this card is about: the page opens on it. */
  version: number;
  /** What happened, in a few words: "Published by the agent", "Tracked from this message". */
  how: string;
}) {
  const host = useContext(ArtifactHostContext);
  const [note, setNote] = useState('');
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const shown = asKind(kind);
  const open = (compare: boolean) => {
    const request = { collectionId, artifactId, version, ...(compare ? { compareWith: version - 1 } : {}) };
    if (openArtifact(request)) return;
    // No workspace in this window (a chat in its own window): the page in a window of its own.
    if (host.openArtifact) { void host.openArtifact({ collectionId, artifactId }).catch(() => setNote('Open it from the Artifacts panel of its workspace.')); return; }
    setNote('Open it from the Artifacts panel of its workspace.');
    clearTimeout(timer.current); timer.current = window.setTimeout(() => setNote(''), 6000);
  };
  return <div className="artifact-card" role="group" aria-label={`Artifact “${title}”, v${version}`} data-artifact-id={artifactId}>
    <span className={`artifact-kind-icon kind-${shown}`} aria-hidden="true"><Icon name={kindIcon[shown]} size={15}/></span>
    <span className="artifact-card-text">
      <strong title={title}>{title}</strong>
      <small>{kindLabel[shown]} · v{version} · {how}</small>
    </span>
    <span className="artifact-card-actions">
      {version > 1 && <button type="button" onClick={() => open(true)}>Compare with v{version - 1}</button>}
      <button type="button" className="artifact-card-open" onClick={() => open(false)}>Open</button>
    </span>
    {note && <small className="artifact-card-note" role="status">{note}</small>}
  </div>;
}

/**
 * The chat header's "3 artifacts": this conversation's artifacts, else the
 * workspace's. It opens the Artifacts panel on them; with none it is not there.
 */
export function ArtifactsChip({ collectionId, sessionId, conversationId, title }: { collectionId: string; sessionId: string; conversationId: string; title?: string }) {
  const { artifacts } = useArtifacts(collectionId, OTHER_ARTIFACTS_POLL_MS);
  const host = useContext(ArtifactHostContext);
  const chip = useMemo(() => artifactChip(artifacts, { sessionId, conversationId }), [artifacts, sessionId, conversationId]);
  if (!chip) return null;
  const show = () => {
    if (openArtifact({ collectionId, artifactId: '', ...(chip.mine ? { conversation: { sessionId, conversationId, title } } : {}) })) return;
    // No workspace in this window: the newest one in a window of its own.
    const newest = [...artifacts].sort((a, b) => Number(b.updatedAtUnixMillis) - Number(a.updatedAtUnixMillis))[0];
    if (newest && host.openArtifact) void host.openArtifact({ collectionId, artifactId: newest.id });
  };
  return <button type="button" className="chat-artifacts-button" title={`${chip.title}\nShow them in the Artifacts panel`} aria-label={`${chip.title}: show them`} onClick={show}>
    <Icon name="artifact" size={14}/><span>{chip.label}</span>
  </button>;
}
