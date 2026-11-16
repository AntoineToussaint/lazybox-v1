import { useState } from 'react';
import type { RunnerClient } from '@lazybox/client-core';
import { useContextMenuContribution } from './ContextMenu';
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
 * Tracking from the Files tree: "Track as artifact" in a file row's context
 * menu (the `file` scope of the app's context menus, which also opens, quick
 * looks and copies paths), and the notice saying where the artifact went.
 */
export function useFileContextMenu(workbench: Workbench | undefined) {
  const [notice, onNotice] = useState('');
  useContextMenuContribution<{ path: string; directory: boolean }>('file', ({ detail }) => {
    if (!workbench || detail.directory) return [];
    const markdown = trackableFile(detail.path);
    return ['separator', { label: 'Track as artifact', icon: 'artifact', disabled: !markdown && 'Markdown files only', note: markdown ? undefined : 'Markdown only',
      run: () => void trackFile(workbench.api, workbench.workspaceId, detail.path).then(text => { if (text) onNotice(text); }) }];
  });
  return { element: <>{notice && <p className="tree-status file-artifact-notice" role="status">{notice}<button type="button" className="link-button" onClick={() => onNotice('')}>Dismiss</button></p>}</> };
}
