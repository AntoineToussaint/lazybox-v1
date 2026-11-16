// Docs screenshots: the images in docs/images/, taken from the real web client
// against the explicitly fake Runner (scripts/fixtures/runner-ui.mjs), so they
// are reproducible on any machine without credentials, Git or a model.
//
//   npm run docs:screenshots            # every image
//   npm run docs:screenshots hero inbox # only these (names without .webp)
//
// Each shot gets a fresh fake Runner and a fresh browser context, sets up the
// fixture state the matching scripts/test-*.mjs suite uses, and writes a WebP
// (encoded by Chromium itself: no image tools needed). Dark, the default
// theme, except the shots marked `colorScheme: 'light'` (the app follows the
// system's appearance by default). Shots run one at a time in one browser.
import { createServer as createHttpServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, devices, expect } from '@playwright/test';
import { startRunnerFixture, defaultModelPrices } from './fixtures/runner-ui.mjs';
import { testViteCache } from './fixtures/vite-cache.mjs';

const out = fileURLToPath(new URL('../docs/images/', import.meta.url));
const desktop = { width: 1440, height: 900 }, phone = { width: 390, height: 844 };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64');

// Every shot has its own fake Runner; one Vite server forwards to the current one.
let target = '';
const forwarder = createHttpServer((req, res) => {
  const upstream = new URL(target);
  const proxied = request({ host: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers: req.headers }, answer => { res.writeHead(answer.statusCode, answer.headers); answer.pipe(res); });
  proxied.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(proxied);
});
await new Promise(resolve => forwarder.listen(0, '127.0.0.1', resolve));
const forwarderUrl = `http://127.0.0.1:${forwarder.address().port}`;

