import { useMemo, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { ComposerAttachment } from './AttachmentThumbnail';
import { fileKey, pastedFiles } from './attachment-images';
import type { Session } from '@lazybox/protocol';
import type { ViewStateStore } from '@lazybox/platform';
import type { VimMode } from './composer-vim';
import { Icon } from './Icons';
import { leaderKeys, useVimPreferences, type Keymap } from './keyboard';
import { useComposerVim } from './useComposerVim';
import { DictationOverlay, useComposerDictation } from './voice/ComposerDictation';
import { bindings, displayBinding } from './actions';
import type { FileReference } from './view-state';

/**
 * The message box of a conversation: attached and missing files, the text
 * (with Vim editing and prompt recall), and the send, attach, snippet and
 * interrupt controls. The draft itself is owned by the chat.
 */
export function Composer({ textarea, fileInput, agentName, embedded, session, sessionID, viewState, keymap, limited, message, files, missingFiles, uncertainSend, handedOver, sending, canCompose, canAttach, canSend, permissionPrompt, onSubmit, onChange, onDictate, onRecallKey, onRemoveFile, onRemoveMissingFile, onDropMissingFiles, onDismissHandover, onOpenSnippets, onSelectFiles, onInterrupt, interruptInBar = false, onError, slash }: {
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
  /** Dictated words shown before they are kept (not saved); `onChange` keeps the result. */
  onDictate?(text: string): void;
  /** Prompt recall (↑/↓); true when it handled the key. */
  onRecallKey(event: KeyboardEvent<HTMLTextAreaElement>, vimMode?: VimMode): boolean;
  onRemoveFile(index: number): void;
  onRemoveMissingFile(index: number): void;
  /** Send without the files a restored draft could not bring back. */
  onDropMissingFiles(): void;
  onDismissHandover(): void;
  onOpenSnippets(): void;
  /** Files chosen, dropped or pasted. */
  onSelectFiles(files: FileList | File[] | null): void;
  onInterrupt(): void;
  /** The live bar above offers the right stop for the running turn: no second Interrupt here. */
  interruptInBar?: boolean;
  onError(message: string): void;
  /** Slash commands: the menu above the box, and its keys before any other. */
  slash?: { onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, vimMode?: VimMode): boolean; above: ReactNode; textareaProps: Record<string, unknown> };
}) {
  const vimEditing = useVimPreferences(viewState).composer;
  const reservedKeys = useMemo(() => leaderKeys(keymap), [keymap]);
  const vim = useComposerVim({ textarea, enabled: vimEditing, value: message, resetKey: sessionID, reserved: reservedKeys, onSend: () => { if (canSend || missingFiles.length > 0 || !!message.trim()) textarea.current?.form?.requestSubmit(); } });
  const dictation = useComposerDictation({ textarea, value: message, enabled: canCompose && !sending, onPreview: text => (onDictate || onChange)(text), onCommit: onChange,
    onSend: () => textarea.current?.form?.requestSubmit() });
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (slash?.onKeyDown(event, vim.mode)) return; if (onRecallKey(event, vim.mode)) return; vim.textareaProps.onKeyDown?.(event); };
  // A pasted image (a screenshot, say) attaches like a dropped file; a text paste stays native.
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = pastedFiles(event.clipboardData);
    if (!pasted.length) { vim.textareaProps.onPaste?.(event); return; }
    event.preventDefault();
    if (!canAttach) { onError('This conversation cannot accept files right now.'); return; }
    onSelectFiles(pasted);
  };
  const sendLabel = sending ? 'Sending…' : session?.busy ? 'Queue follow-up' : 'Send message';

  const dictateKey = bindings(keymap['voice.dictate'])[0];
  const dictateHint = dictateKey ? `Dictate · hold ${displayBinding(dictateKey).join(' ')} to talk, tap it to keep listening` : 'Dictate';
  return <form className="composer" onSubmit={event => { dictation.takeOver(); onSubmit(event); }}>
    {files.length > 0 && <ul className="attached-files" aria-label="Attached files">
      {files.map((file, i) => <ComposerAttachment key={fileKey(file, i, files)} file={file} disabled={sending} onRemove={() => onRemoveFile(i)}/>)}
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
    {slash?.above}
    <textarea ref={textarea} data-agent-composer aria-label="Message" placeholder={dictation.active ? 'Listening… speak now' : limited ? `Message ${agentName}… (sent when the conversation continues)` : `Message ${agentName}… (/ for commands)`} value={message}
      className={dictation.active ? 'is-dictating' : undefined}
      aria-busy={dictation.active || undefined}
      onChange={e => { dictation.takeOver(); onChange(e.target.value); }}
      disabled={!canCompose || sending}
      {...vim.textareaProps}
      {...slash?.textareaProps}
      onKeyDown={keyDown}
      onPaste={paste}/>
    <DictationOverlay textarea={textarea} text={message} range={dictation.live}/>
    {permissionPrompt}
    <div className="row">
      {vim.mode && <span className="vim-mode-chip" data-mode={vim.mode} role="status" aria-label={`Vim ${vim.mode} mode`} title="Vim editing: Esc for normal mode, i to type, Enter in normal mode sends. Turn it off in Settings → Shortcuts.">{vim.status}</span>}
      {session?.instructionsPending && !session.closed && <span className="composer-chip" role="status" title="The shared Lazybox instructions changed since this conversation started. The update is sent with your next message.">Instructions updated</span>}
      {dictation.supported && <button type="button" className="icon-button composer-mic" aria-label={dictation.active ? 'Stop dictation' : 'Dictate'} aria-pressed={dictation.active} title={dictation.active ? 'Stop dictation and keep the text' : dictateHint} disabled={!canCompose || sending} onClick={dictation.toggle}><Icon name="mic"/></button>}
      <button type="button" className="icon-button" aria-label="Snippets" title={`Snippets · ${keymap['snippets.open']}`} disabled={!canCompose || sending} onClick={onOpenSnippets}><Icon name="snippets"/></button>
      <button type="button" className="attachment" aria-label={embedded ? 'Attach files' : undefined} disabled={!canAttach} onClick={() => fileInput.current?.click()}>{embedded ? <><Icon name="attach"/> Attach</> : '+ Attach files'}</button>
      <input ref={fileInput} hidden aria-label="Attach files" type="file" multiple onChange={e => { onSelectFiles(e.target.files); e.target.value = ''; }}/>
      <small className="composer-hint keyboard-hint">{vim.mode === 'insert' ? `${keymap['chat.send']} to send · Esc for normal mode` : vim.mode ? vim.hint : `${keymap['chat.send']} to send · Shift+Enter for a new line`}</small>
      {!interruptInBar && (!embedded || session?.busy) && <button type="button" onClick={onInterrupt} disabled={!session?.busy || session.closed}>Interrupt</button>}
      <button className="primary send-button" aria-label={sendLabel} disabled={!canSend}>{embedded ? <Icon name="send" size={18}/> : sendLabel}</button>
    </div>
  </form>;
}
