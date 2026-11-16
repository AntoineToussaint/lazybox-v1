// Voice (VOICE.md) against the fake Runner, with a fake speech engine in the
// page: a stand-in for the Web Speech API whose partial and final results the
// test says (window.__speech.say), and a speechSynthesis that records what it
// reads. Covers the live transcript in the message box, editing it, the send
// and cancel commands, Esc, hold and tap of ⌥Space, Vim mode, voice commands
// in the palette (with a confirmation), read-aloud, Settings → Voice, and a
// browser without speech recognition. No microphone and no model are used.
import { testViteCache } from './fixtures/vite-cache.mjs';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { webkit, chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startRunnerFixture } from './fixtures/runner-ui.mjs';

const f = await startRunnerFixture();
const now = Date.now(), ms = value => String(value);
const data = value => Buffer.from(JSON.stringify(value)).toString('base64');
const root = (status, updated) => [{ id: 'root', name: 'Main agent', status, updatedAtUnixMillis: ms(updated) }];
Object.assign(f.sessions[0], { title: 'Index the API', status: 'done', busy: false, agents: root('done', now - 60_000) });
Object.assign(f.sessions[1], { title: 'Ship release notes', status: 'waiting_input', agents: root('waiting_input', now - 300_000),
  pending: [{ type: 'question', requestId: 'q-release', providerDataJson: data({ questions: [{ question: 'Which version should the notes cover?' }] }) }] });
const step = s => ({ when: 'always', ...s });
f.power.setFile({ actions: [{ id: 'continue', title: 'Tell the agent to continue', icon: 'play', key: '', where: ['palette'], confirm: false, steps: [step({ kind: 'send', text: 'Continue.', to: 'current' })] }] });
const applied = text => f.mutations.some(m => m.method === 'Apply' && m.body.message?.text === text);
const sent = () => f.mutations.filter(m => m.method === 'Apply' && m.body.message).map(m => m.body.message.text);
const alpha = f.openEvents('alpha-session');
alpha.push({ type: 'operation_accepted', text: 'Index the API', turnId: 't0' });
alpha.push({ type: 'message_delta', text: 'Indexed.', turnId: 't0' });
alpha.push({ type: 'turn_ended', turnId: 't0' });

/** The fake speech engine: Web Speech's shape, driven by the test. */
function fakeSpeech({ recognition = true } = {}) {
  Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
  window.__spoken = [];
  const synth = {
    current: null,
    getVoices: () => [{ voiceURI: 'voice-en', name: 'Samantha', lang: 'en-US' }, { voiceURI: 'voice-fr', name: 'Thomas', lang: 'fr-FR' }],
    speak(u) { window.__spoken.push({ text: u.text, rate: u.rate, voice: u.voice?.voiceURI || '' }); this.current = u; },
    cancel() { const u = this.current; this.current = null; u?.onerror?.(); },
    addEventListener() {}, removeEventListener() {},
  };
  window.__finishSpeaking = () => { const u = synth.current; synth.current = null; u?.onend?.(); };
  window.__speaking = () => !!synth.current;
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.rate = 1; this.voice = null; this.lang = ''; this.onend = null; this.onerror = null; } };
  if (!recognition) { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true }); return; }
  const result = (text, final) => Object.assign([{ transcript: text }], { isFinal: final });
  class FakeRecognition {
    constructor() { this.results = []; this.lang = ''; this.ended = false; window.__speech.created++; }
    start() { window.__speech.active = this; window.__speech.lang = this.lang; }
    emit(index) { this.onresult?.({ resultIndex: index, results: this.results }); }
    finish() { if (this.ended) return; this.ended = true; if (window.__speech.active === this) window.__speech.active = null; this.onend?.(); }
    // The person stopped: it hears nothing more; what was still being recognized settles, then it ends.
    stop() { if (window.__speech.active === this) window.__speech.active = null; setTimeout(() => { const i = this.results.findIndex(r => !r.isFinal); if (i >= 0) { this.results[i] = result(this.results[i][0].transcript, true); this.emit(i); } this.finish(); }, 40); }
    // Aborted: it hears nothing more at once; its end follows.
    abort() { if (window.__speech.active === this) window.__speech.active = null; setTimeout(() => this.finish(), 0); }
  }
  window.__speech = {
    active: null, created: 0, lang: '',
    /** What the recognizer heard of the current stretch; `final` settles it and starts the next. */
    say(text, final = false) {
      const r = this.active; if (!r) throw new Error('nothing is listening');
      let i = r.results.findIndex(x => !x.isFinal); if (i < 0) i = r.results.length;
      r.results[i] = result(text, final); r.emit(i);
    },
  };
  window.SpeechRecognition = FakeRecognition; window.webkitSpeechRecognition = FakeRecognition;
}