// A small documentation site for the Web panel to show (the fixture's own page is bare).
const handbook = createHttpServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>Response cache · API handbook</title>
<style>body{font:15px/1.6 -apple-system,system-ui,sans-serif;margin:0;color:#1f2328;background:#fff}header{padding:14px 28px;border-bottom:1px solid #d0d7de;font-weight:600}main{max-width:640px;padding:8px 28px}code{background:#f6f8fa;padding:1px 5px;border-radius:4px;font-size:13px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d0d7de;padding:6px 10px;text-align:left;font-size:14px}</style>
<header>Acme API handbook</header><main><h1>Response cache</h1><p>The API keeps <code>GET</code> responses in memory for a short time, so repeated reads do not reach the database.</p>
<h2>Settings</h2><table><tr><th>Variable</th><th>Default</th><th>Meaning</th></tr><tr><td><code>CACHE_TTL_SECONDS</code></td><td>300</td><td>How long an entry stays fresh</td></tr><tr><td><code>CACHE_MAX_ENTRIES</code></td><td>1000</td><td>Oldest entries are evicted beyond this</td></tr></table>
<h2>Bypass</h2><p>Requests with a session cookie are never cached.</p></main>`);
});
await new Promise(resolve => handbook.listen(0, '127.0.0.1', resolve));
const site = `http://127.0.0.1:${handbook.address().port}`;

// Stills, not motion: no transitions, animations or blinking carets.
const still = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';

const shots = {};
const shot = (name, run, options = {}) => { shots[name] = { run, ...options }; };

// ---- The shots ------------------------------------------------------------

/** A conversation's journal, written the way the Runner records it. */
function journal(f, sessionId, start = Date.now() - 12 * 60_000, fields = {}) {
  const channel = f.openEvents(sessionId);
  let clock = start;
  const push = (event, seconds = 1) => channel.push({ ...fields, ...event }, new Date(clock += seconds * 1000).toISOString());
  const tool = (id, fields, seconds = 1) => push({ type: 'tool_activity', providerDataJson: b64({ type: 'tool_call', id, ...fields }) }, seconds);
  const done = (id, output = 'ok', seconds = 1) => tool(id, { status: 'completed', output }, seconds);
  return { channel, push, tool, done,
    prompt: (text, operationId) => push({ type: 'operation_accepted', text, ...(operationId ? { operationId } : {}) }),
    say: text => push({ type: 'message_delta', text }),
    end: () => push({ type: 'turn_ended' }),
    plan: (id, todos) => tool(id, { name: 'TodoWrite', status: 'completed', input: { todos }, output: 'ok' }) };
}
/** Realistic names for the fixture's two workspaces and their conversations. */
function realistic(f) {
  f.collections[0].name = 'Response cache'; f.collections[1].name = 'Release 2.4';
  Object.assign(f.sessions[0], { title: 'Add a response cache', provider: 'claude', model: 'claude-opus-5', modelReported: true, instructionsPending: false, status: 'ready', busy: false, agents: [{ id: 'root', status: 'done' }] });
  Object.assign(f.sessions[1], { title: 'Prepare the 2.4 release notes', provider: 'codex', model: 'gpt-5.4', modelReported: true, instructionsPending: false });
}
const CACHE_DIFF = `diff --git a/src/cache.ts b/src/cache.ts
index 1111111..2222222 100644
--- a/src/cache.ts
+++ b/src/cache.ts
@@ -1,12 +1,18 @@
 import { createClient } from './db';

-const ttl = 60;
+const ttl = 300;
+const max = 1000;

 export function createCache() {
   const entries = new Map<string, Entry>();
   return {
     get(key: string) {
-      return entries.get(key)?.value;
+      const entry = entries.get(key);
+      if (!entry || entry.expires < Date.now()) return undefined;
+      return entry.value;
     },
     set(key: string, value: unknown) {
+      if (entries.size >= max) entries.delete(entries.keys().next().value);
       entries.set(key, { value, expires: Date.now() + ttl * 1000 });
     },
   };
`;
/** The cache work: a finished turn with reads, edits, a plan and passing tests. */
function cacheTranscript(f, { finished = true } = {}) {
  const root = f.sessions[0].workingDirectory;
  const j = journal(f, 'alpha-session');
  j.prompt('Add a cache in front of the API responses: entries expire after five minutes, at most 1,000 of them. Add tests.', 'op-1');
  j.say('I’ll read how responses are served today, then add the cache with an expiry and a size limit, and test both.');
  j.plan('plan-1', [{ content: 'Read the response path', status: 'in_progress' }, { content: 'Add expiry and a size limit', status: 'pending' }, { content: 'Test expiry and eviction', status: 'pending' }]);
  for (const [i, file] of ['src/cache.ts', 'src/db.ts', 'src/routes.ts', 'README.md'].entries()) j.tool(`read-${i}`, { name: 'Read', status: 'running', input: { file_path: `${root}/api/${file}` } });
  j.tool('grep-1', { name: 'Grep', status: 'running', input: { pattern: 'createCache', path: `${root}/api` } });
  for (const id of ['read-0', 'read-1', 'read-2', 'read-3', 'grep-1']) j.done(id, 'line one\nline two\n');
  j.plan('plan-2', [{ content: 'Read the response path', status: 'completed' }, { content: 'Add expiry and a size limit', status: 'in_progress' }, { content: 'Test expiry and eviction', status: 'pending' }]);
  j.tool('edit-1', { name: 'Edit', status: 'running', input: { file_path: `${root}/api/src/cache.ts`, old_string: 'const ttl = 60;', new_string: 'const ttl = 300;\nconst max = 1000;' } });
  j.done('edit-1');
  j.tool('edit-2', { name: 'Write', status: 'running', input: { file_path: `${root}/api/src/cache.test.ts`, content: 'test("entries expire")' } });
  j.done('edit-2');
  j.plan('plan-3', [{ content: 'Read the response path', status: 'completed' }, { content: 'Add expiry and a size limit', status: 'completed' }, { content: 'Test expiry and eviction', status: finished ? 'completed' : 'in_progress' }]);
  j.tool('test', { name: 'Bash', status: 'running', input: { command: 'npm test -- cache', description: 'Run the cache tests' } });
  if (finished) {
    j.done('test', '\u001b[32m✓ 6 tests passed\u001b[0m\n', 4);
    j.say('Done. `createCache` now drops entries after 300 s and evicts the oldest once it holds 1,000. Six tests cover expiry, eviction and a cache miss; they pass.');
    j.end();
  }
  return j;
}
function cacheChanges(f) {
  const api = f.shipState('alpha', 'api');
  api.files = [{ path: 'src/cache.ts', indexStatus: ' ', worktreeStatus: 'M' }, { path: 'src/cache.test.ts', indexStatus: '?', worktreeStatus: '?' }];
  f.diffs.set('alpha/api/src/cache.ts', CACHE_DIFF);
  return api;
}

const ms = value => String(value);
const mainAgent = (status, updated, extra = {}) => [{ id: 'root', name: 'Main agent', status, updatedAtUnixMillis: ms(updated), ...extra }];
const question = (id, text) => ({ type: 'question', requestId: id, providerDataJson: b64({ questions: [{ question: text }] }) });
const approval = (id, command, always = []) => ({ type: 'approval', requestId: id, text: 'Bash', providerDataJson: b64({ tool: 'Bash', toolUseId: `use-${id}`, input: { command, description: `Run ${command.split(' ')[0]}` }, always }) });
/** Several agents across both workspaces, each in a different state. */
function fleet(f) {
  realistic(f);
  const now = Date.now(), base = { profileId: 'claude-default', provider: 'claude', capabilities: { files: true }, pending: [], instructionsPending: false };
  Object.assign(f.sessions[1], { status: 'waiting_input', agents: mainAgent('waiting_input', now - 300_000), pending: [question('q-release', 'Which version should the notes start from?')] });
  f.sessions.push(
    { ...base, id: 'deps-session', collectionId: 'beta', workId: 'beta', title: 'Bump dependencies', model: 'claude-sonnet-5', modelReported: true, status: 'waiting_approval', createdAtUnixMillis: ms(now - 5_000_000), agents: mainAgent('waiting_approval', now - 30_000), pending: [approval('a-deps', 'npm update')] },
    { ...base, id: 'parser-session', collectionId: 'alpha', workId: 'alpha', title: 'Split the parser', model: 'claude-opus-5', modelReported: true, status: 'done', createdAtUnixMillis: ms(now - 3_600_000), agents: mainAgent('done', now - 60_000, { turnEndedAtUnixMillis: ms(now - 60_000), lastTurnStatus: 'completed' }), lastMessage: 'I split the parser into three files.\n\n**All 42 tests pass.**' },
    { ...base, id: 'preview-session', collectionId: 'beta', workId: 'beta', title: 'Deploy the preview', model: 'claude-sonnet-5', modelReported: true, status: 'failed', fault: 'provider delivery failed; reconcile before continuing', createdAtUnixMillis: ms(now - 7_200_000), agents: mainAgent('failed', now - 20_000) },
  );
}
const PLAN = `# Response cache

Cache API responses in memory, in front of the database.

## Decisions
- **Expiry:** 300 s, the longest any endpoint tolerates stale data.
- **Size:** at most 1,000 entries; the oldest is evicted first.
- **Scope:** \`GET\` routes only; anything with a session cookie bypasses it.

## Steps
1. Add expiry and a size limit to \`createCache\`.
2. Wire it into \`routes.ts\` for the read endpoints.
3. Test expiry, eviction and a miss.
4. Measure: p95 of \`/products\` before and after.
`;

shot('hero', async ({ f, open }) => {
  fleet(f); cacheTranscript(f);
  Object.assign(f.sessions[0], { status: 'ready', busy: false, agents: [{ id: 'root', status: 'done' }] });
  f.setCheckpoints('alpha-session', { turns: [{ operationId: 'op-1', prompt: 'Add a cache', files: [{ member: 'api', path: 'src/cache.ts', status: 'M', additions: 6, deletions: 1 }, { member: 'api', path: 'src/cache.test.ts', status: 'A', additions: 58 }] }] });
  f.artifacts.agentPut({ collectionId: 'alpha', sessionId: 'alpha-session', title: 'Response cache', kind: 'plan', content: PLAN });
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await expect(page.locator('.messages')).toContainText('Six tests cover');
  await showPanel(page, 'Artifacts');
  await page.getByRole('listbox', { name: 'Artifacts' }).getByRole('option').first().click();
  await expect(page.locator('.panel-artifacts')).toContainText('Decisions');
  return page;
});

// The same page in the Light theme: the app follows the system's light mode.
shot('hero-light', (...args) => shots.hero.run(...args), { colorScheme: 'light' });

shot('appearance', async ({ f, open }) => {
  realistic(f); cacheTranscript(f);
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Appearance' })).toBeVisible();
  await page.waitForTimeout(400);
  return page;
}, { colorScheme: 'light' });

shot('changes-review', async ({ f, open }) => {
  realistic(f); cacheTranscript(f); cacheChanges(f);
  Object.assign(f.sessions[0], { status: 'ready', busy: false, agents: [{ id: 'root', status: 'done' }] });
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await expect(page.locator('.messages')).toContainText('Six tests cover');
  const changes = await openChanges(page);
  await changes.getByRole('group', { name: 'Diff layout' }).getByRole('button', { name: 'Split' }).click();
  await comment(page, changes, 'Comment on line 4', 'Make the limit configurable, with 1000 as the default.');
  await comment(page, changes, 'Comment on line 10', 'An expired entry is still in the map: delete it here too.');
  await expect(changes.getByRole('complementary', { name: 'Review' })).toContainText('2 pending');
  return page;
});

shot('chat-decisions', async ({ f, open }) => {
  realistic(f);
  const session = f.sessions[0];
  Object.assign(session, { busy: true, status: 'waiting_input', agents: [{ id: 'root', status: 'running' }] });
  const ask = { type: 'question', requestId: 'question-1', text: 'AskUserQuestion', providerDataJson: b64({ tool: 'AskUserQuestion', toolUseId: 'ask-1', input: { questions: [
    { question: 'Where should the cache keep its entries?', header: 'Storage', multiSelect: false, options: [{ label: 'In memory', description: 'Fastest; lost on restart' }, { label: 'SQLite', description: 'One file beside the API' }, { label: 'Redis', description: 'Shared by every API instance' }] },
  ] } }) };
  session.pending = [ask];
  const j = journal(f, 'alpha-session');
  j.prompt('Add a cache in front of the API responses, with tests.');
  j.say('Before I start, one choice only you can make.');
  j.push(ask);
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  const card = page.locator('.request.question-card');
  await expect(card.getByRole('radiogroup', { name: 'Where should the cache keep its entries?' })).toBeVisible();
  await page.keyboard.press('1');
  await page.evaluate(() => document.activeElement?.blur());
  return page;
});

shot('checkpoints', async ({ f, open }) => {
  realistic(f);
  const session = f.sessions[0];
  Object.assign(session, { busy: false, status: 'ready', agents: [{ id: 'root', status: 'done' }] });
  const j = journal(f, 'alpha-session');
  const turn = (id, prompt, reply) => { j.push({ type: 'operation_accepted', operationId: id, text: prompt }); j.say(reply); j.end(); };
  turn('op-1', 'Add a parser for the cache settings file.', 'Added `parseSettings` in `settings.go`, with the defaults documented in the README.');
  turn('op-2', 'Add tests for it.', 'Added `settings.test.ts`: twelve cases, including a missing file and a bad TTL. They pass.');
  turn('op-3', 'Now document the settings.', '`docs/settings.md` now has one section per setting, with its default.');
  const state = f.setCheckpoints(session.id, { turns: [
    { operationId: 'op-1', prompt: 'Add a parser', files: [{ member: 'api', path: 'settings.go', status: 'A', additions: 40 }, { member: 'api', path: 'README.md', status: 'M', additions: 2, deletions: 1 }] },
    { operationId: 'op-2', prompt: 'Add tests for it', files: [{ member: 'web', path: 'settings.test.ts', status: 'A', additions: 12 }] },
    { operationId: 'op-3', prompt: 'Now document the settings', files: [{ member: 'api', path: 'docs/settings.md', status: 'A', additions: 18 }] },
  ] });
  state.commitsSince = { api: 1 };
  const page = await open(`/?view=workspace&collection=alpha&session=${session.id}`);
  const marker = page.locator('.messages').getByRole('group', { name: 'Turn 1 checkpoint' });
  await expect(marker).toContainText('Turn 1 · 2 files changed');
  await marker.getByLabel('Turn 1 actions', { exact: true }).click();
  await marker.getByRole('button', { name: 'Revert to before this turn…' }).click();
  await expect(page.getByRole('dialog', { name: 'Revert files to before turn 1' })).toContainText('files will change');
  return page;
});

shot('pr-loop', async ({ f, open }) => {
  realistic(f); cacheTranscript(f);
  const api = f.shipState('alpha', 'api');
  Object.assign(api, { githubRepository: 'acme/api', upstream: 'origin/' + api.branch, ahead: 0, files: [],
    commits: [{ id: api.head, subject: 'Cache API responses for five minutes', committedAtUnix: String(Math.floor(Date.now() / 1000) - 600) }],
    committed: [{ path: 'src/cache.ts', indexStatus: 'M' }, { path: 'src/cache.test.ts', indexStatus: 'A' }] });
  api.pr = { number: '42', title: 'Cache API responses for five minutes', body: '', url: 'https://github.com/acme/api/pull/42', state: 'open', draft: false, base: 'main', headSha: api.head, mergeableState: 'unstable', reviewDecision: 'approved', checksState: 'failure', author: 'you',
    checks: [{ name: 'test', status: 'completed', conclusion: 'failure', url: 'https://github.com/acme/api/actions/runs/41/job/1', summary: '1 test failed: cache evicts the oldest entry' }, { name: 'lint', status: 'completed', conclusion: 'success', url: 'https://github.com/acme/api/actions/runs/41/job/2' }, { name: 'build', status: 'completed', conclusion: 'success', url: 'https://github.com/acme/api/actions/runs/40' }, { name: 'e2e', status: 'in_progress', conclusion: '', url: '' }] };
  f.diffs.set('alpha/api/src/cache.ts', CACHE_DIFF);
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  const card = page.getByRole('region', { name: 'Workspace changes' }).getByRole('region', { name: 'Pull request #42' });
  await expect(card).toContainText('1 failing');
  return page;
});

shot('workspace-runtime', async ({ f, open }) => {
  realistic(f); cacheTranscript(f);
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  const run = page.getByRole('group', { name: 'Run', exact: true });
  await run.getByRole('button', { name: 'Run dev', exact: true }).click();
  await expect(run.getByRole('button', { name: 'Stop dev', exact: true })).toBeEnabled();
  await run.getByLabel('More actions', { exact: true }).click();
  await page.getByRole('group', { name: 'More actions menu', exact: true }).getByRole('button', { name: 'Show actions and logs', exact: true }).click();
  const actions = page.getByRole('region', { name: 'Workspace actions', exact: true });
  const dev = actions.getByRole('listitem', { name: 'dev, Running' });
  await expect(dev).toBeVisible();
  await page.getByRole('button', { name: 'Close Command output panel', exact: true }).click();
  await drag(page, page.getByRole('separator', { name: 'Resize split 1' }), { y: 400 });
  await page.waitForTimeout(1200);
  return page;
});

shot('web-panel', async ({ f, open }) => {
  realistic(f);
  const j = journal(f, 'alpha-session');
  j.prompt('Where are the cache settings documented?');
  j.say(`In [the API handbook](${site}/handbook/cache): \`CACHE_TTL_SECONDS\` and \`CACHE_MAX_ENTRIES\`, with their defaults.`);
  j.end();
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  const link = page.locator('.panel-chat').getByRole('link', { name: 'the API handbook' });
  await link.click({ modifiers: ['Alt'] });
  const frame = page.locator('.panel-web').first().frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Response cache' })).toBeVisible();
  return page;
});

shot('missions', async ({ f, open }) => {
  fleet(f); cacheTranscript(f);
  const { missions } = f;
  const m = missions.create('Ship the response cache', 'Cache GET responses for five minutes; measure the effect on /products.');
  const read = missions.addTask(m, 'Read the response path', 'Objective: know every read endpoint\nDone when: listed in the plan');
  const add = missions.addTask(m, 'Add the cache', 'Objective: expiry and a size limit\nDone when: tests and CI pass');
  const docs = missions.addTask(m, 'Document the cache settings', 'Objective: one section per setting\nDone when: reviewed');
  missions.addTask(m, 'Remove the old memo layer', '', [add.id]);
  missions.addTask(m, 'Benchmark /products', 'Objective: p95 before and after\nDone when: numbers in the PR');
  const alpha = f.sessions[0], beta = f.sessions[1], parser = f.sessions.find(s => s.id === 'parser-session');
  missions.assign(m, read, parser, false);
  missions.handle('UpdateMission', { missionId: m.id, report: { taskId: read.id, summary: 'Six read endpoints, listed in the plan.' } });
  missions.handle('UpdateMission', { missionId: m.id, accept: { taskId: read.id } });
  missions.assign(m, add, alpha, false);
  missions.recordRun(alpha.id, { title: 'npm test', exitCode: 0 });
  missions.recordPullRequest('alpha', { number: 42, head: 'a1b2c3d', outcome: 'pass', repository: 'acme/api' });
  missions.handle('UpdateMission', { missionId: m.id, report: { taskId: add.id, summary: 'Expiry and eviction in createCache; six tests.' } });
  missions.assign(m, docs, beta, false);
  missions.recordRun(beta.id, { title: 'npm run docs:check', exitCode: 1 });
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await showPanel(page, 'Missions');
  const panel = page.getByRole('region', { name: 'Missions and tasks', exact: true });
  await expect(panel.getByRole('heading', { name: 'Ship the response cache' })).toBeVisible();
  await page.getByLabel('Missions panel actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Dock bottom', exact: true }).click();
  await page.getByRole('button', { name: 'Close Command output panel', exact: true }).click();
  await drag(page, page.getByRole('separator', { name: 'Resize split 1' }), { y: 330 });
  await page.waitForTimeout(500);
  await focusPanel(page);
  return page;
});

