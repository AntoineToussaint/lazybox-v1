/**
 * Opens the shell panel in a home checkout (or the home folder) and, when
 * asked, types a command there. Lazybox is not a terminal emulator: this is
 * the workspace's own Terminal panel, a shell that starts outside the
 * workspace (`OpenTerminal` with `repositoryHome` or `userHome`). The shell
 * still belongs to the workspace: `lazybox log` typed there feeds its
 * console, and it closes with it.
 */
import type { RunnerClient } from '@lazybox/client-core';
import { runAction } from './actions';
import { showMenuNotice } from './ContextMenu';
import { requestTerminal } from './TerminalPanel';

export type ShellPlace = { repositoryId: string; label: string } | { userHome: true; label: string };

const encoder = new TextEncoder();
const reason = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^\[\w+\]\s*/, '');

/** Waits (briefly) for the shell's first output, its prompt, so typed text lands at it. */
async function prompted(api: RunnerClient, workspaceId: string, terminalId: string) {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    try {
      const { terminals } = await api.listTerminals({ collectionId: workspaceId });
      const terminal = terminals.find(value => value.id === terminalId);
      if (!terminal || terminal.done || terminal.offset > 0n) return;
    } catch { return; }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

/**
 * A new shell in `place`, shown and focused in the workspace's Terminal
 * panel. With `command`, it is typed at the prompt; `run` presses Return
 * (a one-line command the person clicked "Run" on), otherwise it waits there
 * for them to review and run it. Resolves to '' or why it could not.
 */
export async function openHomeShell(api: RunnerClient, workspaceId: string, place: ShellPlace, command = '', run = false): Promise<string> {
  if (!workspaceId) return 'Open a workspace first: the shell runs in its Terminal panel.';
  try {
    const terminal = await api.openTerminal({ collectionId: workspaceId, ...('repositoryId' in place ? { repositoryHome: place.repositoryId } : { userHome: true }), cols: 100, rows: 30, requestKey: crypto.randomUUID() });
    // The specific shell first, so showing the panel does not start another.
    requestTerminal(workspaceId, terminal.id);
    runAction('terminal.open');
    if (command) {
      await prompted(api, workspaceId, terminal.id);
      // A multi-line script goes as one paste, which a shell holds for review.
      const text = command.includes('\n') ? `\x1b[200~${command}\x1b[201~` : command;
      await api.writeTerminal({ terminalId: terminal.id, data: encoder.encode(text + (run ? '\r' : '')) });
      showMenuNotice(run ? `Running in ${place.label}` : `Typed in ${place.label}: review it, then press Return`);
    } else showMenuNotice(`Shell in ${place.label}`);
    return '';
  } catch (error) {
    const why = reason(error);
    showMenuNotice(`Could not open a shell in ${place.label}: ${why}`);
    return why;
  }
}
