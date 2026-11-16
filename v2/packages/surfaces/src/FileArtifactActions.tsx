import { useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { RunnerClient } from '@lazybox/client-core';
import { ContextMenu, menuPoint, type ContextMenuState } from './ContextMenu';
import { artifactsChanged, errorText } from './artifact-client';
import { openArtifact } from './artifact-events';
import type { Workbench } from './workbench';

/** Files an artifact can follow: Markdown, which the artifact page renders. */
export const trackableFile = (path: string) => /\.(md|markdown|mdx)$/i.test(path);

/**
 * Track a workspace file as an artifact and show it. Tracking a file that is
 * already tracked opens that artifact; the Runner records a version whenever
 * the file changes on disk.
 */
export async function trackFile(api: RunnerClient, collectionId: string, path: string): Promise<string> {
  try {
    const artifact = await api.trackArtifactFile({ collectionId, path }, { timeoutMs: 15000 });
    artifactsChanged(collectionId);
    return openArtifact({ collectionId, artifactId: artifact.id }) ? '' : `Tracking “${artifact.title}”. Open it from the Artifacts panel.`;
  } catch (error) { return `Could not track ${path}: ${errorText(error)}`; }
}

/**
 * The Files tree's right-click menu: open, open beside, quick look, copy the
 * path, and track a Markdown file as an artifact. Shift+right-click keeps the
 * browser's own menu.
 */
export function useFileContextMenu(workbench: Workbench | undefined) {
  const [menu, setMenu] = useState<ContextMenuState>(), [notice, onNotice] = useState('');
  const show = (row: HTMLElement, point: { x: number; y: number }) => {
    const path = row.dataset.path;
    if (!workbench || !path || row.getAttribute('aria-expanded') !== null) return false;
    const markdown = trackableFile(path);
    setMenu({ ...point, label: `${path} actions`, returnFocus: row, items: [
      { label: 'Open', icon: 'file', run: () => workbench.open(path, { focus: true }) },
      { label: 'Open to the side', icon: 'split-right', run: () => workbench.open(path, { focus: true, side: 'row' }) },
      { label: 'Quick look', icon: 'eye', run: () => workbench.host.quickLook(path) },
      { label: 'Copy path', icon: 'copy', run: () => void navigator.clipboard.writeText(path) },
      { label: 'Track as artifact', icon: 'artifact', separatorBefore: true, disabled: !markdown, hint: markdown ? undefined : 'Markdown only', run: () => void trackFile(workbench.api, workbench.workspaceId, path).then(text => { if (text) onNotice(text); }) },
    ] });
    return true;
  };
  const onContextMenu = (event: ReactMouseEvent) => {
    if (event.shiftKey) return;
    const row = (event.target as Element).closest<HTMLElement>('[role="treeitem"][data-path]');
    if (row && show(row, menuPoint(event))) event.preventDefault();
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    const row = (event.target as Element).closest<HTMLElement>('[role="treeitem"][data-path]');
    if (!row) return;
    const bounds = row.getBoundingClientRect();
    if (show(row, { x: bounds.left + 24, y: bounds.bottom - 2 })) { event.preventDefault(); event.stopPropagation(); }
  };
  return { onContextMenu, onKeyDown, element: <>{menu && <ContextMenu menu={menu} onClose={() => setMenu(undefined)}/>}{notice && <p className="tree-status file-artifact-notice" role="status">{notice}<button type="button" className="link-button" onClick={() => onNotice('')}>Dismiss</button></p>}</> };
}