shot('inbox', async ({ f, open }) => {
  fleet(f); cacheTranscript(f);
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await expect(page.locator('.inbox-action')).toHaveAccessibleName(/need/);
  await page.locator('.inbox-action').click();
  await expect(page.getByRole('dialog', { name: 'Inbox' }).locator('.inbox-item').first()).toBeVisible();
  return page;
});

shot('command-palette', async ({ f, open }) => {
  fleet(f); cacheTranscript(f);
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await expect(page.locator('.messages')).toContainText('Six tests cover');
  await page.locator('[data-agent-composer]').focus();
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('review');
  await expect(palette.getByRole('option').first()).toBeVisible();
  return page;
});

shot('shortcuts', async ({ f, open }) => {
  fleet(f); cacheTranscript(f);
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await page.locator('.workspace-brand').click();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  return page;
});

shot('subagents', async ({ f, open }) => {
  realistic(f);
  const now = Date.now(), at = offset => new Date(now + offset).toISOString();
  const A = 'claude-tool:toolu_explore', B = 'claude-tool:toolu_audit', D = 'claude-tool:toolu_bench';
  Object.assign(f.sessions[0], { title: 'Find what slows /products', busy: true, status: 'running', capabilities: { ...f.sessions[0].capabilities, stopAgent: true },
    agents: [{ id: 'root', status: 'running', phase: 'thinking', phaseSinceUnixMillis: String(now - 4000), turnStartedAtUnixMillis: String(now - 300000) },
      ...[[A, 'running'], [B, 'running'], [D, 'done']].map(([id, status]) => ({ id, parentId: 'root', status, name: 'Sub-agent', kind: 'local_agent' }))] });
  const ch = f.openEvents('alpha-session');
  const push = (offset, event) => ch.push(event.data === undefined ? event : { ...Object.fromEntries(Object.entries(event).filter(([k]) => k !== 'data')), providerDataJson: b64(event.data) }, at(offset));
  const call = (id, name, status, extra = {}) => ({ type: 'tool_call', id, name, status, ...extra });
  const spawn = (offset, id, toolUse, description, type, prompt) => {
    push(offset, { type: 'tool_activity', data: call(toolUse, 'Task', 'running', { input: { description, prompt, subagent_type: type } }) });
    push(offset + 200, { type: 'agent_status', agentId: id, parentAgentId: 'root', nativeId: 'task-' + toolUse, status: 'running', name: description, agentKind: 'local_agent', data: { toolUseId: toolUse, subagentType: type, prompt } });
  };
  push(-300000, { type: 'operation_accepted', text: '/products got slow this week. Find out why, in parallel where you can.' });
  push(-299000, { type: 'turn_started' });
  push(-298000, { type: 'message_delta', text: 'I’ll split this three ways: one agent reads the query path, one audits this week’s commits, and one benchmarks the endpoint.' });
  spawn(-290000, D, 'toolu_bench', 'Benchmark /products', 'general-purpose', 'Measure p50 and p95 of GET /products, 200 requests.');
  for (let i = 0; i < 12; i++) { push(-289000 + i * 500, { type: 'tool_activity', agentId: D, data: call('d' + i, 'Bash', 'running', { input: { command: `curl -s -o /dev/null -w '%{time_total}' localhost:20000/products` } }) }); push(-288800 + i * 500, { type: 'tool_activity', agentId: D, data: call('d' + i, undefined, 'completed', { output: '0.41' }) }); }
  push(-200000, { type: 'tool_activity', data: { type: 'tool_call', id: 'toolu_bench', status: 'completed', output: [{ type: 'text', text: 'p50 410 ms, p95 1.9 s (last week: p95 220 ms).' }] } });
  push(-199990, { type: 'agent_status', agentId: D, status: 'done', data: { toolUseId: 'toolu_bench', summary: 'p95 went from 220 ms to 1.9 s', usage: { totalTokens: 21000, toolUses: 12, durationMs: 90000 } } });
  spawn(-95000, A, 'toolu_explore', 'Trace the query path', 'Explore', 'Trace GET /products from the route to the database.');
  push(-90000, { type: 'tool_activity', agentId: A, data: call('a1', 'Grep', 'running', { input: { pattern: 'listProducts', path: 'api/src' } }) });
  push(-89000, { type: 'tool_activity', agentId: A, data: call('a1', undefined, 'completed', { output: 'routes.ts:31: router.get("/products", listProducts)' }) });
  push(-88000, { type: 'message_delta', agentId: A, parentAgentId: 'root', text: 'listProducts now loads every variant per product: one query each.' });
  push(-8000, { type: 'tool_activity', agentId: A, data: call('a2', 'Read', 'running', { input: { file_path: 'api/src/products.ts' } }) });
  push(-5000, { type: 'agent_status', agentId: A, status: 'running', data: { toolUseId: 'toolu_explore', usage: { totalTokens: 48200, toolUses: 14, durationMs: 90000 }, summary: 'Reading products.ts' } });
  spawn(-60000, B, 'toolu_audit', 'Audit this week’s commits', 'general-purpose', 'List this week’s commits that touch the products query.');
  push(-50000, { type: 'tool_activity', agentId: B, data: call('b1', 'Bash', 'running', { input: { command: 'git log --since=7.days --oneline -- api/src/products.ts', description: 'List recent commits' } }) });
  push(-4000, { type: 'activity', status: 'thinking' });
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await expect(page.locator('.messages')).toContainText('Trace the query path');
  return page;
});

