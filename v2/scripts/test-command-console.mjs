// The console opens when a `lazybox run` starts in the viewed session, labels the
// run with what its agent received, and stays closed once the user closes it.
import {testViteCache} from './fixtures/vite-cache.mjs';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startRunnerFixture } from './fixtures/runner-ui.mjs';

const fixture = await startRunnerFixture();
const server = await createServer({...testViteCache(import.meta.url), configFile: false, root: fileURLToPath(new URL('../apps/web', import.meta.url)), plugins: [react()], server: { host: '127.0.0.1', port: 0, proxy: { '/lazybox.bench.v1.RunnerService/': { target: fixture.url } } } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?view=workspace#token=${fixture.token}`);
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('alpha');
  await page.getByRole('combobox', { name: 'Session', exact: true }).selectOption('alpha-session');
  const chat = page.locator('[data-panel-id="alpha-work-chat"]');
  const composer = chat.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEnabled();
  const show = page.getByRole('button', { name: 'Show command output', exact: true });
  const hide = page.getByRole('button', { name: 'Hide command output', exact: true });
  const lists = () => fixture.calls.filter(call => call.method === 'ListCommands' && call.body.sessionId === 'alpha-session').length;

  // A command that existed before the session was viewed does not open the console.
  const baseline = lists();
  await expect.poll(lists, { timeout: 5000 }).toBeGreaterThan(baseline + 1);
  await expect(show).toBeVisible();

  // A run starts while the user is typing: the console opens on it, the composer keeps focus.
  await composer.click(); await composer.fill('typing while the agent runs tests');
  const run = fixture.startRun('alpha-session', 'go test ./...', { exitCode: 1, outputBytes: '1468006', agentBytes: '2150', filter: 'go-test', outputPath: '/state/command-output/alpha-session/go-1.log' });
  await expect(hide).toBeVisible({ timeout: 5000 });
  const report = page.getByTestId('command-report');
  await expect(report).toContainText('Exit 1 · the agent got a 2.1 KiB summary of 1.4 MiB (go-test filter)');
  await expect(page.locator('.command-panel select')).toHaveValue(run.id);
  await expect(page.locator('.command-panel footer')).toContainText('Exit 1');
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('typing while the agent runs tests');

  // Closed by the user, it stays closed for that run.
  await hide.click();
  await expect(show).toBeVisible();
  const closed = lists();
  await expect.poll(lists, { timeout: 5000 }).toBeGreaterThan(closed + 1);
  await expect(show).toBeVisible();

  // The next run opens it again, on the new run.
  const next = fixture.startRun('alpha-session', 'npm test', { exitCode: 0, outputBytes: '120', agentBytes: '180', filter: 'passthrough', outputPath: '' });
  await expect(hide).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.command-panel select')).toHaveValue(next.id);
  await expect(report).toContainText('Exit 0 · the agent got all of it (120 B)');
  await expect(report.getByRole('button', { name: 'Copy log path' })).toHaveCount(0);

  // A run in another session leaves this console alone.
  await hide.click();
  fixture.startRun('beta-session', 'cargo test', { exitCode: 0, outputBytes: '10', agentBytes: '50', filter: 'passthrough' });
  const other = lists();
  await expect.poll(lists, { timeout: 5000 }).toBeGreaterThan(other + 1);
  await expect(show).toBeVisible();

  assert.equal(fixture.mutations.length, 0, 'opening the console must not mutate execution');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: the console opens once per run in the viewed session without taking focus, and labels the run with what its agent received. Explicitly fake RPC fixture.');
} finally {
  await browser?.close(); await server.close(); await fixture.close();
}
