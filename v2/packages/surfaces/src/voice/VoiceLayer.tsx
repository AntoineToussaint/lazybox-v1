import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { ViewStateStore } from '@lazybox/platform';
import { bindings, canonicalBinding, canonicalKey, chordFromEvent, displayBinding, runAction, useActions } from '../actions';
import { Icon } from '../Icons';
import type { Keymap } from '../keyboard';
import { elapsed } from './voice-model';
import { cancelDictation, dictating, dismissVoiceError, setDictationKeyHeld, setDictationMode, setVoicePreferencesContext, startDictation, stopDictation, stopReading, toggleDictation, useVoicePreferences, useVoiceState, voiceKeysSuspended, voiceState, type DictationKind } from './voice-session';
import './voice.css';

/** How long a press of the dictation key may last and still be a tap (it then keeps listening). */
export const TAP_MS = 350;

/**
 * One per window: the voice actions, the push-to-talk keys, Esc, and the
 * pill. The keys are held, so this layer owns their keydown and keyup; the
 * chord and sequence dispatchers skip them (`hold` in actions.ts).
 */
export function VoiceLayer({ viewState, keymap, onOpenSettings }: { viewState?: ViewStateStore; keymap: Keymap; onOpenSettings?(): void }) {
  const [preferences] = useVoicePreferences(viewState);
  useEffect(() => { setVoicePreferencesContext(preferences); }, [preferences]);
  const state = useVoiceState();
  const latest = useRef({ preferences, keymap }); latest.current = { preferences, keymap };

  /** Say a command: the palette opens (if it is not), then listens. */
  const listenForCommand = (mode: 'hold' | 'toggle') => {
    if (!document.querySelector('dialog.command-palette[open]')) runAction('palette.open');
    // The palette registers itself as a target once it has rendered.
    let frames = 0;
    const attempt = () => {
      if (dictating()) return;
      if (document.querySelector('dialog.command-palette[open]') || frames > 20) { void startDictation({ mode, kind: 'palette' }); return; }
      frames++; requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  };

  useActions({
    'voice.dictate': () => toggleDictation(),
    'voice.command': () => { if (dictating()) void stopDictation(); else listenForCommand('toggle'); },
    'voice.stop-reading': { run: () => void stopReading(), enabled: () => voiceState().reading },
  });

  // The push-to-talk keys and Esc, before anything else sees them.
  useEffect(() => {
    const keysOf = (id: 'voice.dictate' | 'voice.command') => bindings(latest.current.keymap[id]).map(canonicalBinding);
    let pressed: { kind: DictationKind; at: number; code: string; modifiers: string[]; stops: boolean } | null = null;
    const behaviour = () => latest.current.preferences.keyBehaviour;
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        const phase = voiceState().phase;
        if (dictating()) { event.preventDefault(); event.stopImmediatePropagation(); cancelDictation(); return; }
        if (phase === 'error') { event.preventDefault(); event.stopImmediatePropagation(); dismissVoiceError(); return; }
        if (voiceState().reading) { event.preventDefault(); event.stopImmediatePropagation(); void stopReading(); }
        return;
      }
      if (voiceKeysSuspended() || !(event.altKey || event.ctrlKey || event.metaKey || /^F\d+$/.test(event.key))) return;
      const binding = canonicalKey(chordFromEvent(event));
      const kind: DictationKind | null = keysOf('voice.dictate').includes(binding) ? 'composer' : keysOf('voice.command').includes(binding) ? 'palette' : null;
      if (!kind) return;
      // Another dialog has the window (a confirmation, Settings' key recorder…): the key is its own.
      if (otherDialogOpen()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat || pressed) return;
      const modifiers = binding.split('+').slice(0, -1).map(m => m === 'Ctrl' ? 'Control' : m);
      pressed = { kind, at: Date.now(), code: event.code, modifiers, stops: false };
      setDictationKeyHeld(true);
      // Pressed while listening (a tap started it): this press stops it.
      if (dictating()) { pressed.stops = true; void stopDictation(); return; }
      const mode = behaviour() === 'toggle' ? 'toggle' : 'hold';
      // In the palette, either key talks to the palette.
      if (kind === 'palette' || document.querySelector('dialog.command-palette[open]')) listenForCommand(mode);
      else void startDictation({ mode });
    };
    const release = (held: number, stops: boolean) => {
      setDictationKeyHeld(false);
      if (stops || behaviour() === 'toggle') return;
      if (behaviour() === 'both' && held < TAP_MS) { setDictationMode('toggle'); return; }
      void stopDictation();
    };
    const keyup = (event: KeyboardEvent) => {
      if (!pressed) return;
      const ends = event.code === pressed.code || pressed.modifiers.includes(event.key);
      if (!ends) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const { at, stops } = pressed; pressed = null;
      release(Date.now() - at, stops);
    };
    // The window lost the keyboard with the key down: the keyup will not come.
    const blur = () => { if (pressed) { const { at, stops } = pressed; pressed = null; release(Math.max(TAP_MS, Date.now() - at), stops); } };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', blur); };
  }, []);

  // Leaving the window (unmount) never leaves a microphone open.
  useEffect(() => () => { if (dictating()) cancelDictation(); }, []);

  // The palette is a modal dialog, above anything else: it shows its own (inline) pill.
  return state.kind === 'palette' && document.querySelector('dialog.command-palette[open]') ? null : <VoicePill state={state} keymap={keymap} onOpenSettings={onOpenSettings}/>;
}

/** A modal dialog other than the command palette is open: the rest of the window is inert. */
function otherDialogOpen(): boolean {
  return [...document.querySelectorAll('dialog[open]')].some(dialog => !dialog.classList.contains('command-palette') && (() => { try { return dialog.matches(':modal'); } catch { return true; } })());
}