shot('activity-detail', async ({ f, open }) => {
  realistic(f);
  const session = f.sessions[0];
  Object.assign(session, { title: 'Why can’t the owner read the runtime?', busy: true, status: 'running', agents: [{ id: 'root', status: 'running' }] });
  const root = session.workingDirectory;
  const j = journal(f, 'alpha-session', Date.now() - 10 * 60_000, { turnId: 't1' });
  const tool = (id, fields, seconds = 0) => j.push({ type: 'tool_activity', turnId: 't1', providerDataJson: b64({ type: 'tool_call', id, ...fields }) }, seconds);
  j.prompt('Why can’t the owner read their own runtime?');
  j.say('I’ll trace how the runtime resolves access.');
  ['runtime_access.go', 'policy.go', 'owner.go', 'session.go', 'grants.go', 'store.go', 'handler.go', 'errors.go'].forEach((file, i) => {
    j.push({ type: 'activity', status: 'thinking' }, 2);
    tool(`sh-${i}`, { name: 'Bash', status: 'running', input: { command: `sed -n '1,200p' internal/runtime/${file}`, ...(i === 0 ? { description: 'Read the access check' } : {}) } }, 1.4);
    tool(`sh-${i}`, { status: 'completed', output: `package runtime\n// ${file}\n` }, 0.1);
  });
  for (const [i, file] of ['internal/runtime/policy_test.go', 'README.md'].entries()) { tool(`read-${i}`, { name: 'Read', status: 'running', input: { file_path: `${root}/${file}` } }, 1); tool(`read-${i}`, { status: 'completed', output: 'a\nb\n' }, 0.1); }
  tool('fail', { name: 'Bash', status: 'running', input: { command: 'npm test', description: 'Run the unit tests' } }, 1);
  tool('fail', { status: 'failed', output: [{ type: 'text', text: 'Exit code 1\nFAIL src/access.test.ts › owner can read' }] }, 3);
  tool('edit', { name: 'Edit', status: 'running', input: { file_path: `${root}/internal/runtime/runtime_access.go`, old_string: 'return false', new_string: 'return owner == caller' } }, 1);
  tool('edit', { status: 'completed', output: 'ok' }, 0.1);
  j.say('Found it: the owner check compared the wrong ids. Running the tests now.');
  tool('diff', { name: 'Bash', status: 'running', input: { command: 'git diff --stat' } }, 1); tool('diff', { status: 'completed', output: ' 1 file changed' }, 0.1);
  tool('gotest', { name: 'Bash', status: 'running', input: { command: 'go test ./internal/runtime/... -count 1', description: 'Run the runtime tests' } }, 1);
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  const first = page.locator('.messages').first().locator('.tool-lines').first();
  await expect(first).toContainText('Explored the codebase');
  return page;
});

