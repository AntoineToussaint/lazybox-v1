import type { ViewStateStore } from '@lazybox/platform';
import { readPreference, writePreference } from './view-state';

/**
 * Sent messages, for ↑/↓ recall in the message box: this conversation's first,
 * newest first, then every other conversation's. Stored per window root, so
 * every window of the app shares one history, like a shell's.
 */
export type PromptEntry = { text: string; conversation: string };
const key = 'prompt-history:v1', limit = 200, textLimit = 16 << 10;

export function parsePromptHistory(raw: string | null): PromptEntry[] {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter(e => e && typeof e.text === 'string' && typeof e.conversation === 'string').slice(0, limit) : [];
  } catch { return []; }
}

/** Pure: the history with `text` as its newest entry; repeats move to the top. Blank and oversized text is not kept. */
export function recordPrompt(history: readonly PromptEntry[], text: string, conversation: string): PromptEntry[] {
  if (!text.trim() || text.length > textLimit) return [...history];
  return [{ text, conversation }, ...history.filter(e => !(e.text === text && e.conversation === conversation))].slice(0, limit);
}

/**
 * Pure: the recall order, newest first and without repeats. `sent` is this
 * conversation's own messages from its transcript (oldest first), so recall
 * works for a conversation sent from another window or device.
 */
export function recallOrder(history: readonly PromptEntry[], conversation: string, sent: readonly string[] = []): string[] {
  // What this window sent is newest; the transcript adds what was sent elsewhere.
  const own = history.filter(e => e.conversation === conversation).map(e => e.text).concat([...sent].reverse());
  const others = history.filter(e => e.conversation !== conversation).map(e => e.text);
  const seen = new Set<string>(), order: string[] = [];
  for (const text of [...own, ...others]) if (text.trim() && !seen.has(text)) { seen.add(text); order.push(text); }
  return order;
}

/** The caret is on the first (or last) line of the text, with nothing selected. */
export function caretOnFirstLine(text: string, start: number, end: number): boolean {
  return start === end && !text.slice(0, start).includes('\n');
}
export function caretOnLastLine(text: string, start: number, end: number): boolean {
  return start === end && !text.slice(end).includes('\n');
}

export function readPromptHistory(store?: ViewStateStore): PromptEntry[] {
  try { return parsePromptHistory(readPreference(store, key)); } catch { return []; }
}
export function savePrompt(store: ViewStateStore | undefined, text: string, conversation: string): void {
  try { writePreference(store, key, JSON.stringify(recordPrompt(readPromptHistory(store), text, conversation))); }
  catch { /* History is a convenience; a failed save never blocks sending. */ }
}
