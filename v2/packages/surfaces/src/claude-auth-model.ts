import type { ClaudeAuth } from '@lazybox/protocol';

/**
 * How Claude agents sign in, in words (CLAUDE_COMPLIANCE.md). Pure, so the
 * Settings row, onboarding and the tests say it the same way.
 */

/** Anthropic's official installer for Claude Code (code.claude.com/docs/en/setup). */
export const CLAUDE_INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash';

/** Where a person creates an Anthropic API key: the Claude Console. */
export const CLAUDE_KEYS_URL = 'https://platform.claude.com/';

const clouds: Record<string, string> = { bedrock: 'Amazon Bedrock', vertex: 'Google Cloud Vertex AI', foundry: 'Microsoft Foundry', 'anthropic-aws': 'Claude Platform on AWS' };

export type SignInLine = { title: string; detail: string; icon: string; tone: 'ok' | 'muted' | 'warn' };

/**
 * What the claude-default account's agents run on: the saved API key wins,
 * then a cloud provider the Runner's environment selects, else the person's
 * own Claude Code sign-in (the case Anthropic has not confirmed).
 */
export function claudeSignInLine(auth: Pick<ClaudeAuth, 'apiKeySet' | 'apiKeyHint' | 'cloudProvider'> | undefined): SignInLine {
  if (!auth) return { title: 'Checking…', detail: '', icon: 'pending', tone: 'muted' };
  if (auth.apiKeySet) return { title: `Anthropic API key ending ${auth.apiKeyHint}`, detail: 'The way Anthropic documents for apps built on its Agent SDK. Billed to your Claude Console account.', icon: 'check', tone: 'ok' };
  if (auth.cloudProvider) return { title: clouds[auth.cloudProvider] || auth.cloudProvider, detail: 'Selected by the Runner’s environment. Billed by your cloud provider.', icon: 'cloud', tone: 'ok' };
  return { title: 'Your Claude Code sign-in', detail: 'Whatever you signed in to Claude Code with, yourself. Anthropic has not confirmed that apps built on its Agent SDK may use it; an API key is the way it documents.', icon: 'alert', tone: 'warn' };
}

/** One-time notices the Runner raises (RunnerSettings.notices), in words. */
export const accountNotices: Record<string, { title: string; body: string; action: string; tab: 'extensions' | 'agents' }> = {
  'automatic-switching-moved': {
    title: 'Automatic switching moved to an extension',
    body: 'Lazybox no longer moves a conversation to another subscription by itself at a limit; you choose on the limit card. To switch automatically again, turn on Subscription rotation in Settings → Extensions.',
    action: 'Open Extensions', tab: 'extensions',
  },
  'claude-sign-in-gated': {
    title: 'Claude subscriptions saved in Lazybox are paused',
    body: 'Anthropic does not allow apps built on its Agent SDK to offer claude.ai sign-in without its approval. Use an Anthropic API key, or your own Claude Code sign-in; or turn Claude sign-in in Lazybox back on, at your own risk.',
    action: 'Open Claude settings', tab: 'agents',
  },
};

/** The notices to show: the ones this client knows, in the Runner's order. */
export const shownNotices = (ids: readonly string[] | undefined) => (ids || []).filter(id => accountNotices[id]);