const server = await createServer({ ...testViteCache(import.meta.url), configFile: false, logLevel: 'error', root: fileURLToPath(new URL('../apps/web', import.meta.url)), plugins: [react()], server: { host: '127.0.0.1', port: 0, proxy: { '/lazybox.bench.v1.RunnerService/': { target: f.url } } } });
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await (process.env.TEST_CHROMIUM ? chromium : webkit).launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(fakeSpeech);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${origin}/?view=workspace&collection=alpha&session=alpha-session#token=${f.token}`);
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  const pill = page.locator('.voice-pill');
  const live = page.locator('[data-dictation-live]');
  const say = (text, final = false) => page.evaluate(([t, fin]) => window.__speech.say(t, fin), [text, final]);
  const hold = async (key = 'Space', shift = false) => { await page.keyboard.down('Alt'); if (shift) await page.keyboard.down('Shift'); await page.keyboard.down(key); };
  const release = async (key = 'Space', shift = false) => { await page.waitForTimeout(450); await page.keyboard.up(key); if (shift) await page.keyboard.up('Shift'); await page.keyboard.up('Alt'); };
  const listening = () => expect.poll(() => page.evaluate(() => !!window.__speech.active)).toBe(true);
  await expect(message).toBeEnabled();

  // The mic is in the composer row; its tooltip names the key.
  const mic = page.getByRole('button', { name: 'Dictate', exact: true });
  await expect(mic).toBeVisible();
  await expect(mic).toHaveAttribute('title', /hold ⌥Space to talk/);

  // Hold ⌥Space: the pill shows, words appear live (marked) after what was typed, and settle on release.
  await message.fill('Note:');
  await hold();
  await expect(pill).toBeVisible();
  await expect(pill).toContainText('Listening');
  await expect(pill.locator('.voice-pill-dot')).toBeVisible();
  await expect(pill).toContainText('Online', { message: 'browser recognition is never called on-device unless the browser says so' });
  await listening();
  await say('fix the login');
  await expect(message).toHaveValue('Note: fix the login');
  await expect(live).toHaveText('fix the login');
  await expect(message).toHaveAttribute('aria-busy', 'true');
  await page.waitForTimeout(300); await page.screenshot({ path: '/tmp/lazybox-voice-live.png' });
  await say('fix the login bug', true);
  await expect(message).toHaveValue('Note: fix the login bug');
  await expect(live).toHaveCount(0);
  await say('in the API');
  await expect(live).toHaveText('in the API');
  await release();
  await expect(pill).toHaveCount(0);
  await expect(message).toHaveValue('Note: fix the login bug in the API');
  assert.deepEqual(sent(), [], 'dictation never sends by itself');
  // The result is ordinary text: edit it, then it is the draft.
  await message.press('End');
  await page.keyboard.type(' please');
  await expect(message).toHaveValue('Note: fix the login bug in the API please');

  // A quick tap keeps listening; "new line" goes on, "send" with sending by voice off only stops.
  await message.fill('');
  await page.keyboard.press('Alt+Space');
  await listening();
  await expect(pill).toContainText('⌥Space to finish');
  await say('first line new line', true);
  await say('second line send', true);
  await expect(pill).toHaveCount(0);
  await expect(message).toHaveValue('First line\nSecond line');
  await expect(page.locator('.toast').filter({ hasText: 'Press ↵ to send' })).toBeVisible();
  assert.deepEqual(sent(), []);

  // Esc cancels: the draft is back as it was. "Annule" does the same.
  await message.fill('Keep this');
  await hold();
  await listening();
  await say('and not this');
  await expect(message).toHaveValue('Keep this and not this');
  await page.keyboard.press('Escape');
  await expect(pill).toHaveCount(0);
  await expect(message).toHaveValue('Keep this');
  await page.keyboard.up('Space'); await page.keyboard.up('Alt');
  await page.keyboard.press('Alt+Space');
  await listening();
  await say('pas ça annule', true);
  await expect(pill).toHaveCount(0);
  await expect(message).toHaveValue('Keep this');

  // The pill's own buttons: Stop keeps the words, × cancels.
  await page.keyboard.press('Alt+Space');
  await listening();
  await say('kept by the button');
  await pill.getByRole('button', { name: 'Stop dictation' }).click();
  await expect(pill).toHaveCount(0);
  await expect(message).toHaveValue('Keep this kept by the button');
  await mic.click();
  await listening();
  await expect(page.getByRole('button', { name: 'Stop dictation', exact: true }).first()).toBeVisible();
  await say('dropped');
  await pill.getByRole('button', { name: 'Cancel dictation' }).click();
  await expect(message).toHaveValue('Keep this kept by the button');

  // Typing while listening takes over: the words stay, the microphone closes.
  await message.fill('');
  await page.keyboard.press('Alt+Space');
  await listening();
  await say('typed over');
  await page.keyboard.type('!');
  await expect(pill).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__speech.active)).toBe(null);
  await expect(message).toHaveValue('Typed over!');

  // Settings → Voice: engine, privacy, permissions, commands; turn on sending by voice.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Voice' }).click();
  const settings = page.locator('.voice-settings');
  await expect(settings.getByRole('heading', { name: 'Voice' })).toBeVisible();
  await expect(settings).toContainText('Browser speech recognition');
  await expect(settings.getByRole('note', { name: 'Privacy' })).toContainText('Your browser sends the audio to its speech service');
  await expect(settings.getByRole('note', { name: 'Privacy' })).not.toContainText('On-device');
  await expect(settings.getByRole('switch', { name: 'Send when I say “send”' })).not.toBeChecked();
  await settings.getByRole('switch', { name: 'Send when I say “send”' }).check();
  await expect(settings.getByLabel('Send', { exact: true })).toHaveValue('send, send it, envoie, envoyer, envoie-le');
  await settings.getByLabel('Language').selectOption('fr-FR');
  await page.screenshot({ path: '/tmp/lazybox-voice-settings.png', fullPage: true });
  // A new dictation key, recorded; a key you type is refused.
  const dictateRow = settings.locator('.settings-row', { hasText: 'Into the message box' });
  await dictateRow.getByRole('button', { name: 'Change…' }).click();
  await page.keyboard.press('v');
  await expect(dictateRow.getByRole('alert')).toContainText('needs one key held');
  await page.keyboard.press('Control+Alt+m');
  await expect(dictateRow.locator('kbd')).toHaveText(['⌃⌥M']);
  await dictateRow.getByRole('button', { name: 'Reset' }).click();
  await expect(dictateRow.locator('kbd')).toHaveText(['⌥Space']);
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button').first().click();

  // Saying "envoie" (in French now) sends: the message without the command word.
  await message.fill('');
  await page.keyboard.press('Alt+Space');
  await listening();
  assert.equal(await page.evaluate(() => window.__speech.lang), 'fr-FR');
  await say('corrige le test virgule puis relance envoie', true);
  await expect.poll(() => applied('Corrige le test, puis relance')).toBe(true);
  await expect(message).toHaveValue('');

  // Vim mode: dictation inserts in normal mode and Esc cancels it without leaving normal mode.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Shortcuts' }).click();
  await page.getByRole('switch', { name: 'Vim editing in the message box' }).check();
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button').first().click();
  await message.click();
  await page.keyboard.type('vim text');
  await page.keyboard.press('Escape');
  await expect(message).toHaveAttribute('data-vim-mode', 'normal');
  await page.keyboard.press('Alt+Space');
  await listening();
  await say('plus des mots');
  await page.keyboard.press('Escape');
  await expect(pill).toHaveCount(0);
  await expect(message).toHaveValue('vim text');
  await expect(message).toHaveAttribute('data-vim-mode', 'normal');
  await hold();
  await listening();
  await say('dicté', true);
  await release();
  await expect(message).toHaveValue('vim text dicté');
  await expect(message).toHaveAttribute('data-vim-mode', 'normal');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Shortcuts' }).click();
  await page.getByRole('switch', { name: 'Vim editing in the message box' }).uncheck();
  await page.getByRole('tab', { name: 'Voice' }).click();
  await settings.getByLabel('Language').selectOption('');
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button').first().click();

  // Voice commands: hold ⌥⇧Space, say it, release. A clear match runs.
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  const workspace = page.getByRole('combobox', { name: 'Workspace', exact: true });
  await page.locator('.workspace-brand').click();
  await hold('Space', true);
  await expect(palette).toBeVisible();
  await listening();
  await expect(pill).toContainText('Say a command');
  await say('next agent that needs me');
  await expect(search).toHaveValue('Next agent that needs me');
  await expect(palette.getByRole('option').first()).toContainText('Next conversation that needs you');
  await page.waitForTimeout(300); await page.screenshot({ path: '/tmp/lazybox-voice-palette.png' });
  await say('next agent that needs me', true);
  await release('Space', true);
  await expect(palette).toHaveCount(0);
  await expect(workspace).toHaveValue('beta');
  await expect(page.locator('.toast').filter({ hasText: 'Next conversation that needs you' })).toContainText('You said “Next agent that needs me”');
  // "switch to alpha" goes to the workspace.
  await hold('Space', true);
  await listening();
  await say('switch to alpha', true);
  await release('Space', true);
  await expect(workspace).toHaveValue('alpha');
  // Something vague stays in the palette for the person to pick.
  await hold('Space', true);
  await listening();
  await say('conversation', true);
  await release('Space', true);
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('status').filter({ hasText: 'Several things match' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  // The person's own action asks first; "yes" runs it.
  await hold('Space', true);
  await listening();
  await say('tell the agent to continue', true);
  await release('Space', true);
  await expect(palette.getByRole('status').filter({ hasText: 'Run “Tell the agent to continue”?' })).toBeVisible();
  assert.equal(applied('Continue.'), false, 'nothing runs before the yes');
  await hold('Space');
  await listening();
  await say('yes', true);
  await release('Space');
  await expect(palette).toHaveCount(0);
  await expect.poll(() => applied('Continue.')).toBe(true);
  // The mic in the palette works too, and Esc while listening cancels the voice, not the palette.
  await page.keyboard.press('Meta+k');
  await palette.getByRole('button', { name: 'Say a command' }).click();
  await listening();
  await say('open set');
  await page.keyboard.press('Escape');
  await expect(palette).toBeVisible();
  await expect(search).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);

  // Read aloud: the first paragraph of a reply that ends while the conversation is open; Esc stops it.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Voice' }).click();
  await settings.getByLabel('Agent replies').selectOption('summary');
  await settings.getByLabel('Voice', { exact: true }).selectOption('voice-fr');
  await settings.getByRole('button', { name: 'Play a sample' }).click();
  await expect.poll(() => page.evaluate(() => window.__spoken.at(-1))).toEqual({ text: 'Voici comment Lazybox lira les réponses de vos agents.', rate: 1, voice: 'voice-fr' });
  await page.evaluate(() => window.__finishSpeaking());
  await settings.getByLabel('Voice', { exact: true }).selectOption('');
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('button').first().click();
  await expect(message).toBeVisible();
  const spokenBefore = await page.evaluate(() => window.__spoken.length);
  alpha.push({ type: 'operation_accepted', text: 'Why is the login test flaky?', turnId: 't1' });
  alpha.push({ type: 'message_delta', text: '## Found it\n\nThe **login** test raced the `session` cache.\n\nI added a wait and ran it 50 times.', turnId: 't1' });
  alpha.push({ type: 'turn_ended', turnId: 't1' });
  await expect.poll(() => page.evaluate(() => window.__spoken.at(-1)?.text)).toBe('Found it. The login test raced the session cache.');
  assert.equal(await page.evaluate(() => window.__spoken.length), spokenBefore + 1, 'the replayed history is never read');
  await expect(page.locator('.voice-pill.is-reading')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.voice-pill.is-reading')).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__speaking()), false);
  // Never while dictating.
  await message.click();
  await page.keyboard.press('Alt+Space');
  await listening();
  alpha.push({ type: 'message_delta', text: 'Another reply.', turnId: 't2' });
  alpha.push({ type: 'turn_ended', turnId: 't2' });
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.__spoken.length), spokenBefore + 1);
  await page.keyboard.press('Escape');

  // The registry: palette entries and the shortcuts overlay list the voice actions with their keys.
  await page.keyboard.press('Meta+k');
  await search.fill('>dictate');
  await expect(palette.getByRole('option').first()).toContainText('Dictate');
  await expect(palette.getByRole('option').first().locator('kbd')).toHaveText(['⌥Space']);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);

  // A browser without speech recognition: no mic button, and Settings says what to use instead.
  const plain = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await plain.addInitScript(fakeSpeech, { recognition: false });
  const other = await plain.newPage();
  await other.goto(`${origin}/?view=workspace&collection=alpha&session=alpha-session#token=${f.token}`);
  await expect(other.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
  await expect(other.getByRole('button', { name: 'Dictate', exact: true })).toHaveCount(0);
  await other.getByRole('button', { name: 'Settings', exact: true }).click();
  await other.getByRole('tab', { name: 'Voice' }).click();
  await expect(other.locator('.voice-settings')).toContainText('This browser has no speech recognition');
  // ⌥Space says so instead of failing silently.
  await other.getByRole('navigation', { name: 'Pages' }).getByRole('button').first().click();
  await other.getByRole('textbox', { name: 'Message', exact: true }).click();
  await other.keyboard.press('Alt+Space');
  await expect(other.locator('.voice-pill.is-error')).toContainText('no speech recognition');
  await plain.close();
  console.log('voice: dictation, commands, palette, read-aloud and settings passed');
} finally {
  await browser?.close();
  await server.close();
  await f.close();
}