shot('artifacts', async ({ f, open }) => {
  realistic(f); cacheTranscript(f);
  Object.assign(f.sessions[0], { status: 'ready', busy: false, agents: [{ id: 'root', status: 'done' }] });
  const first = f.artifacts.agentPut({ collectionId: 'alpha', sessionId: 'alpha-session', title: 'Response cache', kind: 'plan', content: PLAN.replace('4. Measure: p95 of `/products` before and after.\n', '') });
  f.artifacts.agentPut({ collectionId: 'alpha', sessionId: 'alpha-session', artifactId: first.id, content: PLAN });
  f.artifacts.agentPut({ collectionId: 'alpha', sessionId: 'alpha-session', title: 'Review of the cache change', kind: 'report', content: '# Review of the cache change\n\nNo blockers. Two notes on eviction.\n' });
  f.artifacts.agentPut({ collectionId: 'alpha', sessionId: 'alpha-session', title: 'Cache settings', kind: 'spec', content: '# Cache settings\n\n`CACHE_TTL_SECONDS`, `CACHE_MAX_ENTRIES`.\n' });
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await showPanel(page, 'Artifacts');
  await page.getByRole('listbox', { name: 'Artifacts' }).getByRole('option', { name: /Response cache/ }).click();
  await expect(page.locator('.panel-artifacts')).toContainText('Decisions');
  await page.locator('.panel-artifacts').getByRole('tab', { name: 'Changes' }).click();
  await focusPanel(page);
  return page;
});

