/**
 * Short, quiet alert sounds, synthesized with Web Audio (no audio files):
 * - "request": two soft rising notes, for an agent that needs you;
 * - "done": one soft falling pair, for an agent that finished its turn.
 *
 * Browsers start an AudioContext suspended until the person interacts with
 * the page, so the first click or key in the window unlocks it.
 */
export type AlertSound = 'request' | 'done';

type Context = AudioContext;
let context: Context | undefined;
const lastPlayed: Record<AlertSound, number> = { request: 0, done: 0 };
const notes: Record<AlertSound, [frequency: number, start: number, length: number][]> = {
  request: [[659.25, 0, 0.16], [987.77, 0.12, 0.24]],
  done: [[880, 0, 0.14], [659.25, 0.1, 0.26]],
};

function audio(): Context | undefined {
  if (context) return context;
  const Constructor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext || (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return undefined;
  try { context = new Constructor(); } catch { return undefined; }
  return context;
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    if (context?.state === 'suspended') void context.resume().catch(() => {});
    if (context && context.state !== 'suspended') { window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true); }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/** Plays an alert, at most once a second and a half per kind: a burst of agents is one sound. */
export function playAlert(kind: AlertSound, { force = false } = {}): boolean {
  const now = Date.now();
  if (!force && now - lastPlayed[kind] < 1500) return false;
  const ctx = audio();
  if (!ctx) return false;
  lastPlayed[kind] = now;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  const start = ctx.currentTime + 0.01;
  const master = ctx.createGain();
  master.gain.value = 0.07;
  master.connect(ctx.destination);
  for (const [frequency, offset, length] of notes[kind]) {
    const oscillator = ctx.createOscillator(), envelope = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.0001, start + offset);
    envelope.gain.exponentialRampToValueAtTime(1, start + offset + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + offset + length);
    oscillator.connect(envelope); envelope.connect(master);
    oscillator.start(start + offset); oscillator.stop(start + offset + length + 0.02);
  }
  return true;
}
