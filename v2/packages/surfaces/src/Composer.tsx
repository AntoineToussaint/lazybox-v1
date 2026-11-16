import { useMemo, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { Session } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import type { VimMode } from './composer-vim';
import { Icon } from './Icons';
import { leaderKeys, useVimPreferences, type Keymap } from './keyboard';
import { useComposerVim } from './useComposerVim';
import type { FileReference } from './view-state';

/**
 * The message box of a conversation: attached and missing files, the text
 * (with Vim editing and prompt recall), and the send, attach, snippet and
 * interrupt controls. The draft itself is owned by the chat.
 */
export function Composer({ textarea, fileInput, agentName, embedded, session, sessionID, viewState, keymap, limited, message, files, missingFiles, uncertainSend, handedOver, sending, canCompose, canAttach, canSend, permissionPrompt, onSubmit, onChange, onRecallKey, onRemoveFile, onRemoveMissingFile, onDropMissingFiles, onDismissHandover, onOpenSnippets, onSelectFiles, onInterrupt }: {
  textarea: RefObject<HTMLTextAreaElement | null>;
  fileInput: RefObject<HTMLInputElement | null>;
  agentName: string;
  embedded: boolean;
  session?: Session;
  sessionID: string;
  viewState?: ViewStateStore;
  keymap: Keymap;
  /** At a subscription limit: a message waits until the conversation continues. */
  limited: boolean;
  message: string;
  files: File[];
  missingFiles: FileReference[];
  /** The operation ID of a send that was not confirmed. */
  uncertainSend: string;
  /** Why the draft just grew (a run handed over from a terminal). */
  handedOver: string;
  sending: boolean;
  canCompose: boolean;
  canAttach: boolean;
  canSend: boolean;
  /** Shown under the message box: confirming an agent restart for a permission change. */
  permissionPrompt?: ReactNode;
  onSubmit(event: FormEvent): void;
  onChange(text: string): void;
  /** Prompt recall (↑/↓); true when it handled the key. */
  onRecallKey(event: KeyboardEvent<HTMLTextAreaElement>, vimMode?: VimMode): boolean;
  onRemoveFile(index: number): void;
  onRemoveMissingFile(index: number): void;
  /** Send without the files a restored draft could not bring back. */
  onDropMissingFiles(): void;
  onDismissHandover(): void;
  onOpenSnippets(): void;
  onSelectFiles(files: FileList | null): void;
  onInterrupt(): void;
}) {
  const vimEditing = useVimPreferences(viewState).composer;
  const reservedKeys = useMemo(() => leaderKeys(keymap), [keymap]);
  const vim = useComposerVim({ textarea, enabled: vimEditing, value: message, resetKey: sessionID, reserved: reservedKeys, onSend: () => { if (canSend || missingFiles.length > 0) textarea.current?.form?.requestSubmit(); } });
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (onRecallKey(event, vim.mode)) return; vim.textareaProps.onKeyDown?.(event); };
  const sendLabel = sending ? 'Sending…' : session?.busy ? 'Queue follow-up' : 'Send message';

  return <form className="composer" onSubmit={onSubmit}>
    {files.length > 0 && <ul className="attached-files" aria-label="Attached files">
      {files.map((file, i) => <li key={i}>
        <span>{file.name} <small>{Math.ceil(file.size / 1024)} KiB</small></span>
        <button type="button" aria-label={`Remove ${file.name}`} disabled={sending} onClick={() => onRemoveFile(i)}>×</button>
      </li>)}
    </ul>}
    {missingFiles.length > 0 && <div className="restore-files" role="group" aria-label="Files to attach again">
      <p>The window reloaded, so {missingFiles.length === 1 ? 'this file needs' : 'these files need'} to be attached again (or removed) before sending:</p>
      <ul>
        {missingFiles.map((file, i) => <li key={i}><span>{file.name}</span><button type="button" onClick={() => onRemoveMissingFile(i)}>Remove {file.name}</button></li>)}
      </ul>
      <div className="restore-files-actions">
        {canAttach && <button type="button" className="primary" onClick={() => fileInput.current?.click()}>Attach again…</button>}
        <button type="button" onClick={onDropMissingFiles}>{missingFiles.length === 1 ? 'Send without it' : 'Send without them'}</button>
      </div>
    </div>}
    {uncertainSend && !sending && <small className="composer-hint">The previous send was not confirmed. Retrying the unchanged message checks the same operation.</small>}
    {handedOver && <p className="composer-handover" role="status">{handedOver}<button type="button" aria-label="Dismiss" onClick={onDismissHandover}>×</button></p>}
    <textarea ref={textarea} data-agent-composer aria-label="Message" placeholder={limited ? `Message ${agentName}… (sent when the conversation continues)` : `Message ${agentName}…`} value={message}
      onChange={e => onChange(e.target.value)}
      disabled={!canCompose || sending}
      {...vim.textareaProps}
      onKeyDown={keyDown}/>
    {permissionPrompt}
    <div className="row">
      {vim.mode && <span className="vim-mode-chip" data-mode={vim.mode} role="status" aria-label={`Vim ${vim.mode} mode`} title="Vim editing: Esc for normal mode, i to type, Enter in normal mode sends. Turn it off in Settings → Shortcuts.">{vim.status}</span>}
      {session?.instructionsPending && !session.closed && <span className="composer-chip" role="status" title="The shared Lazybox instructions changed since this conversation started. The update is sent with your next message.">Instructions updated</span>}
      <button type="button" className="icon-button" aria-label="Snippets" title={`Snippets · ${keymap['snippets.open']}`} disabled={!canCompose || sending} onClick={onOpenSnippets}><Icon name="snippets"/></button>
      <button type="button" className="attachment" aria-label={embedded ? 'Attach files' : undefined} disabled={!canAttach} onClick={() => fileInput.current?.click()}>{embedded ? <><Icon name="attach"/> Attach</> : '+ Attach files'}</button>
      <input ref={fileInput} hidden aria-label="Attach files" type="file" multiple onChange={e => { onSelectFiles(e.target.files); e.target.value = ''; }}/>
      <small className="composer-hint keyboard-hint">{vim.mode === 'insert' ? `${keymap['chat.send']} to send · Esc for normal mode` : vim.mode ? vim.hint : `${keymap['chat.send']} to send · Shift+Enter for a new line`}</small>
      {(!embedded || session?.busy) && <button type="button" onClick={onInterrupt} disabled={!session?.busy || session.closed}>Interrupt</button>}
      <button className="primary send-button" aria-label={sendLabel} disabled={!canSend}>{embedded ? <Icon name="send" size={18}/> : sendLabel}</button>
    </div>
  </form>;
}