shot('devices-pairing', async ({ f, open }) => {
  realistic(f); cacheTranscript(f);
  f.remote.tailscale = { ...f.remote.tailscale, enabled: true, state: 'serving' };
  f.remote.phoneUrl = 'https://laptop.example.ts.net:8443';
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Devices', exact: true }).click();
  await page.getByRole('tabpanel', { name: 'Devices' }).getByRole('button', { name: 'Pair a phone' }).click();
  await expect(page.getByRole('dialog', { name: 'Pair a phone' }).getByRole('img', { name: /Pairing code/ })).toBeVisible();
  return page;
});

shot('phone-inbox', async ({ f, browser }) => {
  fleet(f);
  f.remote.tailscale = { ...f.remote.tailscale, enabled: true, state: 'serving' };
  f.remote.phoneUrl = origin;
  const response = await fetch(`${f.url}/lazybox.bench.v1.RunnerService/BeginDevicePairing`, { method: 'POST', headers: { authorization: `Bearer ${f.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ grants: ['respond'] }) });
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: phone, isMobile: false, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: 'dark' });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.addInitScript(css => { addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); }); }, still);
  await page.goto((await response.json()).url);
  await page.getByRole('textbox', { name: 'Name this phone' }).fill('iPhone');
  await page.getByRole('button', { name: 'Pair this phone' }).click();
  await page.getByRole('button', { name: 'Open inbox' }).click();
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect(page.locator('.remote-row').first()).toBeVisible();
  return page;
});

shot('subscriptions', async ({ f, open }) => {
  realistic(f); cacheTranscript(f);
  f.runnerSettings.prices = defaultModelPrices();
  Object.assign(f.profiles.find(p => p.id === 'codex-saved'), { label: 'Team Codex' });
  f.profiles.find(p => p.id === 'codex-saved').availability.email = 'team@example.com';
  const now = Math.floor(Date.now() / 1000);
  f.profiles.push({ id: 'claude-work', provider: 'claude', label: 'Work Claude', managed: true, isolation: 'environment', availability: { state: 'exhausted', plan: 'max', email: 'work@example.com', resetAt: String(now + 7800), observedAtUnixMillis: String(Date.now()), windows: [{ name: 'five_hour', durationMinutes: '300', usedPercent: 100, resetAt: String(now + 7800) }, { name: 'seven_day', durationMinutes: '10080', usedPercent: 64, resetAt: String(now + 300000) }] } });
  f.profiles.push({ id: 'claude-personal', provider: 'claude', label: 'Personal Claude', managed: true, isolation: 'environment', availability: { state: 'available', plan: 'pro', email: 'me@example.com', observedAtUnixMillis: String(Date.now()), windows: [{ name: 'five_hour', durationMinutes: '300', usedPercent: 22, resetAt: String(now + 9000) }, { name: 'seven_day', durationMinutes: '10080', usedPercent: 41, resetAt: String(now + 400000) }] } });
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Subscriptions', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Subscriptions' })).toContainText('Work Claude');
  return page;
});

shot('processes', async ({ f, open }) => {
  realistic(f); cacheTranscript(f);
  Object.assign(f.processes[0], { label: 'Add a response cache', conversationTitle: 'Add a response cache', workspaceName: 'Response cache' });
  Object.assign(f.processes[1], { conversationTitle: 'Prepare the 2.4 release notes', workspaceName: 'Release 2.4' });
  Object.assign(f.processes[2], { label: 'codex · an old checkout' });
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await showPanel(page, 'Processes');
  await expect(page.getByRole('region', { name: 'Hosted processes', exact: true })).toContainText('go test');
  await focusPanel(page);
  return page;
});

shot('welcome', async ({ f, open }) => {
  f.collections.splice(0); f.sessions.splice(0);
  const page = await open('/?view=workspace');
  await expect(page.getByRole('dialog', { name: 'Welcome to Lazybox' })).toBeVisible();
  return page;
});

shot('dock-panels', async ({ f, open }) => {
  realistic(f); cacheTranscript(f);
  Object.assign(f.sessions[0], { status: 'ready', busy: false, agents: [{ id: 'root', status: 'done' }] });
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await expect(page.locator('.messages')).toContainText('Six tests cover');
  await showPanel(page, 'Files');
  await page.getByLabel('Files panel actions', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dock left', exact: true })).toBeVisible();
  return page;
});

shot('new-workspace', async ({ f, open }) => {
  realistic(f); cacheTranscript(f);
  Object.assign(f.github, { state: 'connected', authMethod: 'personal_token', login: 'you' });
  f.githubRepositories.splice(0, f.githubRepositories.length,
    ...[['api', true], ['web', false], ['infra', true], ['mobile', true], ['design-system', false], ['docs', false]].map(([name, isPrivate], i) => ({ id: String(500 + i), name, fullName: `acme/${name}`, private: isPrivate, defaultBranch: 'main', htmlUrl: `https://github.com/acme/${name}` })));
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New workspace', exact: true });
  const search = dialog.getByRole('searchbox', { name: 'Find repositories' });
  await search.fill('acme/api');
  await dialog.getByRole('checkbox', { name: 'acme/api', exact: true }).check();
  await search.fill('acme/web');
  await dialog.getByRole('checkbox', { name: 'acme/web', exact: true }).check();
  await search.fill('acme');
  await expect(dialog.getByRole('checkbox', { name: 'acme/infra', exact: true })).toBeVisible();
  return page;
});

shot('actions-hooks', async ({ f, open }) => {
  realistic(f); cacheTranscript(f);
  const step = s => ({ when: 'always', ...s });
  const hook = h => ({ description: '', workspaces: [], conversations: [], repositories: [], run: [], shell: '', webhook: '', headers: {}, grants: [], timeoutSeconds: 60, enabled: true, ...h });
  f.power.setFile({
    actions: [
      { id: 'test-then-fix', title: 'Run the tests, ask the agent to fix failures', icon: 'play', key: 't', where: ['palette', 'menu', 'conversation'], confirm: false, steps: [step({ kind: 'run', action: 'api/test' }), step({ kind: 'send', text: 'The tests failed. Read the output in the console and fix them.', to: 'current', when: 'failed' }), step({ kind: 'open', panel: 'changes', when: 'succeeded' })] },
      { id: 'nudge', title: 'Tell the agent to continue', icon: 'send', key: 'g', where: ['palette', 'menu', 'conversation'], confirm: false, steps: [step({ kind: 'send', text: 'Continue.', to: 'current' })] },
      { id: 'unattended', title: 'Run unattended', icon: 'shield', key: '', where: ['palette'], confirm: true, description: 'No approvals until you change it back.', steps: [step({ kind: 'permission', permission: 'yolo' })] },
    ],
    hooks: [hook({ id: 'notify', on: ['agent.needs-input'], run: ['terminal-notifier', '-title', 'Lazybox', '-message', 'needs you'] }), hook({ id: 'ci-failed', on: ['pr.checks-failed'], webhook: 'https://hooks.example.com/lazybox', description: 'Post failing checks to the team channel' })],
    issues: [], path: '~/.config/lazybox/actions.yaml', schemaPath: '~/.config/lazybox/actions.schema.json',
  });
  const page = await open('/?view=workspace&collection=alpha&session=alpha-session');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Actions & hooks' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Actions & hooks' })).toContainText('Run the tests');
  return page;
});