const pillKey = 'lazybox:voice-pill:offset';
function readOffset(): { x: number; y: number } {
  try { const value = JSON.parse(localStorage.getItem(pillKey) || 'null'); if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) return value; } catch { /* a convenience */ }
  return { x: 0, y: 0 };
}

/**
 * While the microphone is open, and while something is read aloud: what is
 * happening (and where the text goes), the level, the time, whether audio
 * stays on this device, and how to stop. Drag it anywhere; it stays there.
 */
export function VoicePill({ state, keymap, onOpenSettings, inline }: { state: ReturnType<typeof useVoiceState>; keymap?: Keymap; onOpenSettings?(): void; inline?: boolean }) {
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(readOffset);
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  const listening = state.phase === 'starting' || state.phase === 'listening' || state.phase === 'stopping';
  // Just above the message box being dictated into, so it never covers the words; else low in the window.
  const [anchor, setAnchor] = useState<{ bottom: number; left: number } | undefined>();
  useLayoutEffect(() => {
    const box = state.kind === 'composer' ? document.querySelector('textarea.is-dictating')?.closest('form')?.getBoundingClientRect() : undefined;
    setAnchor(box && box.top > 80 ? { bottom: Math.round(window.innerHeight - box.top + 10), left: Math.round(box.left + box.width / 2) } : undefined);
  }, [state.kind, listening]);
  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [listening]);
  if (!listening && state.phase !== 'error' && !state.reading) return null;

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (inline || (event.target as HTMLElement).closest('button')) return;
    drag.current = { x: event.clientX, y: event.clientY, from: offset };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const half = window.innerWidth / 2 - 120;
    setOffset({ x: Math.max(-half, Math.min(half, drag.current.from.x + event.clientX - drag.current.x)), y: Math.max(-window.innerHeight + 140, Math.min(60, drag.current.from.y + event.clientY - drag.current.y)) });
  };
  const up = () => { if (!drag.current) return; drag.current = null; try { localStorage.setItem(pillKey, JSON.stringify(offset)); } catch { /* a convenience */ } };
  const style: CSSProperties | undefined = inline ? undefined : { transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)`, ...(anchor && listening ? anchor : {}) };
  const key = bindings(keymap?.['voice.dictate'])[0];
  const keyText = key ? displayBinding(key).join(' ') : '';

  if (state.phase === 'error') {
    return <div className={'voice-pill is-error' + (inline ? ' is-inline' : '')} role="alert" style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <span className="voice-pill-icon"><Icon name="alert" size={15}/></span>
      <span className="voice-pill-text">{state.error}</span>
      {onOpenSettings && <button type="button" className="voice-pill-button" onClick={() => { dismissVoiceError(); onOpenSettings(); }}>Voice settings</button>}
      <button type="button" className="icon-button voice-pill-close" aria-label="Dismiss" onClick={dismissVoiceError}><Icon name="close" size={13}/></button>
    </div>;
  }
  if (!listening) {
    return <div className="voice-pill is-reading" role="status" aria-label="Reading aloud" style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      <span className="voice-pill-icon"><Icon name="speaker" size={15}/></span>
      <span className="voice-pill-text">Reading aloud</span>
      <kbd>Esc</kbd>
      <button type="button" className="icon-button voice-pill-close" aria-label="Stop reading aloud" title="Stop reading aloud · Esc" onClick={() => void stopReading()}><Icon name="stop" size={13}/></button>
    </div>;
  }
  const what = state.phase === 'starting' ? 'Starting the microphone…' : state.phase === 'stopping' ? 'Finishing…' : state.kind === 'palette' ? 'Say a command' : 'Listening';
  const hint = state.mode === 'hold' ? 'Release to finish' : keyText ? `${keyText} to finish` : 'Stop to finish';
  const level = state.level ?? (state.hearing ? 0.6 : 0.12);
  return <div className={'voice-pill' + (inline ? ' is-inline' : '')} data-phase={state.phase} data-kind={state.kind} role="status" aria-label={`${what}. ${state.onDevice ? 'On-device.' : ''}`} style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
    <span className="voice-pill-dot" aria-hidden="true"/>
    <span className={'voice-pill-meter' + (state.level === undefined ? ' is-estimated' : '')} aria-hidden="true">
      {[0.55, 0.8, 1, 0.8, 0.55].map((weight, i) => <i key={i} style={{ transform: `scaleY(${Math.max(0.18, Math.min(1, level * weight * 1.4))})` }}/>)}
    </span>
    <span className="voice-pill-text">{what}</span>
    <span className="voice-pill-time" aria-label="Elapsed">{elapsed(now - state.startedAt)}</span>
    {state.phase === 'listening' && <span className={'voice-pill-privacy' + (state.onDevice ? ' is-local' : '')} title={state.onDevice ? 'Recognized on this device: the audio never leaves it.' : `${state.engine}: the audio is sent to its speech service.`}>
      <Icon name={state.onDevice ? 'lock' : 'cloud'} size={12}/>{state.onDevice ? 'On-device' : 'Online'}
    </span>}
    <span className="voice-pill-hint">{hint} · <kbd>Esc</kbd> cancel</span>
    <button type="button" className="icon-button voice-pill-stop" aria-label="Stop dictation" title={`Stop and keep the text${keyText ? ` · ${keyText}` : ''}`} onClick={() => void stopDictation()} disabled={state.phase !== 'listening'}><Icon name="stop" size={13}/></button>
    <button type="button" className="icon-button voice-pill-close" aria-label="Cancel dictation" title="Cancel · Esc" onClick={cancelDictation}><Icon name="close" size={13}/></button>
  </div>;
}
