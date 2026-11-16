import type { Profile, Session } from '@lazybox/protocol';

/**
 * Subscription limits in plain words. The Runner reports provider tokens
 * ("exhausted", "rate_limit", "provider_error"); nothing here shows one.
 */

/** Account states a switch of subscription (or a reset) resolves. */
export const LIMIT_STATES = ['exhausted', 'throttled', 'auth_required', 'billing_error'] as const;
export type LimitState = typeof LIMIT_STATES[number];
export const isLimitState = (state = ''): state is LimitState => (LIMIT_STATES as readonly string[]).includes(state);

const seconds = (value: bigint | number | undefined) => { const n = Number(value || 0); return Number.isFinite(n) && n > 0 ? n : 0; };

/** The limit a running conversation stopped at, or ''. */
export function sessionLimit(session?: Session): LimitState | '' {
  if (!session || session.closed) return '';
  return isLimitState(session.fault) ? session.fault : '';
}

/**
 * When a reset happens, as a person says it: "6:00 PM" today, "tomorrow 9:00 AM",
 * "Mon 6:00 PM" this week, else the date. '' for none, or one already passed.
 */
export function resetTime(resetAt: bigint | number | undefined, now = Date.now(), locale?: string): string {
  const at = seconds(resetAt) * 1000;
  if (!at || at <= now) return '';
  const date = new Date(at), today = new Date(now);
  const time = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(date) - day(today)) / 86400000);
  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${date.toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
  return `${date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** A subscription's name: its label, else the CLI sign-in the Runner inherited. */
export function subscriptionName(profile: Profile | undefined, id = ''): string {
  if (profile?.label) return profile.label;
  const provider = profile?.provider || (id.startsWith('codex') ? 'codex' : id.startsWith('claude') ? 'claude' : '');
  if (profile?.isolation === 'inherited' || id === 'claude-default' || id === 'codex-default') return `${provider === 'codex' ? 'Codex' : 'Claude'} CLI sign-in`;
  return id || 'This subscription';
}

/** The one sentence a stopped conversation leads with. */
export function limitHeadline(name: string, state: LimitState, resetAt: bigint | number | undefined, now = Date.now()): string {
  const reset = resetTime(resetAt, now);
  switch (state) {
    case 'exhausted': return `${name} reached its limit${reset ? ` (resets ${reset})` : ''}`;
    case 'throttled': return `${name} is rate limited${reset ? ` (try again at ${reset})` : ''}`;
    case 'auth_required': return `${name} needs you to sign in again`;
    case 'billing_error': return `${name} has a billing problem`;
  }
}

export type SubscriptionChoice = { id: string; name: string; ready: boolean; detail: string; resetAt: number; current: boolean };

/** Can this subscription take work now, as far as anyone has observed? */
function ready(profile: Profile, now: number): boolean {
  const state = profile.availability?.state || 'unknown';
  if (state === 'available' || state === 'unknown') return true;
  const reset = seconds(profile.availability?.resetAt) * 1000;
  return (state === 'exhausted' || state === 'throttled') && reset > 0 && reset <= now;
}

function detail(profile: Profile, now: number): string {
  const usage = profile.availability, state = usage?.state || 'unknown';
  if (ready(profile, now)) {
    const used = Math.max(-1, ...(usage?.windows || []).map(w => Number.isFinite(w.usedPercent) ? w.usedPercent : -1));
    const prefix = state === 'available' ? 'Available' : 'Ready';
    return used >= 0 ? `${prefix} · ${Math.round(used)}% used` : prefix;
  }
  const reset = resetTime(usage?.resetAt, now);
  switch (state) {
    case 'exhausted': return reset ? `Limit reached · resets ${reset}` : 'Limit reached';
    case 'throttled': return reset ? `Rate limited · try again at ${reset}` : 'Rate limited';
    case 'auth_required': return 'Sign-in required';
    case 'billing_error': return 'Billing issue';
    default: return 'Unavailable';
  }
}

/**
 * The subscriptions a conversation of `provider` can continue on, best first:
 * ready ones, then the soonest to reset. The current one is listed last, so a
 * picker can show it, and never counts as the best.
 */
export function subscriptionChoices(profiles: readonly Profile[], provider: string, currentId: string, now = Date.now()): SubscriptionChoice[] {
  const rows = profiles.filter(p => p.provider === provider).map(p => ({ id: p.id, name: subscriptionName(p, p.id), ready: ready(p, now), detail: detail(p, now), resetAt: seconds(p.availability?.resetAt), current: p.id === currentId, known: p.availability?.state === 'available' }));
  // Known to be available beats merely not known to be limited.
  const rank = (c: typeof rows[number]) => (c.current ? 3 : c.ready ? (c.known ? 0 : 1) : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.ready ? 0 : (a.resetAt || Infinity) - (b.resetAt || Infinity)) || a.name.localeCompare(b.name)).map(({ known: _, ...choice }) => choice);
}

/** The subscription "Continue with …" offers: the best other one that is ready. */
export function bestChoice(choices: readonly SubscriptionChoice[]): SubscriptionChoice | undefined {
  return choices.find(c => !c.current && c.ready);
}

/** A switch as the Runner journaled it (profile_changed). */
export type SwitchNote = { from: string; to: string; mode: string; requested: boolean; fromState: string; resetAt: number };

export function switchNote(to: string, mode: string, data: Record<string, unknown>): SwitchNote {
  return { to, mode, from: typeof data.from === 'string' ? data.from : '', requested: data.requested === true, fromState: typeof data.fromState === 'string' ? data.fromState : '', resetAt: seconds(typeof data.resetAt === 'number' ? data.resetAt : 0) };
}

/** The one quiet line a switch leaves in the conversation. */
export function switchedLine(note: SwitchNote, nameFor: (id: string) => string, now = Date.now()): string {
  if (note.mode === 'retry_same_profile') return `Continued on ${nameFor(note.to)}`;
  const line = `Switched to ${nameFor(note.to)}`;
  if (!note.from || note.from === note.to || !isLimitState(note.fromState)) return line;
  const reset = resetTime(note.resetAt, now), from = nameFor(note.from);
  if (reset && (note.fromState === 'exhausted' || note.fromState === 'throttled')) return `${line} · ${from} resets at ${reset}`;
  return `${line} · ${from} ${note.fromState === 'auth_required' ? 'needs sign-in' : note.fromState === 'billing_error' ? 'has a billing problem' : 'reached its limit'}`;
}

const looksLikeCode = (text: string) => /^[a-z0-9_.:-]+$/i.test(text.trim());
const codeSentences: Record<string, string> = {
  rate_limit: 'The provider is limiting requests right now.',
  context_full: 'The conversation no longer fits in the model’s context window. Start a new conversation to continue.',
  context_length_exceeded: 'The conversation no longer fits in the model’s context window. Start a new conversation to continue.',
  budget_exceeded: 'This conversation reached its turn or spending limit.',
  error_max_turns: 'This conversation reached its turn limit.',
  error_max_budget_usd: 'This conversation reached its spending limit.',
  provider_process_exit: 'The agent process stopped unexpectedly.',
  delivery_failed: 'Your message could not be delivered to the agent.',
  account_state_write_failed: 'Lazybox could not save the subscription status.',
  authentication_failed: 'The subscription needs you to sign in again.',
  billing_error: 'The subscription has a billing problem.',
  overloaded_error: 'The provider is overloaded. Try again in a moment.',
  native_exit_unconfirmed: 'Lazybox could not confirm that the agent process stopped.',
};

/** A failure the agent reported, as a sentence. Provider prose is kept; bare codes are translated. */
export function failureSentence(status = '', text = ''): string {
  const body = text.trim();
  if (body && !looksLikeCode(body)) return body;
  return codeSentences[body] || codeSentences[status] || 'The agent stopped after an error from the provider.';
}

/**
 * A fault from the provider ending one turn with an error (an API error, an
 * image it could not read). The conversation is intact and the next message
 * continues it. Mirrors agent.TurnFault in the Runner.
 */
export function turnFault(fault = ''): boolean {
  if (!fault || isLimitState(fault)) return false;
  return !['provider delivery failed', 'event capture failed', 'provider stream ended', 'invalid or excessive pending provider requests', 'native_exit_unconfirmed', 'provider startup failed'].some(prefix => fault.startsWith(prefix));
}

/** Why a conversation needs attention, for a fault that is not a subscription limit. */
export function faultSentence(fault: string): string {
  if (!fault) return '';
  if (fault === 'provider delivery failed; reconcile before continuing') return 'A message could not be delivered to the agent. Check the conversation before sending again.';
  if (fault.startsWith('provider stream ended')) return 'The connection to the agent ended unexpectedly.';
  if (fault.startsWith('event capture failed')) return 'Lazybox could not record this conversation, so the agent was stopped.';
  if (fault === 'provider_failure' || fault === 'provider_error' || fault === 'sdk_error') return 'The agent stopped after an error from the provider.';
  if (looksLikeCode(fault)) return codeSentences[fault] || `The agent stopped (${fault.replaceAll('_', ' ')}).`;
  return fault;
}

/** The header's words for a conversation at a limit, or undefined. */
export function limitStatus(session: Session | undefined, now = Date.now()): string | undefined {
  if (!session || session.closed) return undefined;
  if (session.status === 'switching_profile') return isLimitState(session.account?.state) ? 'Limit reached · switching' : undefined;
  const limit = sessionLimit(session);
  if (!limit) return undefined;
  if (limit === 'auth_required') return 'Sign-in required';
  if (limit === 'billing_error') return 'Billing issue';
  const reset = resetTime(session.account?.resetAt, now);
  return reset ? `Waiting for reset ${reset}` : 'Limit reached';
}