async function showPanel(page, title) {
  await page.getByLabel('Page actions', { exact: true }).click();
  await page.getByRole('group', { name: 'Page actions menu' }).getByRole('button', { name: title, exact: true }).click();
}
/** Drags a split's separator to a point on the page. */
async function drag(page, separator, to) {
  const box = await separator.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(to.x ?? x, to.y ?? y, { steps: 8 }); await page.mouse.up();
}
/** Nothing focused or hovered: no focus ring or tooltip in the picture. */
async function focusPanel(page) {
  await page.evaluate(() => document.activeElement?.blur());
}
async function openChanges(page) {
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  const changes = page.getByRole('region', { name: 'Workspace changes' });
  await expect(changes.getByRole('grid', { name: 'File diff' })).toContainText('const max = 1000;');
  return changes;
}
async function comment(page, changes, line, text) {
  const diff = changes.getByRole('grid', { name: 'File diff' });
  await diff.getByRole('button', { name: line, exact: true }).focus();
  await page.keyboard.press('Enter');
  const field = changes.getByRole('textbox', { name: 'Comment' });
  await field.fill(text);
  await field.press('ControlOrMeta+Enter');
  await expect(changes.getByRole('textbox', { name: 'Comment' })).toHaveCount(0);
}

// ---- Runner ---------------------------------------------------------------

const wanted = process.argv.slice(2);
const unknown = wanted.filter(name => !shots[name]);
if (unknown.length) { console.error(`Unknown shot: ${unknown.join(', ')}. Known: ${Object.keys(shots).join(', ')}`); process.exit(2); }
const server = await createServer({ ...testViteCache(import.meta.url), configFile: false, logLevel: 'error', root: fileURLToPath(new URL('../apps/web', import.meta.url)), plugins: [react()], server: { host: '127.0.0.1', port: 0, proxy: { '/lazybox.bench.v1.RunnerService/': { target: forwarderUrl }, '/remote/v1/': { target: forwarderUrl } } } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
await mkdir(out, { recursive: true });
const encoder = await browser.newPage();
const toWebp = png => encoder.evaluate(async source => {
  const image = new Image(); image.src = 'data:image/png;base64,' + source; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.toDataURL('image/webp', 0.86).split(',')[1];
}, png.toString('base64'));

const failed = [];
let total = 0;
for (const name of wanted.length ? wanted : Object.keys(shots)) {
  const { run, viewport = desktop, setup, colorScheme = 'dark' } = shots[name];
  const f = await startRunnerFixture();
  target = f.url;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme });
  const errors = [];
  let extra;
  try {
    await setup?.(f);
    const open = async (path, init) => {
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', e => errors.push(String(e)));
      if (init) await page.addInitScript(init);
      await page.addInitScript(css => { addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); }); }, still);
      await page.goto(`${origin}${path}#token=${f.token}`);
      return page;
    };
    const page = await run({ f, open, context, browser });
    // No hover state in the picture.
    await page.mouse.move(1, Math.round((viewport.height) / 2));
    if (page.context() !== context) extra = page.context();
    await page.waitForTimeout(300);
    // DOCS_SNAPSHOT=1 prints what the page shows, for writing a new shot.
    if (process.env.DOCS_SNAPSHOT) console.log(await page.locator('body').ariaSnapshot());
    const png = await page.screenshot({ type: 'png' });
    const webp = Buffer.from(await toWebp(png), 'base64');
    await writeFile(out + name + '.webp', webp);
    total += webp.length;
    console.log(`${name}.webp  ${(webp.length / 1024).toFixed(0)} KB${errors.length ? `  (page errors: ${errors.join(' | ')})` : ''}`);
  } catch (error) {
    failed.push(name);
    console.error(`FAILED ${name}: ${error.message.split('\n')[0]}`);
    // What the page showed when it failed, to fix the shot.
    const last = context.pages().at(-1);
    if (last) {
      await mkdir('.cache', { recursive: true });
      await last.screenshot({ path: `.cache/docs-shot-failed-${name}.png` }).catch(() => {});
      if (process.env.DOCS_SNAPSHOT) console.error(await last.locator('body').ariaSnapshot().catch(() => ''));
    }
  } finally {
    await extra?.close(); await context.close(); await f.close();
  }
}
await browser.close(); await server.close(); forwarder.close(); handbook.close();
console.log(`Total ${(total / 1024).toFixed(0)} KB in ${out}`);
if (failed.length) { console.error(`Failed: ${failed.join(', ')}`); process.exit(1); }
